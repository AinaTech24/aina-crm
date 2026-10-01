/**
 * The opportunity journey engine — an existing client wants another product.
 *
 *   createOpportunity   one open row per (client, product); marks the product
 *                       "Interested" on the client's Cross-sell card and gives
 *                       the owner a follow-up task.
 *   advanceOpportunity  moves to the next stage of the product's path (or to
 *                       Lost), refusing when a compliance gate is not met, and
 *                       then lets the journey skip what is already on file.
 *   syncOpportunity     the skip step on its own — run when something outside
 *                       the journey changed (a proposal was sent, KYC verified,
 *                       a policy recorded).
 *   onProposalEvent     the seam for the proposals module: sent / accepted /
 *                       declined move whichever opportunity the proposal answers.
 *   listOpportunities   the views the client page and APIs render.
 *
 * ── Gates (never skipped, never bypassed by hand) ─────────────────────────
 *   → proposal        MF: a client-confirmed risk profile signed in the last
 *                     12 months (SEBI suitability). Insurance: a recorded needs
 *                     analysis (IRDAI). A PROVISIONAL, age-suggested profile
 *                     does not count.
 *   → mf_transaction  KYC verified, a UCC on record, and for a SIP an active
 *                     mandate.
 *
 * ── Skips (automatic, each with a history row saying why) ─────────────────
 *   suitability       the gate above is already met
 *   proposal/accepted a matching proposal is sent / accepted
 *   mf_kyc / mf_ucc   KYC verified / UCC on record
 *   mf_mandate        lumpsum, or an active mandate whose limit covers the SIP
 *   mf_transaction    a purchase or SIP on the client since the opportunity opened
 *   ins_*             the policy is recorded / past underwriting / issued
 * "Need identified" and "Discussion" are people talking and are never skipped
 * — except when a proposal has already been shared, which proves they happened.
 *
 * A blank field is a record gap, not a need: nothing here opens an
 * opportunity because a column is empty. Opportunities are opened by people
 * (or, later, by named automations).
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientOpportunities, eventsOutbox, tasks, type ClientOpportunity, type NeedsAnalysis } from "@/db/schema";
import { blueprintStageHistory } from "@/db/schema";
import { ensureInstanceFor, transitionPoly } from "@/lib/blueprints/poly-engine";
import { recordAudit } from "@/lib/audit";
import { formatDate, formatMoney } from "@/lib/format";
import {
  isCrossSellProduct, productLabel, productPipeline, proposalTypesFor, type OpportunityPipeline, type OpportunitySource,
} from "./products";
import { isClosedStage, nextStage, OPPORTUNITY_PATHS, stageName, type OpportunityStageKey } from "./stages";

export type Actor = { tenantId: string; userId: string };

export type Prerequisite = {
  label: string;
  satisfied: boolean;
  hint?: string;
  cta?: { href: string; label: string };
};

// "changes_requested" (proposal redesign, migration 0225) is still a shared
// proposal awaiting the RM's revision — it counts as sent.
const PROPOSAL_SENT = new Set(["sent", "viewed", "changes_requested", "accepted", "partially_approved", "executed"]);
const PROPOSAL_ACCEPTED = new Set(["accepted", "partially_approved", "executed"]);
const POLICY_ISSUED = new Set(["active", "claim_filed", "claim_settled"]);

/* ─────────────────────────────── facts ─────────────────────────────── */

export type Facts = {
  kycStatus: string | null;
  kycVerified: boolean;
  hasUcc: boolean;
  mandateStatus: string | null;
  mandateAmount: number | null;
  riskState: "awaiting" | "not_profiled" | "current" | "expired";
  riskSignedAt: string | null;
  proposal: { id: string; status: string; type: string } | null;
  policy: { id: string; status: string; policyType: string | null } | null;
  transaction: { id: string; orderDate: string | null; amount: number | null } | null;
  /** FD / Bonds / NCD only: a fixed deposit recorded since the opportunity opened. */
  fixedDeposit: { id: string; status: string; issuer: string } | null;
};

/** Everything the gates and skips read, in one round of queries. */
export async function loadFacts(tx: Tx, opp: ClientOpportunity): Promise<Facts> {
  const inv = (await tx.execute(sql`
    SELECT kyc_status, bse_ucc_code, nse_can_code, ucc_codes, mandate_status, mandate_amount,
           risk_profile_signed_at, risk_profile_provisional
      FROM investors WHERE id = ${opp.investorId}::uuid AND tenant_id = ${opp.tenantId}::uuid
  `)).rows[0] as Record<string, any> | undefined;

  const since = sql`${opp.createdAt.toISOString()}::timestamptz - interval '7 days'`;
  const types = proposalTypesFor(opp.product);
  const proposal = (await tx.execute(sql`
    SELECT id, status, type FROM proposals
     WHERE tenant_id = ${opp.tenantId}::uuid
       AND (opportunity_id = ${opp.id}::uuid
            OR (opportunity_id IS NULL AND investor_id = ${opp.investorId}::uuid
                AND type IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)})
                AND created_at >= ${since}))
       AND status NOT IN ('draft', 'rejected', 'expired', 'superseded')
     ORDER BY (opportunity_id = ${opp.id}::uuid) DESC NULLS LAST,
              CASE WHEN status IN ('accepted', 'partially_approved', 'executed') THEN 0 ELSE 1 END,
              created_at DESC
     LIMIT 1
  `)).rows[0] as { id: string; status: string; type: string } | undefined;

  let policy: Facts["policy"] = null;
  if (opp.pipeline === "insurance") {
    const r = (await tx.execute(sql`
      SELECT id, status, policy_type FROM insurance_policies
       WHERE tenant_id = ${opp.tenantId}::uuid AND investor_id = ${opp.investorId}::uuid
         AND created_at >= ${opp.createdAt.toISOString()}::timestamptz
       ORDER BY CASE WHEN status IN ('active', 'claim_filed', 'claim_settled') THEN 0 ELSE 1 END, created_at DESC
       LIMIT 1
    `)).rows[0] as { id: string; status: string; policy_type: string | null } | undefined;
    if (r) policy = { id: r.id, status: r.status, policyType: r.policy_type };
  }

  let transaction: Facts["transaction"] = null;
  if (opp.pipeline === "mf") {
    const r = (await tx.execute(sql`
      SELECT id, order_date, amount FROM transactions
       WHERE tenant_id = ${opp.tenantId}::uuid AND investor_id = ${opp.investorId}::uuid
         AND type IN ('purchase', 'sip', 'lumpsum') AND direction = 'inflow'
         AND status NOT IN ('rejected', 'cancelled', 'failed')
         AND COALESCE(order_date, created_at::date) >= (${opp.createdAt.toISOString()}::timestamptz AT TIME ZONE 'Asia/Kolkata')::date
       ORDER BY COALESCE(order_date, created_at::date) ASC
       LIMIT 1
    `)).rows[0] as { id: string; order_date: string | null; amount: string | null } | undefined;
    if (r) transaction = { id: r.id, orderDate: r.order_date, amount: r.amount == null ? null : Number(r.amount) };
  }

  let fixedDeposit: Facts["fixedDeposit"] = null;
  if (opp.product === "fd_bonds_ncd") {
    const r = (await tx.execute(sql`
      SELECT id, status, issuer FROM fixed_deposits
       WHERE tenant_id = ${opp.tenantId}::uuid AND investor_id = ${opp.investorId}::uuid
         AND deleted_at IS NULL AND status <> 'cancelled'
         AND created_at >= ${since}
       ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at DESC
       LIMIT 1
    `)).rows[0] as { id: string; status: string; issuer: string } | undefined;
    if (r) fixedDeposit = r;
  }

  const signed = inv?.risk_profile_signed_at ? new Date(inv.risk_profile_signed_at) : null;
  const yearAgo = new Date(Date.now() - 365 * 864e5);
  const riskState: Facts["riskState"] = inv?.risk_profile_provisional
    ? "awaiting"
    : !signed ? "not_profiled" : signed >= yearAgo ? "current" : "expired";
  const uccCodes = Array.isArray(inv?.ucc_codes) ? (inv!.ucc_codes as string[]) : [];

  return {
    kycStatus: inv?.kyc_status ?? null,
    kycVerified: inv?.kyc_status === "verified",
    hasUcc: !!(inv?.bse_ucc_code || inv?.nse_can_code || uccCodes.some((c) => c && c.trim())),
    mandateStatus: inv?.mandate_status ?? null,
    mandateAmount: inv?.mandate_amount == null ? null : Number(inv.mandate_amount),
    riskState,
    riskSignedAt: signed ? signed.toISOString() : null,
    proposal: proposal ?? null,
    policy,
    transaction,
    fixedDeposit,
  };
}

const hasNeedsAnalysis = (n: NeedsAnalysis | null | undefined) =>
  !!n && (n.coverNeeded != null || n.annualIncome != null);

/* ─────────────────────────────── gates ─────────────────────────────── */

/** What must already be true to ENTER `target`. Empty = nothing. */
export function gateFor(target: string, opp: ClientOpportunity, f: Facts): Prerequisite[] {
  const client = `/dashboard/investors/${opp.investorId}`;
  if (target === "proposal" && opp.pipeline === "mf") {
    return [{
      label: "A client-confirmed risk profile signed in the last 12 months",
      satisfied: f.riskState === "current",
      hint: f.riskState === "awaiting"
        ? "The profile was suggested from age and the client has not confirmed it."
        : f.riskState === "expired" ? "The last signed profile is more than a year old."
        : f.riskState === "not_profiled" ? "The client has never completed the questionnaire." : undefined,
      cta: { href: `${client}#risk_history`, label: "Open risk profile" },
    }];
  }
  if (target === "proposal" && opp.pipeline === "insurance") {
    return [{
      label: "Needs analysis recorded (income and cover needed)",
      satisfied: hasNeedsAnalysis(opp.needsAnalysis),
      hint: "Record it on this opportunity before sharing a quote.",
    }];
  }
  if (target === "mf_transaction") {
    const out: Prerequisite[] = [
      { label: "KYC verified", satisfied: f.kycVerified,
        hint: f.kycStatus && f.kycStatus !== "verified" ? `KYC is ${f.kycStatus.replace(/_/g, " ")}.` : undefined,
        cta: { href: `${client}#master`, label: "Open client details" } },
      { label: "A UCC / CAN on record", satisfied: f.hasUcc, cta: { href: `${client}#master`, label: "Open client details" } },
    ];
    if (opp.investmentMode === "sip") {
      out.push({ label: "An active mandate for the SIP", satisfied: mandateCovers(opp, f),
        hint: mandateHint(opp, f) });
    }
    return out;
  }
  return [];
}

function mandateCovers(opp: ClientOpportunity, f: Facts): boolean {
  if (f.mandateStatus !== "active") return false;
  const need = opp.expectedValue == null ? null : Number(opp.expectedValue);
  return f.mandateAmount == null || need == null || f.mandateAmount >= need;
}

function mandateHint(opp: ClientOpportunity, f: Facts): string | undefined {
  if (f.mandateStatus !== "active") return `Mandate is ${(f.mandateStatus ?? "none").replace(/_/g, " ")}.`;
  if (!mandateCovers(opp, f)) return `The mandate limit (${formatMoney(f.mandateAmount)}) is below the SIP (${formatMoney(Number(opp.expectedValue))}).`;
  return undefined;
}

/* ─────────────────────────────── skips ─────────────────────────────── */

type Skip = { reason: string; kind: "on_file" | "evidence" };

/** Why the journey can pass `stage` without anyone doing it — or null. */
export function skipReason(stage: string, opp: ClientOpportunity, f: Facts): Skip | null {
  switch (stage) {
    case "suitability": {
      const g = gateFor("proposal", opp, f);
      if (g.length && g.every((p) => p.satisfied)) {
        return { kind: "on_file", reason: opp.pipeline === "mf" ? "risk profile is current" : "needs analysis recorded" };
      }
      return null;
    }
    case "proposal":
      return f.proposal && PROPOSAL_SENT.has(f.proposal.status) ? { kind: "evidence", reason: "proposal shared" } : null;
    case "accepted":
      return f.proposal && PROPOSAL_ACCEPTED.has(f.proposal.status) ? { kind: "evidence", reason: "client accepted the proposal" } : null;
    case "mf_kyc":
      return f.kycVerified ? { kind: "on_file", reason: "KYC verified" } : null;
    case "mf_ucc":
      return f.hasUcc ? { kind: "on_file", reason: "UCC on record" } : null;
    case "mf_mandate":
      if (opp.investmentMode !== "sip") return { kind: "on_file", reason: "lumpsum — no mandate needed" };
      return mandateCovers(opp, f) ? { kind: "on_file", reason: "an active mandate covers the SIP" } : null;
    case "mf_transaction":
      return f.transaction
        ? { kind: "evidence", reason: `transaction on ${f.transaction.orderDate ? formatDate(f.transaction.orderDate) : "record"}` }
        : null;
    case "ins_proposal_form":
      return f.policy ? { kind: "evidence", reason: "policy recorded on the client" } : null;
    case "ins_underwriting":
      return f.policy && f.policy.status !== "proposed" ? { kind: "evidence", reason: "past underwriting" } : null;
    case "ins_issued":
      return f.policy && POLICY_ISSUED.has(f.policy.status) ? { kind: "evidence", reason: "policy issued" } : null;
    case "gen_executed":
      return f.fixedDeposit ? { kind: "evidence", reason: `fixed deposit with ${f.fixedDeposit.issuer} recorded` } : null;
    default:
      return null;
  }
}

const remarkFor = (s: Skip) =>
  s.kind === "on_file" ? `Skipped — already on file: ${s.reason}` : `Done automatically — ${s.reason}`;

/* ─────────────────────────────── create ─────────────────────────────── */

export type CreateInput = {
  investorId: string;
  product: string;
  expectedValue?: number | null;
  investmentMode?: "sip" | "lumpsum" | null;
  source?: OpportunitySource;
  notes?: string | null;
  ownerId?: string | null;
  coOwnerId?: string | null;
  sourceLeadId?: string | null;
};

export async function createOpportunity(
  tx: Tx, actor: Actor, input: CreateInput,
): Promise<{ opportunity: ClientOpportunity; created: boolean }> {
  const [existing] = await tx.select().from(clientOpportunities).where(and(
    eq(clientOpportunities.tenantId, actor.tenantId),
    eq(clientOpportunities.investorId, input.investorId),
    eq(clientOpportunities.product, input.product),
    eq(clientOpportunities.status, "open"),
  )).limit(1);
  if (existing) return { opportunity: existing, created: false };

  const inv = (await tx.execute(sql`
    SELECT name, rm_id FROM investors WHERE id = ${input.investorId}::uuid AND tenant_id = ${actor.tenantId}::uuid
  `)).rows[0] as { name: string; rm_id: string | null } | undefined;
  if (!inv) throw Object.assign(new Error("Client not found"), { status: 404 });

  const pipeline = productPipeline(input.product);
  const ownerId = input.ownerId || inv.rm_id || actor.userId;
  const [opp] = await tx.insert(clientOpportunities).values({
    tenantId: actor.tenantId,
    investorId: input.investorId,
    product: input.product,
    pipeline,
    expectedValue: input.expectedValue == null ? null : String(input.expectedValue),
    investmentMode: pipeline === "mf" ? (input.investmentMode ?? null) : null,
    source: input.source ?? "manual",
    ownerId,
    coOwnerId: input.coOwnerId || null,
    sourceLeadId: input.sourceLeadId || null,
    notes: input.notes?.trim() || null,
    createdBy: actor.userId,
  }).returning();

  await ensureInstanceFor(tx, actor.tenantId, "opportunity", opp.id);

  // The Cross-sell card says the same thing as the opportunity.
  if (isCrossSellProduct(input.product)) {
    await tx.execute(sql`
      UPDATE investors
         SET cross_sell = COALESCE(cross_sell, '{}'::jsonb) || jsonb_build_object(${input.product}::text, 'interested'),
             updated_at = now()
       WHERE id = ${input.investorId}::uuid AND tenant_id = ${actor.tenantId}::uuid
         AND COALESCE(cross_sell ->> ${input.product}, '') <> 'held_with_us'
    `);
  }

  // The first step is a person talking to the client — it belongs on their worklist.
  await tx.insert(tasks).values({
    tenantId: actor.tenantId,
    subjectType: "investor",
    subjectId: input.investorId,
    relatedInvestorId: input.investorId,
    type: "follow_up",
    title: `${productLabel(input.product)} — talk to ${inv.name}`,
    description: input.notes?.trim() || `${inv.name} is interested in ${productLabel(input.product)}. Discuss what they need.`,
    priority: "normal",
    status: "open",
    assigneeId: ownerId,
    dueAt: new Date(Date.now() + 2 * 864e5),
    createdById: actor.userId,
    meta: { opportunityId: opp.id },
  } as any);

  await tx.insert(eventsOutbox).values({
    tenantId: actor.tenantId, kind: "opportunity.created", entityType: "opportunity", entityId: opp.id,
    after: { investorId: opp.investorId, product: opp.product, pipeline, source: opp.source },
    meta: { actorUserId: actor.userId },
  } as any);
  await recordAudit(tx, {
    tenantId: actor.tenantId, actorUserId: actor.userId, action: "opportunity.create",
    entityType: "opportunity", entityId: opp.id,
    after: { investorId: opp.investorId, product: opp.product, expectedValue: opp.expectedValue, source: opp.source },
  } as any);

  return { opportunity: opp, created: true };
}

/* ─────────────────────────────── advance ─────────────────────────────── */

export type AdvanceInput = { to?: string; remarks?: string; lostReason?: string; revisitOn?: string | null };
export type AdvanceResult =
  | { ok: true; stage: string; skipped: string[] }
  | { ok: false; error: string; blocked?: Prerequisite[]; status: number };

async function loadOpp(tx: Tx, tenantId: string, id: string) {
  const [opp] = await tx.select().from(clientOpportunities)
    .where(and(eq(clientOpportunities.tenantId, tenantId), eq(clientOpportunities.id, id))).limit(1);
  return opp ?? null;
}

export async function advanceOpportunity(tx: Tx, actor: Actor, id: string, input: AdvanceInput): Promise<AdvanceResult> {
  const opp = await loadOpp(tx, actor.tenantId, id);
  if (!opp) return { ok: false, error: "Opportunity not found", status: 404 };
  if (opp.status !== "open") return { ok: false, error: `This opportunity is already ${opp.status}.`, status: 409 };

  const inst = await ensureInstanceFor(tx, actor.tenantId, "opportunity", opp.id);
  const current = inst.currentStageKey;

  if (input.to === "lost") {
    const reason = input.lostReason?.trim();
    if (!reason) return { ok: false, error: "Say why it was lost.", status: 400 };
    const r = await transitionPoly(tx, actor.tenantId, "opportunity", opp.id, "lost", {
      actorUserId: actor.userId, remarks: reason, finalStatus: "lost",
    });
    if (!r.ok) return { ok: false, error: (r as any).reason ?? "Could not close", status: 409 };
    await closeOpportunity(tx, actor, opp, "lost", { lostReason: reason, revisitOn: input.revisitOn ?? null });
    return { ok: true, stage: "lost", skipped: [] };
  }

  const target = input.to ?? nextStage(opp.pipeline as OpportunityPipeline, current);
  if (!target) return { ok: false, error: "This journey has no next step.", status: 409 };
  if (target !== nextStage(opp.pipeline as OpportunityPipeline, current)) {
    return { ok: false, error: `The next step from "${stageName(current)}" is "${stageName(nextStage(opp.pipeline as OpportunityPipeline, current) ?? "")}".`, status: 400 };
  }

  const facts = await loadFacts(tx, opp);
  const gate = gateFor(target, opp, facts);
  if (gate.some((p) => !p.satisfied)) {
    return { ok: false, error: `"${stageName(target)}" needs these first.`, blocked: gate, status: 409 };
  }

  const r = await transitionPoly(tx, actor.tenantId, "opportunity", opp.id, target, {
    actorUserId: actor.userId, remarks: input.remarks?.trim() || undefined,
    finalStatus: target === "won" ? "completed" : "in_progress",
  });
  if (!r.ok) return { ok: false, error: (r as any).reason ?? "Could not move", status: 409 };
  if (target === "won") {
    await closeOpportunity(tx, actor, opp, "won");
    return { ok: true, stage: "won", skipped: [] };
  }
  const { stage, skipped } = await autoSkip(tx, actor, opp, facts, target);
  return { ok: true, stage, skipped };
}

/** Walk forward over every stage the client already satisfies. */
async function autoSkip(tx: Tx, actor: Actor, opp: ClientOpportunity, facts: Facts, from: string) {
  const skipped: string[] = [];
  let cur = from;
  for (let guard = 0; guard < 12 && !isClosedStage(cur); guard++) {
    const skip = skipReason(cur, opp, facts);
    if (!skip) break;
    const nxt = nextStage(opp.pipeline as OpportunityPipeline, cur);
    if (!nxt) break;
    if (gateFor(nxt, opp, facts).some((p) => !p.satisfied)) break;
    const r = await transitionPoly(tx, opp.tenantId, "opportunity", opp.id, nxt, {
      actorUserId: actor.userId, remarks: remarkFor(skip), systemBypass: true,
      finalStatus: nxt === "won" ? "completed" : "in_progress",
    });
    if (!r.ok) break;
    skipped.push(cur);
    cur = nxt;
  }
  if (cur === "won") await closeOpportunity(tx, actor, opp, "won");
  return { stage: cur, skipped };
}

/** Re-check the journey against what is on file now. Safe to call any time. */
export async function syncOpportunity(tx: Tx, actor: Actor, id: string) {
  const opp = await loadOpp(tx, actor.tenantId, id);
  if (!opp || opp.status !== "open") return null;
  const inst = await ensureInstanceFor(tx, actor.tenantId, "opportunity", opp.id);
  if (inst.currentStageKey === "identified" || inst.currentStageKey === "discussion") return { stage: inst.currentStageKey, skipped: [] };
  return autoSkip(tx, actor, opp, await loadFacts(tx, opp), inst.currentStageKey);
}

async function closeOpportunity(
  tx: Tx, actor: Actor, opp: ClientOpportunity, outcome: "won" | "lost",
  extra: { lostReason?: string; revisitOn?: string | null } = {},
) {
  const now = new Date();
  await tx.update(clientOpportunities).set(outcome === "won"
    ? { status: "won", wonAt: now, updatedAt: now }
    : { status: "lost", lostAt: now, lostReason: extra.lostReason ?? null, revisitOn: extra.revisitOn || null, updatedAt: now },
  ).where(eq(clientOpportunities.id, opp.id));

  if (outcome === "won" && isCrossSellProduct(opp.product)) {
    await tx.execute(sql`
      UPDATE investors
         SET cross_sell = COALESCE(cross_sell, '{}'::jsonb) || jsonb_build_object(${opp.product}::text, 'held_with_us'),
             updated_at = now()
       WHERE id = ${opp.investorId}::uuid AND tenant_id = ${opp.tenantId}::uuid
    `);
  }

  // The opportunity's open tasks end with it.
  await tx.execute(sql`
    UPDATE tasks SET status = 'completed', completed_at = now(), updated_at = now()
     WHERE tenant_id = ${opp.tenantId}::uuid AND meta ->> 'opportunityId' = ${opp.id}
       AND status IN ('open', 'in_progress', 'blocked')
  `);

  if (outcome === "lost" && extra.revisitOn) {
    const inv = (await tx.execute(sql`SELECT name FROM investors WHERE id = ${opp.investorId}::uuid`)).rows[0] as { name: string } | undefined;
    await tx.insert(tasks).values({
      tenantId: opp.tenantId, subjectType: "investor", subjectId: opp.investorId, relatedInvestorId: opp.investorId,
      type: "follow_up", title: `Revisit ${productLabel(opp.product)} — ${inv?.name ?? "client"}`,
      description: `Lost earlier: ${extra.lostReason}`, priority: "normal", status: "open",
      assigneeId: opp.ownerId, dueAt: new Date(`${extra.revisitOn}T09:00:00+05:30`), createdById: actor.userId,
      meta: { opportunityId: opp.id, revisit: true },
    } as any);
  }

  await tx.insert(eventsOutbox).values({
    tenantId: opp.tenantId, kind: `opportunity.${outcome}`, entityType: "opportunity", entityId: opp.id,
    after: { investorId: opp.investorId, product: opp.product, pipeline: opp.pipeline, lostReason: extra.lostReason ?? null },
    meta: { actorUserId: actor.userId },
  } as any);
  await recordAudit(tx, {
    tenantId: opp.tenantId, actorUserId: actor.userId, action: `opportunity.${outcome}`,
    entityType: "opportunity", entityId: opp.id,
    after: { product: opp.product, lostReason: extra.lostReason ?? null, revisitOn: extra.revisitOn ?? null },
  } as any);
}

/* ─────────────────────────── product booked ─────────────────────────── */

/**
 * The product is now held with the firm (an FD recorded active, …): the
 * client's open opportunity for it is won, whatever stage it stood at. A
 * no-op when there is none. Returns the opportunity id it closed.
 */
export async function onProductBooked(
  tx: Tx, actor: Actor, investorId: string, product: string, remark: string,
): Promise<string | null> {
  const [opp] = await tx.select().from(clientOpportunities).where(and(
    eq(clientOpportunities.tenantId, actor.tenantId), eq(clientOpportunities.investorId, investorId),
    eq(clientOpportunities.product, product), eq(clientOpportunities.status, "open"),
  )).limit(1);
  if (!opp) return null;
  await ensureInstanceFor(tx, actor.tenantId, "opportunity", opp.id);
  const r = await transitionPoly(tx, actor.tenantId, "opportunity", opp.id, "won", {
    actorUserId: actor.userId, remarks: `Done automatically — ${remark}`, systemBypass: true, finalStatus: "completed",
  });
  if (!r.ok) return null;
  await closeOpportunity(tx, actor, opp, "won");
  return opp.id;
}

/* ─────────────────────────── proposals seam ─────────────────────────── */

/**
 * Called by the proposals module when a proposal is sent, accepted or
 * declined. Moves the opportunity the proposal answers — the one named in
 * proposals.opportunity_id, else the client's open opportunity whose product
 * the proposal type covers. A no-op when there is none.
 */
export async function onProposalEvent(
  tx: Tx, tenantId: string, proposalId: string, event: "sent" | "accepted" | "declined", actorUserId?: string,
) {
  const p = (await tx.execute(sql`
    SELECT id, investor_id, type, opportunity_id FROM proposals WHERE id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid
  `)).rows[0] as { id: string; investor_id: string | null; type: string; opportunity_id: string | null } | undefined;
  if (!p) return null;

  let opp: ClientOpportunity | null = p.opportunity_id ? await loadOpp(tx, tenantId, p.opportunity_id) : null;
  if (!opp && p.investor_id) {
    const open = await tx.select().from(clientOpportunities).where(and(
      eq(clientOpportunities.tenantId, tenantId), eq(clientOpportunities.investorId, p.investor_id),
      eq(clientOpportunities.status, "open"),
    )).orderBy(desc(clientOpportunities.createdAt));
    opp = open.find((o) => proposalTypesFor(o.product).includes(p.type)) ?? null;
  }
  if (!opp || opp.status !== "open") return null;
  const actor: Actor = { tenantId, userId: actorUserId ?? opp.ownerId ?? opp.createdBy ?? "" };

  if (event === "declined") {
    await tx.insert(tasks).values({
      tenantId, subjectType: "investor", subjectId: opp.investorId, relatedInvestorId: opp.investorId,
      type: "follow_up", title: `${productLabel(opp.product)} proposal declined — revise or close`,
      priority: "high", status: "open", assigneeId: opp.ownerId, dueAt: new Date(Date.now() + 864e5),
      createdById: actorUserId ?? null, meta: { opportunityId: opp.id, proposalId },
    } as any);
    return { stage: null, skipped: [] };
  }

  // A shared proposal proves the conversation happened: carry the journey
  // past the people steps, then let the gates and skips decide the rest.
  const inst = await ensureInstanceFor(tx, tenantId, "opportunity", opp.id);
  let cur = inst.currentStageKey;
  for (const step of ["identified", "discussion"] as const) {
    if (cur !== step) continue;
    const nxt = nextStage(opp.pipeline as OpportunityPipeline, cur)!;
    const r = await transitionPoly(tx, tenantId, "opportunity", opp.id, nxt, {
      actorUserId: actor.userId || undefined, remarks: "Done automatically — proposal shared", systemBypass: true,
      finalStatus: "in_progress",
    });
    if (!r.ok) break;
    cur = nxt;
  }
  return autoSkip(tx, actor, opp, await loadFacts(tx, opp), cur);
}

/* ─────────────────────────────── views ─────────────────────────────── */

export type StageView = {
  key: string;
  name: string;
  status: "done" | "auto" | "skipped" | "current" | "upcoming";
  note?: string | null;
};

export type OpportunityView = {
  id: string;
  investorId: string;
  product: string;
  productLabel: string;
  pipeline: OpportunityPipeline;
  status: "open" | "won" | "lost";
  expectedValue: number | null;
  investmentMode: "sip" | "lumpsum" | null;
  source: string;
  ownerId: string | null;
  ownerName: string | null;
  coOwnerId: string | null;
  coOwnerName: string | null;
  notes: string | null;
  needsAnalysis: NeedsAnalysis | null;
  lostReason: string | null;
  revisitOn: string | null;
  createdAt: string;
  closedAt: string | null;
  current: { key: string; name: string; enteredAt: string; slaDays: number | null; delayed: boolean };
  stages: StageView[];
  next: { key: string; name: string } | null;
  gate: Prerequisite[];
  /** The current stage is already satisfied — a sync would move it on. */
  canSync: boolean;
};

export async function listOpportunities(
  tx: Tx, tenantId: string, where: { investorId?: string; ids?: string[] },
): Promise<OpportunityView[]> {
  const conds = [eq(clientOpportunities.tenantId, tenantId)];
  if (where.investorId) conds.push(eq(clientOpportunities.investorId, where.investorId));
  if (where.ids) {
    if (!where.ids.length) return [];
    conds.push(sql`${clientOpportunities.id} IN (${sql.join(where.ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
  }
  const rows = await tx.select().from(clientOpportunities).where(and(...conds))
    .orderBy(sql`CASE WHEN ${clientOpportunities.status} = 'open' THEN 0 ELSE 1 END`, desc(clientOpportunities.createdAt))
    .limit(50);
  if (!rows.length) return [];

  const userIds = [...new Set(rows.flatMap((r) => [r.ownerId, r.coOwnerId]).filter(Boolean) as string[])];
  const names = new Map<string, string>();
  if (userIds.length) {
    const us = (await tx.execute(sql`SELECT id, name FROM users WHERE id IN (${sql.join(userIds.map((u) => sql`${u}::uuid`), sql`, `)})`)).rows as Array<{ id: string; name: string }>;
    for (const u of us) names.set(u.id, u.name.replace(/\s*\([^)]*\)\s*$/, ""));
  }

  const out: OpportunityView[] = [];
  for (const opp of rows) {
    const inst = await ensureInstanceFor(tx, tenantId, "opportunity", opp.id);
    const history = await tx.select().from(blueprintStageHistory)
      .where(eq(blueprintStageHistory.instanceId, inst.id)).orderBy(asc(blueprintStageHistory.enteredAt));
    const stageRow = (await tx.execute(sql`
      SELECT sla_days FROM blueprint_stages WHERE blueprint_id = ${inst.blueprintId}::uuid AND stage_key = ${inst.currentStageKey} LIMIT 1
    `)).rows[0] as { sla_days: number | null } | undefined;

    const path = OPPORTUNITY_PATHS[opp.pipeline as OpportunityPipeline] as string[];
    const cur = inst.currentStageKey;
    const curIdx = cur === "lost" ? path.length : path.indexOf(cur);
    const lastRemark = new Map<string, string | null>();
    for (const h of history) if (h.exitedAt) lastRemark.set(h.stageKey, h.remarks ?? null);

    const stages: StageView[] = path.map((key, i) => {
      if (opp.status === "lost" && !lastRemark.has(key)) return { key, name: stageName(key), status: "upcoming" as const };
      if (key === cur && opp.status !== "won") return { key, name: stageName(key), status: "current" as const };
      if (i < curIdx || lastRemark.has(key) || (opp.status === "won")) {
        const note = lastRemark.get(key) ?? null;
        const status = note?.startsWith("Skipped") ? "skipped" : note?.startsWith("Done automatically") ? "auto" : "done";
        return { key, name: stageName(key), status, note };
      }
      return { key, name: stageName(key), status: "upcoming" as const };
    });

    const next = opp.status === "open" ? nextStage(opp.pipeline as OpportunityPipeline, cur) : null;
    let gate: Prerequisite[] = [];
    let canSync = false;
    if (opp.status === "open") {
      const facts = await loadFacts(tx, opp);
      gate = next ? gateFor(next, opp, facts) : [];
      canSync = cur !== "identified" && cur !== "discussion" && !!skipReason(cur, opp, facts)
        && !(next && gateFor(next, opp, facts).some((p) => !p.satisfied));
    }

    out.push({
      id: opp.id,
      investorId: opp.investorId,
      product: opp.product,
      productLabel: productLabel(opp.product),
      pipeline: opp.pipeline as OpportunityPipeline,
      status: opp.status as OpportunityView["status"],
      expectedValue: opp.expectedValue == null ? null : Number(opp.expectedValue),
      investmentMode: (opp.investmentMode as OpportunityView["investmentMode"]) ?? null,
      source: opp.source,
      ownerId: opp.ownerId,
      ownerName: opp.ownerId ? names.get(opp.ownerId) ?? null : null,
      coOwnerId: opp.coOwnerId,
      coOwnerName: opp.coOwnerId ? names.get(opp.coOwnerId) ?? null : null,
      notes: opp.notes,
      needsAnalysis: opp.needsAnalysis ?? null,
      lostReason: opp.lostReason,
      revisitOn: opp.revisitOn,
      createdAt: opp.createdAt.toISOString(),
      closedAt: (opp.wonAt ?? opp.lostAt)?.toISOString() ?? null,
      current: {
        key: cur, name: stageName(cur), enteredAt: new Date(inst.stageEnteredAt).toISOString(),
        slaDays: stageRow?.sla_days ?? null, delayed: !!inst.isDelayed,
      },
      stages,
      next: next ? { key: next, name: stageName(next as OpportunityStageKey) } : null,
      gate,
      canSync,
    });
  }
  return out;
}
