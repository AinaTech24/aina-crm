import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/bulk — apply one action to many leads at once.
 *
 * Body: { ids: string[], action, value? }
 *   action = "assign"     value = ownerId (uuid) | null   → reassign RM
 *          = "follow_up"  value = ISO date string         → set next follow-up
 *          = "stage"      value = stage key               → move stage
 *          = "lost"       value = lost reason (optional)  → mark Lost
 *          = "delete"     (no value)                      → soft-delete (restorable)
 *
 * Every id goes through the caller's EDIT scope first (loadEditableLead: own
 * leads, a branch head's branch, the firm for a lead manager) — an id outside
 * it is skipped and reported, never touched (audit L4). Then each action runs
 * the same code as its single-lead version:
 *   - stage / lost: through the journey (writeStageThroughJourney — the same
 *     access rule, step writes and lost side effects as the board); a move the
 *     journey refuses is skipped with its reason;
 *   - lost / delete: the lead's follow-up and call-back tasks close
 *     (closeLeadTasks); delete is lib/leads/lifecycle.ts softDeleteLead;
 *   - assign: owner and branch move together, the lead's follow-ups go to the
 *     new owner and they are notified (lib/leads/ownership.ts reassignLead).
 * Audited as one bulk action plus each lead's own record.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { leads, eventsOutbox } from "@/db/schema";
import { scoreFields } from "@/lib/leads/score";
import { CANONICAL_LEAD_STAGES } from "@/lib/leads/normalize";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { loadEditableLead } from "@/lib/leads/access";
import { writeStageThroughJourney } from "@/lib/blueprints/journey-access";
import { activeMember, reassignLead } from "@/lib/leads/ownership";
import { softDeleteLead } from "@/lib/leads/lifecycle";
import { closeLeadTasks } from "@/lib/leads/open-tasks";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["assign", "follow_up", "stage", "lost", "delete"]),
  value: z.string().nullable().optional(),
});

type Skip = { id: string; reason: string };

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // A manager-level action; each id is still checked against the caller's
    // own edit scope below.
    requireCap(session.roles, "lead.edit.all", session.permissions);
    // A lapsed tenant must not be able to mutate the pipeline in bulk.
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { action, value } = parsed.data;
    const ids = [...new Set(parsed.data.ids)];
    const meta = clientMetaFromHeaders(req.headers);

    let ownerId: string | null = null;
    let followUpAt: Date | null = null;
    if (action === "assign" && value) {
      if (!UUID_RE.test(value)) return NextResponse.json({ error: "assign value must be a user id" }, { status: 400 });
      ownerId = value;
    }
    if (action === "follow_up") {
      if (!value) return NextResponse.json({ error: "value (date) required" }, { status: 400 });
      followUpAt = new Date(value);
      if (Number.isNaN(followUpAt.getTime())) return NextResponse.json({ error: "value must be a date" }, { status: 400 });
    }
    if (action === "stage") {
      if (!value) return NextResponse.json({ error: "value (stage) required" }, { status: 400 });
      // Only canonical stage keys: an arbitrary value would break the column check.
      if (!(CANONICAL_LEAD_STAGES as readonly string[]).includes(value)) {
        return NextResponse.json({ error: "invalid stage" }, { status: 400 });
      }
    }
    const lostReason = action === "lost" ? (value || "Bulk-marked lost") : null;

    const out = await withTenant(session.tenantId, async (tx) => {
      // The target must be an active team member of this firm.
      if (ownerId && !(await activeMember(tx, session.tenantId, ownerId))) return "bad_owner" as const;

      const done: string[] = [];
      const skipped: Skip[] = [];
      for (const id of ids) {
        // Each lead in its own savepoint: one refusal never undoes the others.
        try {
          await tx.transaction(async (sp) => {
            const lead = await loadEditableLead(sp as any, session, id);
            if (lead.lostReason === "__deleted__" && action !== "delete") throw Object.assign(new Error("The lead is deleted."), { status: 409 });
            switch (action) {
              case "assign": {
                await reassignLead(sp as any, { tenantId: session.tenantId, leadId: id, toOwnerId: ownerId, actorUserId: session.userId });
                break;
              }
              case "follow_up": {
                await sp.update(leads).set({ nextFollowUpAt: followUpAt, updatedAt: new Date() } as any)
                  .where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId)));
                break;
              }
              case "stage":
              case "lost": {
                const target = action === "lost" ? "not_qualified" : value!;
                const moved = await writeStageThroughJourney(sp as any, session, id, target, {
                  remarks: action === "lost" ? `Bulk-marked lost: ${lostReason}` : "Bulk stage change.",
                  ...meta,
                });
                if (!moved.ok) throw Object.assign(new Error(moved.reason ?? "The journey refused this move."), { status: 409 });
                if (action === "lost") {
                  await sp.update(leads).set({ lostReason, lostAt: new Date(), updatedAt: new Date() } as any)
                    .where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId)));
                  await closeLeadTasks(sp as any, session.tenantId, id, { reason: `Lead marked lost: ${lostReason}.` });
                }
                break;
              }
              case "delete": {
                await softDeleteLead(sp as any, { tenantId: session.tenantId, actorUserId: session.userId, lead, source: "bulk" }, meta);
                break;
              }
            }
          });
          done.push(id);
        } catch (e: any) {
          const status = Number(e?.status ?? 500);
          if (status >= 500) throw e;
          skipped.push({
            id,
            reason: status === 403 || status === 404 ? "Not in your leads" : String(e?.message ?? "Not changed"),
          });
        }
      }

      // Re-score where a scoring input moved (stage, lost, follow-up momentum).
      if (done.length && (action === "stage" || action === "lost" || action === "follow_up")) {
        const rows = await tx.select().from(leads).where(inArray(leads.id, done));
        for (const l of rows) {
          const sf = scoreFields({
            source: l.source, stage: l.stage, intendedAmount: l.intendedAmount, lastContactAt: l.lastContactAt,
            nextFollowUpAt: l.nextFollowUpAt, stageChangedAt: l.stageChangedAt, email: l.email, phone: l.phone,
            pan: l.pan, interestProducts: l.interestProducts,
          });
          await tx.update(leads).set(sf as any).where(eq(leads.id, l.id));
        }
      }

      // lead.updated per changed lead so workflow rules fire on bulk changes
      // too (delete emitted lead.deleted in softDeleteLead).
      if (done.length && action !== "delete") {
        const finalRows = await tx.select().from(leads).where(inArray(leads.id, done));
        await tx.insert(eventsOutbox).values(
          finalRows.map((l) => ({
            tenantId: session.tenantId,
            kind: "lead.updated",
            entityType: "lead",
            entityId: l.id,
            after: l as any,
            meta: { userId: session.userId, source: `bulk_${action}` } as any,
          })) as any
        );
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `lead.bulk_${action}`,
        entityType: "lead",
        entityId: session.tenantId,
        after: { action, value: value ?? null, count: done.length, ids: done, skipped } as any,
        ...meta,
      });
      return { updated: done.length, skipped };
    });

    if (out === "bad_owner") return NextResponse.json({ error: "selected owner is not an active user in this firm" }, { status: 400 });
    return NextResponse.json({ ok: true, updated: out.updated, skipped: out.skipped.length, skippedLeads: out.skipped });
  } catch (err: any) {
    return handleApiError(err);
  }
}
