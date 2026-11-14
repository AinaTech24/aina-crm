import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/[id]/blueprint/advance
 *   Body: { toStageKey: string, remarks?: string }
 *
 * Drives the lead through the formal blueprint.
 *
 * Multi-hop forward jumps: the canonical transition graph only defines
 * adjacent transitions (stage N → N+1). If the user picks a stage that
 * is several steps ahead, we walk through each intermediate transition
 * automatically — each hop writes its own stage_history row so the audit
 * trail records the full path. Side-effect: smart-advance auto-fires for
 * every intermediate stage's on-enter recipes too.
 *
 * Backwards moves and sideways branches are still subject to the
 * transition graph (and the role gate).
 *
 * Who may move it: journey-access.ts — the lead's rule in the lead phase, the
 * CLIENT's rule (current RM, client editors, compliance on KYC steps,
 * operations on theirs) in the client phase. `force` (the boards' drag) is
 * limited to lead-phase targets for RMs; client steps only for managers and
 * operations; a converted lead never goes back to a lead stage. Every path —
 * direct, walk, force — runs the same step side effects
 * (stage-side-effects.ts) and, for KYC Validated, needs evidence.
 * `reopen` (owner only, audited) reopens a completed journey.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql, eq, and } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { checkPrerequisites } from "@/lib/blueprints/prerequisites";
import { authorizeJourneyMove } from "@/lib/blueprints/journey-access";
import { kycValidationBlock, runStageSideEffects } from "@/lib/blueprints/stage-side-effects";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { clientMetaFromHeaders } from "@/lib/audit";
import { transitionTo } from "@/lib/blueprints/engine";
import { leads } from "@/db/schema";
import {
  normalizeEmail,
  normalizeLeadSource,
  normalizeLeadStage,
  normalizePan,
  normalizePhoneLast10,
} from "@/lib/leads/normalize";

export const dynamic = "force-dynamic";

const Body = z.object({
  toStageKey: z.string().min(2).max(60),
  remarks: z.string().max(2000).optional(),
  /**
   * Admin-override move. When true, skip the SOP graph check and any
   * multi-hop walk — just stamp the lead at the target stage directly.
   * Set by the Kanban drag-drop (explicit user intent, no need for the
   * SOP to enforce a path). The guided action buttons leave it false so
   * the SOP prereq gates still run.
   */
  force: z.boolean().optional(),
  /** Reopen a COMPLETED journey (Active Client / Policy Issued) to this step.
   *  Owner only; audited. */
  reopen: z.boolean().optional(),
  fields: z.record(z.string(), z.any()).optional(),
  /** ISO/local datetime — when moving to "call_back_later", schedules a
   *  reminder task for the lead owner at this time. */
  callBackAt: z.string().optional(),
  /** When moving to "ucc_activated", store this UCC on the client (investor). */
  uccNumber: z.string().max(40).optional(),
  /** When moving to "mandate_activated", record the active mandate on the
   *  client: which bank it's on, the max debit amount, and the approval ref. */
  mandateBank: z.string().max(140).optional(),
  mandateIfsc: z.string().max(20).optional(),
  mandateAccountMasked: z.string().max(40).optional(),
  mandateAmount: z.number().nonnegative().optional(),
  mandateRef: z.string().max(60).optional(),
  /** The step's task in the Tasks module (the engine creates it): who it goes
   *  to, when it is due, and its wording. All optional. */
  task: z
    .object({
      assigneeId: z.string().uuid().optional(),
      dueAt: z.string().optional(),
      title: z.string().max(300).optional(),
      description: z.string().max(2000).optional(),
      type: z.string().max(60).optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // Ownership / capability: authorizeJourneyMove (lead rule in the lead
    // phase, the client's rule in the client phase).
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { remarks, force, fields, callBackAt, uccNumber, mandateBank, mandateIfsc, mandateAccountMasked, mandateAmount, mandateRef } = parsed.data;
    const journeyTask = parsed.data.task
      ? { ...parsed.data.task, dueAt: parsed.data.task.dueAt && !isNaN(new Date(parsed.data.task.dueAt).getTime()) ? new Date(parsed.data.task.dueAt) : undefined }
      : undefined;

    // Validate the target stage. normalizeLeadStage() falls back to "new" for
    // unrecognized input — detect that silent coercion and 400, instead of
    // (under force) stamping the lead backward to stage 1.
    const toStageKey = normalizeLeadStage(parsed.data.toStageKey);
    const rawKey = parsed.data.toStageKey.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (toStageKey === "new" && rawKey !== "new") {
      return NextResponse.json({ error: `Unknown stage "${parsed.data.toStageKey}"` }, { status: 400 });
    }

    const clientMeta = clientMetaFromHeaders(req.headers);

    const sideInput = {
      callBackAt,
      uccNumber,
      mandate: {
        bank: mandateBank?.trim() || undefined,
        ifsc: mandateIfsc?.trim() || undefined,
        masked: mandateAccountMasked?.trim() || undefined,
        amount: mandateAmount,
        ref: mandateRef?.trim() || undefined,
      },
    };

    const res = await withTenant(session.tenantId, async (tx) => {
      const subject = await authorizeJourneyMove(tx, session, id, toStageKey, { force: !!force });

      // Reopening a completed journey is an owner's decision, on the record.
      const reopen = !!parsed.data.reopen;
      if (reopen) {
        if (!session.roles.includes("owner")) {
          throw Object.assign(new Error("Only the firm owner can reopen a completed onboarding journey."), { status: 403 });
        }
      }

      // KYC Validated is the KYC record: it needs evidence and never
      // overrides a KRA hold or rejection — on every path, forced included.
      if (toStageKey === "kyc_validated" && subject.currentKey !== "kyc_validated") {
        const block = await kycValidationBlock(tx, session.tenantId, id);
        if (block) return { ok: false as const, code: "prereq" as const, reason: block };
      }

      // Update any required fields collected during the transition
      const safeFields = sanitizeLeadFields(fields);
      if (Object.keys(safeFields).length > 0 && !subject.converted) {
        await tx
          .update(leads)
          .set({
            ...safeFields,
            updatedAt: new Date(),
          })
          .where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId)));
      }

      const done = async <T extends { ok: boolean; toStage?: string }>(r: T): Promise<T> => {
        if (r.ok) {
          await runStageSideEffects(tx, { tenantId: session.tenantId, leadId: id, stageKey: toStageKey, actorUserId: session.userId }, sideInput);
          if (reopen && subject.instanceStatus === "completed") {
            await recordAudit(tx, {
              tenantId: session.tenantId,
              actorUserId: session.userId,
              action: "lead.blueprint.reopen",
              entityType: "lead",
              entityId: id,
              before: { stage: subject.currentKey, status: "completed" },
              after: { stage: toStageKey, status: "in_progress" },
              reason: remarks ?? null,
              ...clientMeta,
            });
          }
        }
        return r;
      };

      // Force mode — (e.g. Kanban drag). Skip the SOP graph and just move
      // directly. No walk, no intermediate history rows. The move is
      // audit-logged (forced=true) by transitionTo; the step's own writes
      // still happen.
      if (force || reopen) {
        return done(await transitionTo(tx, session.tenantId, id, toStageKey, {
          actorUserId: session.userId,
          actorRoles: session.roles ?? [],
          remarks: remarks ?? (reopen ? "Completed journey reopened by the owner." : `Forced move via Kanban drag.`),
          systemBypass: true,
          allowReopen: reopen,
          task: journeyTask,
          ...clientMeta,
        }));
      }

      // 1. Try the direct one-hop transition first — the cheap path.
      const first = await transitionTo(tx, session.tenantId, id, toStageKey, {
        actorUserId: session.userId,
        actorRoles: session.roles ?? [],
        remarks,
        task: journeyTask,
        ...clientMeta,
      });
      if (first.ok) return done(first);
      // Don't let the multi-hop walk silently bypass a prerequisite / role /
      // terminal block from the direct hop — surface it so the user fixes it.
      if (first.code === "prereq" || first.code === "role" || first.code === "terminal") return first;

      // 2. No direct transition. If the target stage is forward in the
      //    canonical order, walk hop-by-hop along the **happy path**
      //    (skipping dead-end branches like not_qualified, call-back
      //    loops, and retry stages) so multi-step jumps stay on the
      //    main SOP rail.
      const HAPPY_PATH = [
        "new",
        "call_done",
        "meeting_scheduled",
        "meeting_done",
        "won_lead",
        "request_documents",
        "documents_pending",
        "documents_received",
        "kyc_validated",
        "ucc_create",
        "ucc_activated",
        "mandate_create",
        "mandate_activated",
        "make_transaction",
        "transaction_successful",
        "family_mapping",
        "update_information",
        "add_in_review_sheet",
      ];
      const targetIdx = HAPPY_PATH.indexOf(toStageKey);
      if (targetIdx < 0) return first; // off-path target (e.g. kyc_pending) — keep original error

      // Look up the lead's current stage to compute distance.
      const currentKey = subject.currentKey;
      const currentIdx = currentKey ? HAPPY_PATH.indexOf(currentKey) : -1;
      if (currentIdx < 0 || targetIdx <= currentIdx) {
        // Current stage isn't on the happy path, or move is backwards/unchanged.
        // Return the original error — caller can retry with force=true.
        return first;
      }

      // The walk's hops skip the graph, but the TARGET's own checks still
      // apply: it must be as ready as a direct move would need it to be.
      const finalCheck = await checkPrerequisites(tx, session.tenantId, id, toStageKey);
      if (!finalCheck.ok) {
        const missing = finalCheck.items.filter((i) => !i.satisfied).map((i) => i.label).join("; ");
        return { ok: false as const, code: "prereq" as const, reason: `Complete these first: ${missing}` };
      }

      // Walking THROUGH KYC Validated makes the same claim as stopping there.
      const kycIdx = HAPPY_PATH.indexOf("kyc_validated");
      const passesKyc = currentIdx < kycIdx && kycIdx < targetIdx;
      if (passesKyc) {
        const block = await kycValidationBlock(tx, session.tenantId, id);
        if (block) return { ok: false as const, code: "prereq" as const, reason: block };
      }

      // Walk forward along the happy path. Each hop uses systemBypass so
      // the intermediate transitions don't need to be defined in the graph.
      // Intermediate hops suppress their on-enter/on-exit automations — a stage
      // the lead only passes THROUGH shouldn't fire its recipes; only the final
      // target stage does.
      let last = first;
      for (let i = currentIdx + 1; i <= targetIdx; i++) {
        const nextKey = HAPPY_PATH[i];
        const isFinal = i === targetIdx;
        last = await transitionTo(tx, session.tenantId, id, nextKey, {
          actorUserId: session.userId,
          actorRoles: session.roles ?? [],
          remarks: isFinal ? remarks : `Auto-skipped en route to ${toStageKey}`,
          systemBypass: true,
          suppressAutomations: !isFinal,
          task: isFinal ? journeyTask : undefined,
          ...clientMeta,
        });
        if (!last.ok) return last;
      }
      if (passesKyc) {
        await runStageSideEffects(tx, { tenantId: session.tenantId, leadId: id, stageKey: "kyc_validated", actorUserId: session.userId }, {});
      }
      return done(last);
    });

    if (!res.ok) {
      return NextResponse.json({ error: res.reason, code: res.code ?? null }, { status: 409 });
    }
    return NextResponse.json(res);
  } catch (err: any) {
    return handleApiError(err);
  }
}

function sanitizeLeadFields(fields?: Record<string, any>) {
  if (!fields) return {};
  const out: Record<string, any> = {};
  if (typeof fields.name === "string") out.name = fields.name.trim();
  if (typeof fields.email === "string") {
    out.email = fields.email.trim() || null;
    out.emailNormalized = normalizeEmail(fields.email);
  }
  if (typeof fields.phone === "string") {
    out.phone = fields.phone.trim() || null;
    out.phoneNormalized = normalizePhoneLast10(fields.phone);
  }
  if (typeof fields.pan === "string") out.pan = normalizePan(fields.pan);
  if (typeof fields.city === "string") out.city = fields.city.trim() || null;
  if (typeof fields.pincode === "string") out.pincode = fields.pincode.trim() || null;
  if (typeof fields.intendedAmount === "string" || typeof fields.intendedAmount === "number") {
    out.intendedAmount = String(fields.intendedAmount).trim() || null;
  }
  if (typeof fields.source === "string") out.source = normalizeLeadSource(fields.source);
  if (typeof fields.nextFollowUpAt === "string") out.nextFollowUpAt = new Date(fields.nextFollowUpAt);
  if (typeof fields.lostReason === "string") out.lostReason = fields.lostReason.trim() || null;
  if (typeof fields.lostAt === "string") out.lostAt = new Date(fields.lostAt);
  return out;
}
