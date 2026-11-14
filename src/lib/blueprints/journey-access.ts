/**
 * Who may move a journey step by hand (audit C4 / L10).
 *
 * The lead phase belongs to the LEAD: whoever may edit the lead moves it
 * (loadEditableLead). The client phase belongs to the CLIENT the lead became:
 * the client's current RM, anyone who may edit that client
 * (investor.edit.all / .assigned + their book), compliance on the KYC steps,
 * operations / back office on theirs — never "whoever owned the lead", which
 * locked a new RM out after a hand-over and let a former owner keep moving a
 * client they can no longer see.
 *
 * Forced moves (the boards' drag and drop, which skips the graph and the
 * checks): any lead-phase target for someone who may edit the lead; a
 * client-phase target only for managers and operations. A converted lead is
 * never moved back into the lead phase, by anyone.
 */

import { and, eq, sql } from "drizzle-orm";
import { leads } from "@/db/schema";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { loadEditableLead, loadViewableLead } from "@/lib/leads/access";
import { loadViewableInvestor } from "@/lib/investors/access";
import { normalizeLeadStage } from "@/lib/leads/normalize";
import { LEAD_TO_CLIENT_STAGES } from "./lead_to_client";
import { isClientPhaseStage } from "./journey-rules";
import { ensureInstance, transitionTo } from "./engine";
import { kycValidationBlock, runStageSideEffects } from "./stage-side-effects";

const OWNER_ROLE = new Map(LEAD_TO_CLIENT_STAGES.map((s) => [s.key, s.ownerRole] as const));

const err = (status: number, message: string) => Object.assign(new Error(message), { status });

/** Managers and operations — the people allowed to force a client step. */
export function canForceClientMove(session: SessionUser): boolean {
  return (
    session.roles.some((r) => ["owner", "branch_head", "ops", "back_office"].includes(r)) ||
    can(session.roles, "investor.edit.all", session.permissions)
  );
}

/** The step's own desk may act on it: compliance on KYC steps, operations /
 *  back office on theirs. */
function ownsStep(session: SessionUser, stageKey: string): boolean {
  const role = OWNER_ROLE.get(stageKey);
  if (role === "compliance") return session.roles.includes("compliance");
  if (role === "back_office" || role === "operations") return session.roles.some((r) => r === "ops" || r === "back_office");
  return false;
}

export interface JourneySubject {
  leadId: string;
  /** The client the journey is about, when there is one. */
  investorId: string | null;
  converted: boolean;
  currentKey: string;
  instanceStatus: string | null;
}

async function currentOf(tx: Tx, tenantId: string, id: string, fallback: string) {
  const r = (await tx.execute(sql`
    SELECT current_stage_key, status FROM lead_blueprint_instances
     WHERE lead_id = ${id}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
  `)).rows[0] as { current_stage_key?: string; status?: string } | undefined;
  return { key: r?.current_stage_key ?? fallback, status: r?.status ?? null };
}

/**
 * Load and authorise the journey `id` (a lead id, or a client id for a
 * journey whose subject is a client) for a hand move to `targetKey`.
 * Throws 403 / 404 like the loaders do.
 */
export async function authorizeJourneyMove(
  tx: Tx,
  session: SessionUser,
  id: string,
  targetKey: string,
  opts: { force?: boolean } = {},
): Promise<JourneySubject> {
  const leadRow = (await tx.execute(sql`
    SELECT id, stage, converted_investor_id FROM leads
     WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid LIMIT 1
  `)).rows[0] as { id: string; stage: string | null; converted_investor_id: string | null } | undefined;

  const investorId = leadRow ? leadRow.converted_investor_id : id;
  const converted = !leadRow || !!leadRow.converted_investor_id;
  const cur = await currentOf(tx, session.tenantId, id, normalizeLeadStage(leadRow?.stage ?? "new"));
  const clientMove = isClientPhaseStage(targetKey) || isClientPhaseStage(cur.key);

  if (converted && !isClientPhaseStage(targetKey)) {
    throw err(409, "This lead is a client now — its journey cannot go back to a lead stage.");
  }

  if (leadRow && (!clientMove || !investorId)) {
    // Lead phase (or a lead not converted yet): the lead's own rule.
    await loadEditableLead(tx, session, id);
  } else {
    // Client phase: the client's rule.
    const inv = investorId ? await loadViewableInvestor(tx, session, investorId).catch(() => null) : null;
    if (!inv) throw err(404, "Client not found");
    const editsClient =
      can(session.roles, "investor.edit.all", session.permissions) ||
      (can(session.roles, "investor.edit.assigned", session.permissions) && inv.rmId === session.userId);
    if (!editsClient && !ownsStep(session, targetKey)) {
      throw err(403, "You can't move this client's onboarding. Their relationship manager, operations or compliance (KYC steps) can.");
    }
  }

  if (opts.force) {
    if (isClientPhaseStage(targetKey) && !canForceClientMove(session)) {
      throw err(403, "Only a manager or operations can force a client onboarding step. Use the step's own action instead.");
    }
    if (!isClientPhaseStage(targetKey) && isClientPhaseStage(cur.key) && !canForceClientMove(session)) {
      throw err(403, "Only a manager can move an onboarding journey back to a lead stage.");
    }
  }

  return { leadId: id, investorId: investorId ?? null, converted, currentKey: cur.key, instanceStatus: cur.status };
}

/**
 * A stage chosen as a FIELD (the lead form's stage, POST /api/leads/[id]/stage)
 * goes through the journey, so the board (leads.stage) and the stepper (the
 * journey instance) never disagree (audit L9). It is a person's explicit
 * choice, so it moves like a forced move: the same access rule, the same
 * step writes, KYC evidence for KYC Validated.
 */
export async function writeStageThroughJourney(
  tx: Tx,
  session: SessionUser,
  leadId: string,
  stageKey: string,
  meta: { remarks?: string; ipAddress?: string | null; userAgent?: string | null } = {},
) {
  const subject = await authorizeJourneyMove(tx, session, leadId, stageKey, { force: true });
  if (stageKey === "kyc_validated" && subject.currentKey !== "kyc_validated") {
    const block = await kycValidationBlock(tx, session.tenantId, leadId);
    if (block) return { ok: false as const, code: "prereq" as const, reason: block };
  }
  const r = await transitionTo(tx, session.tenantId, leadId, stageKey, {
    actorUserId: session.userId,
    actorRoles: session.roles ?? [],
    systemBypass: true,
    remarks: meta.remarks ?? "Stage set on the lead record.",
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });
  if (r.ok) {
    await runStageSideEffects(tx, { tenantId: session.tenantId, leadId, stageKey, actorUserId: session.userId }, {});
  }
  return r;
}

/** An imported / created lead that starts past "New": open its journey AT
 *  that stage (no recipes fire for a row that was only imported). */
export async function startJourneyAt(tx: Tx, tenantId: string, leadId: string, stageKey: string, actorUserId?: string | null) {
  await ensureInstance(tx, tenantId, leadId);
  if (stageKey === "new") return { ok: true as const };
  return transitionTo(tx, tenantId, leadId, stageKey, {
    actorUserId: actorUserId ?? undefined,
    systemBypass: true,
    suppressAutomations: true,
    remarks: "Imported at this stage.",
  });
}

/**
 * Load a lead for READING its journey: the lead's own rule, or — once it is a
 * client — the client's (current RM, branch head, firm), so the onboarding
 * bar shows for whoever may see the client (audit C4). Null when neither.
 */
export async function loadJourneyLeadForView(tx: Tx, session: SessionUser, leadId: string) {
  const own = await loadViewableLead(tx, session, leadId).catch(() => null);
  if (own) return own;
  const [row] = await tx.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.tenantId, session.tenantId))).limit(1);
  if (!row?.convertedInvestorId) return null;
  const client = await loadViewableInvestor(tx, session, row.convertedInvestorId).catch(() => null);
  return client ? row : null;
}
