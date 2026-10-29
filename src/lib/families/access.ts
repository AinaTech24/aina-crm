/**
 * Who may see and change a family (household).
 *
 * The module had three visibility models: the list and the PDF showed a
 * non-manager only families where they were the family RM, global search
 * showed a family if you could see any member, and the family PAGE checked
 * nothing at all — anyone signed in could open any household by URL and read
 * every member's PAN, AUM and date of birth. Membership writes checked only
 * a capability, so an RM could attach or detach another RM's clients.
 *
 * One rule now, used by every family screen and route:
 *
 *   A family is visible to someone who can see clients at all, when
 *     · they see the whole book (investor.view.all, or the firm runs a
 *       shared book — the same switch the Clients list obeys), or
 *     · they are the family's RM, or
 *     · (branch-scoped) the family is in their branch, or
 *     · they can see at least one of its members.
 *
 *   It is EDITABLE by the same people, given an edit capability.
 *
 * Linking a client into a family additionally requires being able to see that
 * client (lib/investors/access), so nobody moves a client they cannot open.
 */

import { sql, type SQL } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { can, requireAny, type Capability } from "@/lib/auth/rbac";
import { canViewAllInvestors, investorScopeSql, isDataScopeRestricted } from "@/lib/investors/access";
import { isBranchScoped } from "@/lib/leads/access";

const VIEW_CAPS = ["family.view", "family.map.view", "family.map.view_assigned", "investor.view.all", "investor.view.assigned"] as const;
const EDIT_CAPS = ["family.edit", "family.manage", "investor.edit.all", "investor.edit.assigned"] as const;

/**
 * What each family-mapping action needs: its own capability, or any household edit capability (as before).
 *
 * "Assigned only": a person with `family.map.edit_assigned` and WITHOUT the action's own capability
 * may do the action only on households they are the RM of — the group's own ticks decide, so the
 * older household / client edit capabilities (which a role grants by default) do not widen it.
 */
export type MapAction = "create" | "edit" | "delete";
const MAP_CAPS: Record<MapAction, readonly Capability[]> = {
  create: ["family.map.create", ...EDIT_CAPS],
  edit: ["family.map.edit", ...EDIT_CAPS],
  delete: ["family.map.delete", ...EDIT_CAPS],
};

const hasCap = (s: SessionUser, c: Capability) => can(s.roles, c, s.permissions);

/** "all": any household · "assigned": only the person's own households · null: not allowed. */
export function mapScope(session: SessionUser, action: MapAction): "all" | "assigned" | null {
  if (hasCap(session, `family.map.${action}` as Capability)) return "all";
  if (hasCap(session, "family.map.edit_assigned")) return "assigned";
  return MAP_CAPS[action].some((c) => hasCap(session, c)) ? "all" : null;
}

/** Whether `action` may be done on this household (`familyRmId` = the family's RM). */
export function canMapFamily(session: SessionUser, action: MapAction, familyRmId: string | null | undefined) {
  const scope = mapScope(session, action);
  return scope === "all" || (scope === "assigned" && !!familyRmId && familyRmId === session.userId);
}

/** Can start households / do the action anywhere (not just on their own). */
export function canMapFamilies(session: SessionUser, action: MapAction) {
  return mapScope(session, action) === "all";
}

/** Sees only the households they are the RM of (View assigned families only, without View family mapping). */
export function viewsAssignedFamiliesOnly(session: SessionUser) {
  return !hasCap(session, "family.map.view") && hasCap(session, "family.map.view_assigned");
}

/** Throws 403 when the caller may not see families at all. */
export function requireFamilyView(session: SessionUser) {
  requireAny(session.roles, [...VIEW_CAPS], session.permissions);
}

/** Throws 403 when the caller may not change families at all. */
export function requireFamilyEdit(session: SessionUser) {
  requireAny(session.roles, [...EDIT_CAPS], session.permissions);
}

export function canEditFamilies(session: SessionUser) {
  return EDIT_CAPS.some((c) => can(session.roles, c, session.permissions));
}

const hasInvestorView = (s: SessionUser) =>
  can(s.roles, "investor.view.all", s.permissions) || can(s.roles, "investor.view.assigned", s.permissions);

/**
 * SQL condition: the family aliased `alias` is visible to this session.
 * `TRUE` when unrestricted, so it can be ANDed in unconditionally.
 */
export async function familyScopeSql(tx: any, session: SessionUser, alias = "f"): Promise<SQL> {
  requireFamilyView(session);
  const a = alias.replace(/[^a-zA-Z0-9_]/g, "");
  const rm = sql.raw(`${a}.rm_id`);
  const branch = sql.raw(`${a}.branch_id`);
  const id = sql.raw(`${a}.id`);

  if (viewsAssignedFamiliesOnly(session)) return sql`${rm} = ${session.userId}::uuid`;

  if (canViewAllInvestors(session)) return sql`TRUE`;

  // family.view without any client view (e.g. service team): their own
  // households only — never the members' book.
  if (!hasInvestorView(session)) return sql`${rm} = ${session.userId}::uuid`;

  if (!session.mobile && !(await isDataScopeRestricted(tx, session.tenantId, session))) return sql`TRUE`;

  const memberScope = await investorScopeSql(tx, session, "fm_scope");
  const branchPart = isBranchScoped(session) && session.branchId
    ? sql` OR ${branch} = ${session.branchId}::uuid`
    : sql``;
  return sql`(${rm} = ${session.userId}::uuid${branchPart} OR EXISTS (
      SELECT 1 FROM investors fm_scope
       WHERE fm_scope.family_id = ${id} AND fm_scope.deleted_at IS NULL AND ${memberScope}
    ))`;
}

/** The family row when this session may see it, else null (→ 404, never 403: don't confirm it exists). */
export async function loadViewableFamily(tx: any, session: SessionUser, familyId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(familyId)) return null;
  const scope = await familyScopeSql(tx, session, "f");
  const r = await tx.execute(sql`
    SELECT f.id FROM families f
     WHERE f.id = ${familyId}::uuid AND f.tenant_id = ${session.tenantId}::uuid AND ${scope}
     LIMIT 1
  `);
  return (r.rows[0] as { id: string } | undefined) ?? null;
}

/** Throws 404 unless the family is visible and the caller may edit families (an assigned-only editor: their own). */
export async function assertFamilyEditable(
  tx: any, session: SessionUser, familyId: string, mapAction?: MapAction,
): Promise<void> {
  const scope = mapAction ? mapScope(session, mapAction) : null;
  if (mapAction) {
    if (!scope) requireAny(session.roles, [...MAP_CAPS[mapAction]], session.permissions);
  } else requireFamilyEdit(session);
  if (!(await loadViewableFamily(tx, session, familyId))) {
    throw Object.assign(new Error("family not found"), { status: 404 });
  }
  if (scope === "assigned") {
    const r = await tx.execute(sql`SELECT rm_id FROM families WHERE id = ${familyId}::uuid AND tenant_id = ${session.tenantId}::uuid`);
    if ((r.rows[0] as { rm_id: string | null } | undefined)?.rm_id !== session.userId) {
      throw Object.assign(new Error("family not found"), { status: 404 });
    }
  }
}
