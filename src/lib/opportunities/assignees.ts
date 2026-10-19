/**
 * Who an opportunity can be assigned to — its owner, who gets the follow-up
 * task. Pick-only, from active team members who
 *
 *   - can work opportunities (access.ts WORK_CAPS), and
 *   - may see the CLIENT, by the same rule as lib/investors/access.ts
 *     (`investorScopeCondition`), evaluated for THEM, not the viewer — a
 *     follow-up about a client the assignee cannot open is a dead task;
 *   - and, when the person assigning is a branch head locked to a branch
 *     (`isBranchScoped`), sit in that branch.
 *
 * The list (`opportunityAssignees`) and the check on save (`assertAssignable`)
 * run the same predicate, so the dialog never offers someone the API refuses.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { isBranchScoped } from "@/lib/leads/access";
import { hasCustomPermissions } from "@/lib/investors/access";
import { createNotification } from "@/lib/notifications/create";
import { formatDate } from "@/lib/format";
import { productLabel } from "@/lib/opportunities/products";
import { canWorkOpportunities } from "@/lib/opportunities/access";

export type Assignee = { id: string; name: string; insurance: boolean };

type UserRow = { id: string; name: string; roles: string[] | null; permissions: string[] | null; branch_id: string | null };
type ClientRow = { rm_id: string | null; branch_id: string | null };

const cleanName = (n: string) => n.replace(/\s*\([^)]*\)\s*$/, "") || n;

const asSession = (tenantId: string, u: UserRow): SessionUser => ({
  tenantId, userId: u.id, branchId: u.branch_id ?? undefined, roles: u.roles ?? [],
  permissions: u.permissions ?? undefined, email: "", name: u.name,
} as SessionUser);

/** investorScopeCondition, for another user and one client row. */
function seesClient(s: SessionUser, client: ClientRow, firmWall: boolean): boolean {
  const all = can(s.roles, "investor.view.all", s.permissions);
  if (!all && !can(s.roles, "investor.view.assigned", s.permissions)) return false;
  if (!firmWall && !hasCustomPermissions(s)) return true;
  if (isBranchScoped(s)) return !!client.branch_id && client.branch_id === s.branchId;
  if (all) return true;
  return client.rm_id === s.userId;
}

async function loadContext(tx: Tx, session: SessionUser, investorId: string) {
  const client = (await tx.execute(sql`
    SELECT rm_id, branch_id FROM investors
     WHERE id = ${investorId}::uuid AND tenant_id = ${session.tenantId}::uuid
  `)).rows[0] as ClientRow | undefined;
  const wall = (await tx.execute(sql`
    SELECT restrict_user_data_scope AS on FROM tenants WHERE id = ${session.tenantId}::uuid
  `)).rows[0] as { on?: boolean } | undefined;
  return { client, firmWall: wall?.on !== false };
}

function eligible(session: SessionUser, u: UserRow, client: ClientRow, firmWall: boolean) {
  const s = asSession(session.tenantId, u);
  if (!canWorkOpportunities(s)) return false;
  if (isBranchScoped(session) && u.branch_id !== session.branchId) return false;
  return seesClient(s, client, firmWall);
}

/** Everyone `session` may assign an opportunity on this client to, by name. */
export async function opportunityAssignees(tx: Tx, session: SessionUser, investorId: string): Promise<Assignee[]> {
  const { client, firmWall } = await loadContext(tx, session, investorId);
  if (!client) return [];
  const users = (await tx.execute(sql`
    SELECT id, name, roles, permissions, branch_id FROM users
     WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
     ORDER BY name LIMIT 500
  `)).rows as UserRow[];
  return users
    .filter((u) => eligible(session, u, client, firmWall))
    .map((u) => ({ id: u.id, name: cleanName(u.name), insurance: (u.roles ?? []).includes("insurance_team") }));
}

/** 400 unless `userId` is someone `session` may assign this client's opportunity to. */
export async function assertAssignable(tx: Tx, session: SessionUser, investorId: string, userId: string) {
  const { client, firmWall } = await loadContext(tx, session, investorId);
  const [u] = (await tx.execute(sql`
    SELECT id, name, roles, permissions, branch_id FROM users
     WHERE id = ${userId}::uuid AND tenant_id = ${session.tenantId}::uuid AND status = 'active'
  `)).rows as UserRow[];
  if (!client || !u) throw Object.assign(new Error("The chosen person is not an active user in this firm."), { status: 400 });
  if (isBranchScoped(session) && u.branch_id !== session.branchId) {
    throw Object.assign(new Error("You can assign it only to someone in your branch."), { status: 400 });
  }
  if (!eligible(session, u, client, firmWall)) {
    throw Object.assign(new Error(`${cleanName(u.name)} can't open this client, so it can't be assigned to them.`), { status: 400 });
  }
}

/**
 * Tell the new owner (never the person who assigned it). Points at the
 * opportunity; `task_id` is its follow-up — the earliest open task.
 */
export async function notifyOpportunityOwner(tx: Tx, session: SessionUser, opportunityId: string, ownerId: string) {
  if (ownerId === session.userId) return;
  const row = (await tx.execute(sql`
    SELECT o.product, i.name AS client, a.name AS actor,
           (SELECT t.id FROM tasks t
             WHERE t.tenant_id = o.tenant_id AND t.meta ->> 'opportunityId' = o.id::text
               AND t.status IN ('open', 'in_progress', 'blocked')
             ORDER BY t.due_at ASC NULLS LAST LIMIT 1) AS task_id,
           (SELECT t.due_at FROM tasks t
             WHERE t.tenant_id = o.tenant_id AND t.meta ->> 'opportunityId' = o.id::text
               AND t.status IN ('open', 'in_progress', 'blocked')
             ORDER BY t.due_at ASC NULLS LAST LIMIT 1) AS due_at
      FROM client_opportunities o
      JOIN investors i ON i.id = o.investor_id
      LEFT JOIN users a ON a.id = ${session.userId}::uuid
     WHERE o.id = ${opportunityId}::uuid AND o.tenant_id = ${session.tenantId}::uuid
  `)).rows[0] as { product: string; client: string; actor: string | null; task_id: string | null; due_at: string | null } | undefined;
  if (!row) return;
  const due = row.due_at ? formatDate(row.due_at, "dayMonth") : null;
  await createNotification(tx, {
    tenantId: session.tenantId,
    userId: ownerId,
    kind: "task.assigned",
    title: `Opportunity: ${productLabel(row.product)} — ${row.client}`,
    body: [row.actor ? `${cleanName(row.actor)} assigned it to you` : "Assigned to you", due ? `follow up by ${due}` : null]
      .filter(Boolean).join(" · "),
    linkUrl: `/dashboard/opportunities/${opportunityId}`,
    severity: "info",
    meta: { opportunity_id: opportunityId, task_id: row.task_id, assigned_by: session.userId },
  });
}
