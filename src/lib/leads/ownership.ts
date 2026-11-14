/**
 * Who owns a lead, and what follows the owner (audit L12, L13, L14).
 *
 *   - A lead's BRANCH is its owner's branch, on every write: the New lead
 *     form, the mobile app, the CSV import, a public lead form, and every
 *     reassignment (single and bulk). A branch head therefore sees exactly
 *     the leads their branch's people own — the rule the dashboards count by.
 *   - A new lead with no owner chosen goes through the firm's Assignment
 *     Rules, then the built-in least-loaded pick (lib/leads/assign.ts).
 *   - The owner is TOLD: every assignment, on every path, notifies them
 *     (`lead.assigned`), except when they gave it to themselves.
 *   - A reassignment moves the lead's open follow-up / call-back tasks to
 *     the new owner, so the work goes with the lead instead of staying in the
 *     old owner's queue.
 *
 * Callers are inside withTenant (RLS scopes every read and write).
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { createNotification } from "@/lib/notifications/create";
import { pickAssignee } from "@/lib/assignment/engine";
import { pickRmForNewLead } from "./assign";

/** The owner's branch (null for a user with none, or no owner). */
export async function ownerBranchId(tx: Tx, tenantId: string, ownerId: string | null | undefined): Promise<string | null> {
  if (!ownerId) return null;
  const r = await tx.execute(sql`
    SELECT branch_id::text AS b FROM users WHERE id = ${ownerId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
  `);
  return ((r.rows[0] as { b?: string | null } | undefined)?.b) ?? null;
}

/** An active team member of this firm, by id — the only kind a lead may be given to. */
export async function activeMember(
  tx: Tx, tenantId: string, userId: string,
): Promise<{ id: string; branchId: string | null } | null> {
  const r = await tx.execute(sql`
    SELECT id::text AS id, branch_id::text AS branch_id FROM users
     WHERE id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'active' LIMIT 1
  `);
  const row = r.rows[0] as { id: string; branch_id: string | null } | undefined;
  return row ? { id: row.id, branchId: row.branch_id } : null;
}

/**
 * An owner for a new lead nobody chose one for: the firm's Assignment Rules,
 * else the least-loaded RM (in `branchId` when given), else null.
 */
export async function autoAssignLeadOwner(
  tx: Tx,
  opts: { tenantId: string; source?: string | null; branchId?: string | null; excludeUserId?: string | null },
): Promise<string | null> {
  const rulePick = await pickAssignee(tx, { tenantId: opts.tenantId, subjectType: "lead", record: { source: opts.source ?? null } });
  if (rulePick) return rulePick;
  return pickRmForNewLead(tx, { branchId: opts.branchId ?? null, strategy: "least_loaded", excludeUserId: opts.excludeUserId ?? null });
}

/** "A lead was given to you" — in-app (and the phone, via the bell's push). */
export async function notifyLeadAssigned(
  tx: Tx,
  p: { tenantId: string; leadId: string; ownerId: string | null | undefined; actorUserId?: string | null; how?: "new" | "reassigned" | "imported" | "web_form" },
): Promise<void> {
  if (!p.ownerId || p.ownerId === p.actorUserId) return;
  const r = await tx.execute(sql`
    SELECT l.name, l.phone, a.name AS actor
      FROM leads l LEFT JOIN users a ON a.id = ${p.actorUserId ?? null}::uuid
     WHERE l.id = ${p.leadId}::uuid AND l.tenant_id = ${p.tenantId}::uuid LIMIT 1
  `);
  const row = r.rows[0] as { name?: string; actor?: string | null } | undefined;
  if (!row) return;
  const actor = row.actor ? String(row.actor).replace(/\s*\([^)]*\)\s*$/, "").trim() : null;
  const how =
    p.how === "web_form" ? "From your website form"
      : p.how === "imported" ? (actor ? `Imported by ${actor}` : "Imported")
        : p.how === "reassigned" ? (actor ? `${actor} handed it to you` : "Handed to you")
          : actor ? `${actor} assigned it to you` : "Assigned to you";
  await createNotification(tx, {
    tenantId: p.tenantId,
    userId: p.ownerId,
    kind: "lead.assigned",
    title: `New lead: ${row.name ?? "lead"}`,
    body: how,
    linkUrl: `/dashboard/leads/${p.leadId}`,
    severity: "info",
    meta: { lead_id: p.leadId, assigned_by: p.actorUserId ?? null, how: p.how ?? "new" },
  });
}

/**
 * Give a lead to `toOwnerId` (null = unassigned): owner and branch move
 * together, the lead's open follow-up / call-back tasks move to the new owner
 * (never journey-step or opportunity tasks), and the new owner is told.
 * Returns false when nothing changed.
 */
export async function reassignLead(
  tx: Tx,
  p: { tenantId: string; leadId: string; toOwnerId: string | null; actorUserId: string },
): Promise<boolean> {
  const cur = (await tx.execute(sql`
    SELECT owner_id::text AS owner_id, branch_id::text AS branch_id FROM leads
     WHERE id = ${p.leadId}::uuid AND tenant_id = ${p.tenantId}::uuid LIMIT 1
  `)).rows[0] as { owner_id: string | null; branch_id: string | null } | undefined;
  if (!cur) return false;
  const branch = p.toOwnerId ? await ownerBranchId(tx, p.tenantId, p.toOwnerId) : cur.branch_id;
  if (cur.owner_id === p.toOwnerId && cur.branch_id === branch) return false;
  await tx.execute(sql`
    UPDATE leads SET owner_id = ${p.toOwnerId}::uuid, branch_id = ${branch}::uuid, updated_at = now()
     WHERE id = ${p.leadId}::uuid AND tenant_id = ${p.tenantId}::uuid
  `);
  if (p.toOwnerId && cur.owner_id !== p.toOwnerId) {
    // The lead's own follow-ups go with it (both task links; never the
    // client's onboarding steps or an opportunity's follow-ups).
    await tx.execute(sql`
      UPDATE tasks t SET assignee_id = ${p.toOwnerId}::uuid, updated_at = now()
       WHERE t.tenant_id = ${p.tenantId}::uuid AND t.deleted_at IS NULL
         AND t.status NOT IN ('completed', 'cancelled')
         AND (t.related_lead_id = ${p.leadId}::uuid OR (t.subject_type = 'lead' AND t.subject_id = ${p.leadId}::uuid))
         AND NOT (COALESCE(t.meta, '{}'::jsonb) ? 'journeyStageKey')
         AND NOT (COALESCE(t.meta, '{}'::jsonb) ? 'opportunityId')
         AND (t.assignee_id IS NULL OR t.assignee_id IS NOT DISTINCT FROM ${cur.owner_id}::uuid)
    `);
    await notifyLeadAssigned(tx, { tenantId: p.tenantId, leadId: p.leadId, ownerId: p.toOwnerId, actorUserId: p.actorUserId, how: "reassigned" });
  }
  return true;
}
