/**
 * Client (investor) row-level access scope.
 *
 * RLS isolates by TENANT only — it does NOT slice a tenant's clients by who may
 * see them. That slice is the application's job, and it has to be applied in
 * EVERY query that returns a list of clients: the list page, the Excel export,
 * and the JSON API (which is also what the mobile app reads).
 *
 * Whether the slice applies at all is a PER-TENANT switch —
 * `tenants.restrict_user_data_scope`, default FALSE. Some firms run a shared
 * book where every RM serves every client; others need a hard wall between
 * books. Default-off means no existing firm's visibility changes until its
 * owner (or platform admin) deliberately turns the wall on.
 *
 * When the switch is ON (mirrors the capability matrix in lib/auth/rbac.ts):
 *   owner / compliance / back_office / ops  → the whole firm's book
 *   branch_head (with a branch)             → their branch only
 *   rm                                      → clients assigned to them
 *
 * When it is OFF every role that may view clients at all sees the whole book.
 * The capability gate is NOT part of the switch: a role with no client
 * capability (marketing …) is blocked either way, as the API has always done.
 *
 * Deliberately mirrors `lib/leads/access.ts`, which does the same job for the
 * pipeline. NOTE: lead scoping is unconditional and predates this switch —
 * turning this off does not widen lead visibility.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { withTenant, type Tx } from "@/db/client";
import { investors } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
// Session-level helper — its canonical home is the leads access module (its
// first caller). Branch scoping is identical for clients and leads.
import { isBranchScoped } from "@/lib/leads/access";

/** Throws 403 when the caller has no client visibility at all. */
export function requireInvestorView(session: SessionUser) {
  requireAny(
    session.roles,
    ["investor.view.all", "investor.view.assigned"],
    session.permissions
  );
}

export function canViewAllInvestors(session: SessionUser) {
  return can(session.roles, "investor.view.all", session.permissions);
}

/** The owner chose this person's permissions explicitly (an allow-list). */
export function hasCustomPermissions(session?: SessionUser): boolean {
  return !!session && !session.roles.includes("owner") && (session.permissions?.length ?? 0) > 0;
}

/**
 * Is the per-tenant data wall switched on? Read inside the CALLER's existing
 * transaction so it costs one cheap indexed read and needs no second pool
 * connection (every call site is already inside withTenant). Unreadable or
 * missing → false, i.e. fail OPEN to the long-standing firm-wide behaviour
 * rather than hiding a firm's own clients from it on a transient error.
 */
export async function isDataScopeRestricted(tx: any, tenantId: string, session?: SessionUser): Promise<boolean> {
  // An owner who ticked "Customize access permissions" for this person has
  // said exactly what they may see. Honour it whatever the firm switch says:
  // the switch is set from the AINA console, so with it off an owner who
  // unticked "View all clients" saw nothing change. Users who were never
  // customised keep the firm's shared-book default.
  if (hasCustomPermissions(session)) return true;
  try {
    const r = await tx.execute(sql`
      SELECT restrict_user_data_scope AS on FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
    `);
    return (r.rows[0] as { on?: boolean } | undefined)?.on !== false;
  } catch {
    return true;
  }
}

/**
 * Does the per-user data wall apply to this viewer at all? False for the owner
 * (never customised, sees everything) and for anyone at a firm with the switch
 * off who was not customised. Every narrowing the "every module honours own
 * clients" change added BEYOND the shared client scope — own-only rules,
 * prepared-by-me rules, own-bookings locks, page capability gates — applies
 * only when this is true; otherwise the screen keeps its earlier behaviour.
 */
export async function dataWallApplies(tx: any, session: SessionUser): Promise<boolean> {
  if (session.roles.includes("owner")) return false;
  return isDataScopeRestricted(tx, session.tenantId, session);
}

/** `dataWallApplies` for code outside a transaction (page gates). */
export async function dataWallAppliesFor(session: SessionUser): Promise<boolean> {
  if (session.roles.includes("owner")) return false;
  return withTenant(session.tenantId, (tx) => isDataScopeRestricted(tx, session.tenantId, session));
}

/**
 * Does the client scope actually NARROW this viewer's book? False when the
 * wall does not apply to them (`dataWallApplies`) and for a firm-wide client
 * viewer even with the wall on. Callers that wrap the client scope in an
 * `EXISTS (SELECT 1 FROM investors …)` skip the EXISTS when this is false, so
 * a record whose client is missing, deleted or purged never disappears for a
 * viewer who was never narrowed (the owner above all).
 */
export async function clientScopeNarrows(tx: any, session: SessionUser): Promise<boolean> {
  if (!(await dataWallApplies(tx, session))) return false;
  if (!can(session.roles, "investor.view.all", session.permissions) && !can(session.roles, "investor.view.assigned", session.permissions)) return true;
  if (session.mobile && !session.roles.some(r => ["owner", "ops", "back_office"].includes(r))
    && (session.roles.includes("branch_head") || session.roles.includes("rm"))) return true;
  if (isBranchScoped(session)) return true;
  return !canViewAllInvestors(session);
}

/**
 * Drizzle condition restricting a client query to what this session may see.
 * `undefined` means "no restriction" — either the tenant has the switch off or
 * the caller is a firm-wide viewer — so callers can drop it into an `and(...)`
 * without an extra branch.
 */
export async function investorScopeCondition(tx: any, session: SessionUser) {
  requireInvestorView(session);
  if (session.mobile && !session.roles.some(r => ["owner", "ops", "back_office"].includes(r))) {
    if (session.roles.includes("branch_head")) return session.branchId ? eq(investors.branchId, session.branchId) : sql`FALSE`;
    if (session.roles.includes("rm")) return eq(investors.rmId, session.userId);
  }
  if (!(await isDataScopeRestricted(tx, session.tenantId, session))) return undefined;
  if (isBranchScoped(session)) return eq(investors.branchId, session.branchId!);
  if (canViewAllInvestors(session)) return undefined;
  return eq(investors.rmId, session.userId);
}

/**
 * Same rule as raw SQL, for queries built with sql`` fragments rather than the
 * query builder. Returns `TRUE` when unrestricted so it can be joined into an
 * AND chain unconditionally.
 */
export async function investorScopeSql(tx: any, session: SessionUser, alias = "investors") {
  requireInvestorView(session);
  if (session.mobile && !session.roles.some(r => ["owner", "ops", "back_office"].includes(r))) {
    if (session.roles.includes("branch_head")) return session.branchId ? sql`${sql.raw(`${alias}.branch_id`)} = ${session.branchId}::uuid` : sql`FALSE`;
    if (session.roles.includes("rm")) return sql`${sql.raw(`${alias}.rm_id`)} = ${session.userId}::uuid`;
  }
  if (!(await isDataScopeRestricted(tx, session.tenantId, session))) return sql`TRUE`;
  if (isBranchScoped(session)) {
    return sql`${sql.raw(`${alias}.branch_id`)} = ${session.branchId}::uuid`;
  }
  if (canViewAllInvestors(session)) return sql`TRUE`;
  return sql`${sql.raw(`${alias}.rm_id`)} = ${session.userId}::uuid`;
}

/** Authorize the parent before returning any child records or private files. */
export async function loadViewableInvestor(tx: Tx, session: SessionUser, id: string) {
  const scope = await investorScopeCondition(tx, session);
  const [row] = await tx.select().from(investors).where(and(
    eq(investors.id, id), eq(investors.tenantId, session.tenantId), isNull(investors.deletedAt), scope,
  )).limit(1);
  return row ?? null;
}

export async function assertInvestorAccess(session: SessionUser, id: string): Promise<void> {
  const found = await withTenant(session.tenantId, tx => loadViewableInvestor(tx, session, id));
  if (!found) throw Object.assign(new Error("Investor not found"), { status: 404 });
}
