/**
 * The opportunity journey engine — an existing client wants another product.
 *
 *   createOpportunity   one open row per (client, product); marks the product
 *                       "Interested" on the client's Cross-sell card and gives
 *                       the owner a follow-up task, due on the follow-up date
 *                       picked when it was opened (else in two days).
 *   setFollowUp         move the next follow-up: the open follow-up task's due
 *                       date, or a new task when none is open.
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
 *   → the step after  the client has APPROVED the proposal (it is "accepted");
 *     "Client accepted" until then the journey waits at "Client accepted", and
 *                     moves on by itself the moment the approval arrives.
 *   txn_review        MF only: operations approves or rejects the transaction
 *                     (decideTransaction). Approved → "RTA data check" with a task
 *                     to check the RTA status; rejected → back to "Transaction placed".
 *   → won (MF)        the RTA data check task is completed.
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
 * ── Follow-ups ARE tasks ─────────────────────────────────────────────────
 * An opportunity's "next follow-up" is the earliest open task carrying its id
 * (meta.opportunityId) — not a column. Completing the task clears it, moving
 * the date moves the task, and the list can never disagree with the worklist.
 * An open opportunity with no open task has no follow-up, and says so.
 *
 * ── Later ────────────────────────────────────────────────────────────────
 * A client who wants it but not yet ("after Diwali", "when my FD matures")
 * PARKS it (later.ts): still open, one reminder task ahead of the revisit
 * date. Moving the journey on — by hand, or a proposal being shared — brings
 * it back; closing it ends the wait.
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
import { createNotification } from "@/lib/notifications/create";
import { formatDate, formatMoney } from "@/lib/format";
import {
  isCrossSellProduct, productLabel, productPipeline, proposalTypesFor, type OpportunityPipeline, type OpportunitySource,
} from "./products";
import { AFTER_ACCEPTED, isClosedStage, nextStage, OPPORTUNITY_PATHS, stageName, type OpportunityStageKey } from "./stages";
import { resumeOpportunity } from "./later";
import { INFLOW_SOURCE_LABELS, type InflowSourceType } from "@/db/schema";

export type Actor = { tenantId: string; userId: string };

/** 10:00 India time on a YYYY-MM-DD day — when a follow-up task falls due. */
export const followUpDue = (day: string) => new Date(`${day}T10:00:00+05:30`);
const OPEN_TASK = sql`status IN ('open', 'in_progress', 'blocked')`;

export type Prerequisite = {
  label: string;
  satisfied: boolean;
  hint?: string;
  cta?: { href: string; label: string };
  /** An open task that, once completed, satisfies this prerequisite — the card
   *  offers a "Complete" button for it (the RTA data check). */
  completeTaskId?: string;
};

// "changes_requested" (proposal redesign, migration 0225) is still a shared
// proposal awaiting the RM's revision — it counts as sent.
const PROPOSAL_SENT = new Set(["sent", "viewed", "changes_requested", "accepted", "partially_approved", "executed"]);
const PROPOSAL_ACCEPTED = new Set(["accepted", "partially_approved", "executed"]);
/** History remark that marks a rejected transaction (read back by loadFacts). */
const TXN_REJECTED_PREFIX = "Transaction rejected";
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
  /** MF only: the "RTA data check" task created when the transaction was approved. */
  rtaCheck?: { id: string; status: string } | null;
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
    // A transaction operations rejected does not count again: only one booked
    // after the rejection moves the journey on.
    const rejectedAt = ((await tx.execute(sql`
      SELECT max(h.exited_at) AS at
        FROM blueprint_stage_history h
        JOIN blueprint_instances bi ON bi.id = h.instance_id
       WHERE bi.tenant_id = ${opp.tenantId}::uuid AND bi.subject_type = 'opportunity'
         AND bi.subject_id = ${opp.id}::uuid AND h.stage_key = 'txn_review'
         AND h.remarks LIKE ${TXN_REJECTED_PREFIX + "%"}
    `)).rows[0] as { at: string | Date | null } | undefined)?.at ?? null;
    const afterRejection = rejectedAt ? sql`AND created_at >= ${new Date(rejectedAt).toISOString()}::timestamptz` : sql``;
    const r = (await tx.execute(sql`
      SELECT id, order_date, amount FROM transactions
       WHERE tenant_id = ${opp.tenantId}::uuid AND investor_id = ${opp.investorId}::uuid
         AND type IN ('purchase', 'sip', 'lumpsum') AND direction = 'inflow'
         AND status NOT IN ('rejected', 'cancelled', 'failed')
         AND COALESCE(order_date, created_at::date) >= (${opp.createdAt.toISOString()}::timestamptz AT TIME ZONE 'Asia/Kolkata')::date
         ${afterRejection}
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

  let rtaCheck: Facts["rtaCheck"] = null;
  if (opp.pipeline === "mf") {
    const r = (await tx.execute(sql`
      SELECT id, status FROM tasks
       WHERE tenant_id = ${opp.tenantId}::uuid AND meta ->> 'opportunityId' = ${opp.id}
         AND meta ->> 'rtaCheck' = 'true'
       ORDER BY created_at DESC LIMIT 1
    `)).rows[0] as { id: string; status: string } | undefined;
    if (r) rtaCheck = r;
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
    rtaCheck,
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
  if (AFTER_ACCEPTED.has(target)) {
    const status = f.proposal?.status ?? null;
    return [{
      label: "The client has approved the proposal",
      satisfied: !!status && PROPOSAL_ACCEPTED.has(status),
      hint: !f.proposal ? "No proposal has been shared yet."
        : "Waiting for the client — the journey moves on as soon as they approve it.",
      cta: f.proposal ? { href: `/dashboard/proposals/${f.proposal.id}`, label: "Open proposal" } : undefined,
    }];
  }
  if (target === "won" && opp.pipeline === "mf") {
    return [{
      label: "The RTA data check task is completed",
      satisfied: f.rtaCheck?.status === "completed",
      hint: f.rtaCheck ? "Check the transaction against the RTA data, then complete the task." : "The RTA data check task has not been created yet.",
      // The task itself, not the whole task list.
      cta: f.rtaCheck
        ? { href: `/dashboard/tasks/${f.rtaCheck.id}`, label: "Open task" }
        : { href: "/dashboard/tasks?status=open", label: "Open tasks" },
      completeTaskId: f.rtaCheck && f.rtaCheck.status !== "completed" && f.rtaCheck.status !== "cancelled" ? f.rtaCheck.id : undefined,
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
  /** YYYY-MM-DD — when the owner first follows up. Default: two days from now. */
  followUpOn?: string | null;
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
    dueAt: input.followUpOn ? followUpDue(input.followUpOn) : new Date(Date.now() + 2 * 864e5),
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

/* ───────────────────────────── follow-up ───────────────────────────── */

/**
 * Set the next follow-up of an open opportunity to `day` (YYYY-MM-DD): the
 * earliest open task of the opportunity moves to it, or — when the owner has
 * none open — a new follow-up task is created for them.
 */
export async function setFollowUp(tx: Tx, actor: Actor, opp: ClientOpportunity, day: string) {
  const due = followUpDue(day);
  const [open] = (await tx.execute(sql`
    SELECT id, due_at FROM tasks
     WHERE tenant_id = ${opp.tenantId}::uuid AND meta ->> 'opportunityId' = ${opp.id} AND ${OPEN_TASK}
     ORDER BY due_at ASC NULLS LAST LIMIT 1
  `)).rows as Array<{ id: string; due_at: string | null }>;
  if (open) {
    await tx.update(tasks).set({ dueAt: due, updatedAt: new Date() } as any).where(eq(tasks.id, open.id));
  } else {
    const inv = (await tx.execute(sql`SELECT name FROM investors WHERE id = ${opp.investorId}::uuid`)).rows[0] as { name: string } | undefined;
    await tx.insert(tasks).values({
      tenantId: opp.tenantId, subjectType: "investor", subjectId: opp.investorId, relatedInvestorId: opp.investorId,
      type: "follow_up", title: `${productLabel(opp.product)} — follow up with ${inv?.name ?? "client"}`,
      priority: "normal", status: "open", assigneeId: opp.ownerId ?? actor.userId, dueAt: due, createdById: actor.userId,
      meta: { opportunityId: opp.id },
    } as any);
  }
  await recordAudit(tx, {
    tenantId: opp.tenantId, actorUserId: actor.userId, action: "opportunity.follow_up",
    entityType: "opportunity", entityId: opp.id,
    before: { followUpAt: open?.due_at ?? null }, after: { followUpOn: day },
  } as any);
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

  if (current === "txn_review") {
    return { ok: false, error: "Approve or reject the transaction — approving sends it to the RTA data check.", status: 409 };
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
  // Moving it on means the client is ready: it is no longer waiting.
  if (opp.parkedAt && target !== "won") await resumeOpportunity(tx, actor, opp, { quiet: true });
  if (target === "won") {
    await closeOpportunity(tx, actor, opp, "won");
    if (opp.pipeline === "mf") await createWonTask(tx, actor, opp, "");
    return { ok: true, stage: "won", skipped: [] };
  }
  const { stage, skipped } = await autoSkip(tx, actor, opp, facts, target);
  return { ok: true, stage, skipped };
}

/**
 * Operations' decision on the transaction an MF opportunity placed.
 *
 *   approve  The journey moves to "RTA data check" and a task is created to
 *            check the transaction against the RTA data. The client is won only
 *            once that task is completed (advanceOpportunity → won), which then
 *            creates the "client won, confirm and welcome" task.
 *   reject   A reason is required. The journey goes back to "Transaction
 *            placed" and the owner gets a high-priority task to fix and place
 *            it again; the rejected transaction no longer counts (loadFacts).
 */
export async function decideTransaction(
  tx: Tx, actor: Actor, id: string,
  input: { decision: "approve" | "reject"; remarks?: string; assigneeId?: string; dueOn?: string },
): Promise<{ ok: true; stage: string } | { ok: false; error: string; status: number }> {
  const opp = await loadOpp(tx, actor.tenantId, id);
  if (!opp) return { ok: false, error: "Opportunity not found", status: 404 };
  if (opp.status !== "open") return { ok: false, error: `This opportunity is already ${opp.status}.`, status: 409 };
  const inst = await ensureInstanceFor(tx, actor.tenantId, "opportunity", opp.id);
  if (inst.currentStageKey !== "txn_review") {
    return { ok: false, error: "There is no transaction waiting for approval on this opportunity.", status: 409 };
  }
  const remarks = input.remarks?.trim() || "";
  const inv = (await tx.execute(sql`SELECT name FROM investors WHERE id = ${opp.investorId}::uuid`)).rows[0] as { name: string } | undefined;
  const clientName = inv?.name ?? "client";
  const product = productLabel(opp.product);
  const base = {
    tenantId: opp.tenantId, subjectType: "investor", subjectId: opp.investorId, relatedInvestorId: opp.investorId,
    type: "follow_up", status: "open", assigneeId: opp.ownerId ?? actor.userId, createdById: actor.userId,
  };

  if (input.decision === "reject") {
    if (!remarks) return { ok: false, error: "Say why the transaction was rejected.", status: 400 };
    const r = await transitionPoly(tx, actor.tenantId, "opportunity", opp.id, "mf_transaction", {
      actorUserId: actor.userId, remarks: `${TXN_REJECTED_PREFIX} — ${remarks}`, finalStatus: "in_progress",
    });
    if (!r.ok) return { ok: false, error: (r as any).reason ?? "Could not reject", status: 409 };
    await tx.insert(tasks).values({
      ...base, title: `${product} transaction rejected — fix and place again for ${clientName}`, description: remarks,
      priority: "high", dueAt: new Date(Date.now() + 864e5), meta: { opportunityId: opp.id, transactionRejected: true },
    } as any);
    await recordAudit(tx, {
      tenantId: opp.tenantId, actorUserId: actor.userId, action: "opportunity.transaction_rejected",
      entityType: "opportunity", entityId: opp.id, after: { reason: remarks },
    } as any);
    return { ok: true, stage: "mf_transaction" };
  }

  const r = await transitionPoly(tx, actor.tenantId, "opportunity", opp.id, "rta_check", {
    actorUserId: actor.userId, remarks: remarks ? `Transaction approved — ${remarks}` : "Transaction approved",
    finalStatus: "in_progress",
  });
  if (!r.ok) return { ok: false, error: (r as any).reason ?? "Could not approve", status: 409 };
  // The task that gates "won": it carries opportunityId so it shows as the next follow-up.
  // Assigned to whoever the approver picked (default: the opportunity's owner), due the day they chose.
  const assignee = input.assigneeId || base.assigneeId;
  const dueAt = input.dueOn ? followUpDue(input.dueOn) : new Date(Date.now() + 864e5);
  await tx.insert(tasks).values({
    ...base, assigneeId: assignee, title: `RTA data check — ${clientName}, ${product}: confirm the transaction in the RTA data`,
    description: "Check the transaction / RTA status (CAMS or KFintech). Complete this task to mark the opportunity won.",
    priority: "high", dueAt, meta: { opportunityId: opp.id, rtaCheck: true },
  } as any);
  if (assignee && assignee !== actor.userId) {
    await createNotification(tx, {
      tenantId: opp.tenantId, userId: assignee, kind: "task.assigned",
      title: `RTA data check — ${clientName}, ${product}`,
      body: `Check the transaction against the RTA data · due ${formatDate(dueAt.toISOString(), "dayMonth")}`,
      linkUrl: `/dashboard/opportunities/${opp.id}`, severity: "info",
      meta: { opportunity_id: opp.id, assigned_by: actor.userId },
    });
  }
  await recordAudit(tx, {
    tenantId: opp.tenantId, actorUserId: actor.userId, action: "opportunity.transaction_approved",
    entityType: "opportunity", entityId: opp.id, after: { remarks: remarks || null },
  } as any);
  return { ok: true, stage: "rta_check" };
}

/**
 * The "client won" task: created once the opportunity is won, so it carries
 * meta.wonOpportunityId (not opportunityId) and stays open after the close.
 */
async function createWonTask(tx: Tx, actor: Actor, opp: ClientOpportunity, remarks: string) {
  const inv = (await tx.execute(sql`SELECT name FROM investors WHERE id = ${opp.investorId}::uuid`)).rows[0] as { name: string } | undefined;
  await tx.insert(tasks).values({
    tenantId: opp.tenantId, subjectType: "investor", subjectId: opp.investorId, relatedInvestorId: opp.investorId,
    type: "follow_up", status: "open", assigneeId: opp.ownerId ?? actor.userId, createdById: actor.userId,
    title: `${inv?.name ?? "Client"} won — ${productLabel(opp.product)}: confirm the allotment and welcome the client`,
    description: remarks || null, priority: "normal", dueAt: new Date(Date.now() + 864e5),
    meta: { wonOpportunityId: opp.id },
  } as any);
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
    ? { status: "won", wonAt: now, parkedAt: null, updatedAt: now }
    : { status: "lost", lostAt: now, lostReason: extra.lostReason ?? null, revisitOn: extra.revisitOn || null, parkedAt: null, updatedAt: now },
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

  // A proposal shared or accepted: the client is engaging again.
  if (opp.parkedAt) await resumeOpportunity(tx, actor, opp, { quiet: true });

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
  /** The earliest open task of the opportunity — its next follow-up. */
  followUpAt: string | null;
  /** Parked: the client wants it, but later (later.ts). Null when active. */
  later: null | {
    since: string;
    revisitOn: string;
    reason: string | null;
    /** Times it has been put off. */
    count: number;
    /** The money it waits for. */
    money: { sourceType: string; label: string; amount: number | null; expectedOn: string; status: string } | null;
  };
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

  // Next follow-up per opportunity: its earliest open task (see the header).
  const followUps = new Map<string, string>();
  const fu = (await tx.execute(sql`
    SELECT meta ->> 'opportunityId' AS oid, min(due_at) AS due FROM tasks
     WHERE tenant_id = ${tenantId}::uuid AND ${OPEN_TASK} AND due_at IS NOT NULL
       AND meta ->> 'opportunityId' IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})
     GROUP BY 1
  `)).rows as Array<{ oid: string; due: string | Date }>;
  for (const r of fu) followUps.set(r.oid, new Date(r.due).toISOString());

  // The money a parked opportunity waits for.
  const inflowIds = rows.map((r) => r.expectedInflowId).filter(Boolean) as string[];
  const inflows = new Map<string, { source_type: string; expected_amount: string | null; expected_on: string; status: string }>();
  if (inflowIds.length) {
    const rs = (await tx.execute(sql`
      SELECT id, source_type, expected_amount, expected_on::text AS expected_on, status FROM expected_inflows
       WHERE tenant_id = ${tenantId}::uuid AND id IN (${sql.join(inflowIds.map((i) => sql`${i}::uuid`), sql`, `)})
    `)).rows as Array<{ id: string; source_type: string; expected_amount: string | null; expected_on: string; status: string }>;
    for (const r of rs) inflows.set(r.id, r);
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
      followUpAt: opp.status === "open" ? followUps.get(opp.id) ?? null : null,
      later: opp.status === "open" && opp.parkedAt && opp.revisitOn
        ? {
            since: opp.parkedAt.toISOString(),
            revisitOn: opp.revisitOn,
            reason: opp.parkedReason,
            count: opp.parkCount ?? 0,
            money: (() => {
              const m = opp.expectedInflowId ? inflows.get(opp.expectedInflowId) : undefined;
              return m
                ? {
                    sourceType: m.source_type,
                    label: INFLOW_SOURCE_LABELS[m.source_type as InflowSourceType] ?? "Money",
                    amount: m.expected_amount == null ? null : Number(m.expected_amount),
                    expectedOn: m.expected_on,
                    status: m.status,
                  }
                : null;
            })(),
          }
        : null,
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
