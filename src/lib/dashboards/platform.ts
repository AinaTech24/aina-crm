/**
 * Named dashboards — who sees which, who may change it, and which one opens.
 * SERVER-ONLY (imports the DB). The Zoho-CRM model (dashboard cleanup D7/D8):
 *
 *   VISIBLE   a system (role) dashboard to everyone in the roles it is for
 *             (its 'all' share, the default) and to the users / roles /
 *             branches / teams it is shared with — an admin may drop the role
 *             audience to limit it to those; a custom dashboard to its
 *             creator, to whoever it is shared with, to everyone when shared
 *             with all, and to anyone who may manage dashboards ("Other
 *             users' dashboards").
 *   EDIT      creator or a manager; anyone it is shared with while it is NOT
 *             locked. System dashboards are locked for everyone.
 *   SHARE     creator or a manager; a system dashboard, a manager. A branch
 *             head shares only inside their own branch.
 *   DELETE    creator or a manager; never a system dashboard.
 *   CLONE     anyone who can see it — except a role dashboard that is a full
 *             page of its own (a "centre": Branch Head, RM, Operations,
 *             Insurance Team, Claims), which has no cards to copy.
 *
 * Seeing a dashboard never widens what its figures count: every widget goes
 * through the viewer's record access (lib/dashboards/system/access.ts).
 *
 * Which dashboard /dashboard opens: the user's own default → an assignment to
 * the user → the last one they opened → their role's default → the Owner
 * Dashboard.
 */

import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  dashboards,
  dashboardShares,
  dashboardUserPrefs,
  dashboardDefaults,
  users,
  branches,
  type Dashboard,
} from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import {
  ROLE_DEFAULTS,
  SYSTEM_DASHBOARDS,
  SYSTEM_DASHBOARD_BY_KEY,
  type CentreKind,
  type SystemDashboard,
} from "./system/definitions";
import { sanitizeLayoutItems, migrateLegacyLayout, type LayoutItem } from "./system/catalog";
import { sanitizeFilterConfig, type FilterConfig, type FilterState, sanitizeFilterState } from "./system/filters";
import { inOrder } from "@/lib/metrics/in-order";

export type ShareType = "all" | "user" | "role" | "branch" | "team";
export type ShareRow = { shareType: ShareType; shareRef: string; includeSubordinates: boolean };

/** Roles that sit under a role, for "include subordinates". */
export const ROLE_SUBORDINATES: Record<string, string[]> = {
  owner: ["branch_head", "rm", "team_member", "ops", "back_office", "service_team", "compliance", "marketing", "insurance_team"],
  branch_head: ["rm", "team_member", "insurance_team", "service_team"],
  ops: ["back_office", "service_team"],
};

export const ROLE_LABELS: Record<string, string> = Object.fromEntries(ROLE_DEFAULTS.map((r) => [r.role, r.label]));

/** Days a deleted dashboard can be restored for. */
export const RESTORE_DAYS = 30;

export function canManageDashboards(s: SessionUser): boolean {
  return s.roles.includes("owner") || can(s.roles, "dashboards.manage", s.permissions);
}

function isBranchHead(s: SessionUser): boolean {
  return s.roles.includes("branch_head") && !!s.branchId;
}

/* ─────────────────────────── system dashboards ─────────────────────────── */

/** Create any missing system dashboard rows (a firm created after 0223), their share and the role defaults. */
export async function ensureSystemDashboards(tx: Tx, tenantId: string): Promise<void> {
  const have = (await tx.select({ key: dashboards.systemKey }).from(dashboards)
    .where(and(eq(dashboards.tenantId, tenantId), eq(dashboards.isSystem, true)))) as Array<{ key: string | null }>;
  const missing = SYSTEM_DASHBOARDS.filter((d) => !have.some((h) => h.key === d.key));
  if (!missing.length) return;
  for (const d of missing) {
    await tx.execute(sql`
      INSERT INTO dashboards (tenant_id, name, description, scope, locked, layout, is_system, system_key)
      VALUES (${tenantId}::uuid, ${d.name}, ${d.description}, 'shared', true, '[]'::jsonb, true, ${d.key})
      ON CONFLICT (tenant_id, system_key) WHERE system_key IS NOT NULL DO NOTHING`);
  }
  // Only the dashboards just created get the default audience: an admin's
  // sharing of the others is theirs to keep.
  const keys = sql.join(missing.map((d) => sql`${d.key}`), sql`, `);
  await tx.execute(sql`
    INSERT INTO dashboard_shares (tenant_id, dashboard_id, share_type, share_ref)
    SELECT tenant_id, id, 'all', '' FROM dashboards
     WHERE tenant_id = ${tenantId}::uuid AND is_system AND system_key IN (${keys})
    ON CONFLICT (dashboard_id, share_type, share_ref) DO NOTHING`);
  const values = sql.join(ROLE_DEFAULTS.map((r) => sql`(${r.role}, ${r.dashboard})`), sql`, `);
  await tx.execute(sql`
    INSERT INTO dashboard_defaults (tenant_id, target_type, target_ref, dashboard_id)
    SELECT d.tenant_id, 'role', r.role, d.id
      FROM dashboards d JOIN (VALUES ${values}) AS r(role, system_key) ON r.system_key = d.system_key
     WHERE d.tenant_id = ${tenantId}::uuid
    ON CONFLICT (tenant_id, target_type, target_ref) DO NOTHING`);
}

export function systemDef(d: Pick<Dashboard, "isSystem" | "systemKey">): SystemDashboard | null {
  return d.isSystem && d.systemKey ? SYSTEM_DASHBOARD_BY_KEY[d.systemKey] ?? null : null;
}

/** A dashboard's layout: code for system dashboards, the stored one otherwise (old boards converted). */
export function layoutOf(d: Dashboard): LayoutItem[] {
  const sys = systemDef(d);
  if (sys) return sys.layout;
  const stored = d.layout as unknown[];
  const clean = sanitizeLayoutItems(stored);
  // A pre-2026-09 board stored colSpan/rowSpan widgets from the old catalog.
  if (!clean.length && Array.isArray(stored) && stored.length) return migrateLegacyLayout(stored);
  return clean;
}

/** A dashboard's filter configuration: code for system dashboards, stored (or every extra filter) otherwise. */
export function filterConfigOf(d: Dashboard): FilterConfig {
  const sys = systemDef(d);
  if (sys) return sys.filters;
  return sanitizeFilterConfig(d.filterConfig) ?? { fields: ["segment", "category", "amc", "product", "leadSource", "tags", "family"] };
}

/* ─────────────────────────────── viewers ─────────────────────────────── */

export type ViewerFacts = { session: SessionUser; deskId: string | null };

export async function viewerFacts(tx: Tx, session: SessionUser): Promise<ViewerFacts> {
  const [u] = await tx.select({ deskId: users.deskId }).from(users)
    .where(and(eq(users.id, session.userId), eq(users.tenantId, session.tenantId))).limit(1);
  return { session, deskId: (u?.deskId as string | null) ?? null };
}

export function shareReaches(v: ViewerFacts, sh: ShareRow): boolean {
  const s = v.session;
  switch (sh.shareType) {
    case "all": return true;
    case "user": return sh.shareRef === s.userId;
    case "role":
      return s.roles.includes(sh.shareRef)
        || (sh.includeSubordinates && s.roles.some((r) => (ROLE_SUBORDINATES[sh.shareRef] ?? []).includes(r)));
    case "branch": return !!s.branchId && sh.shareRef === s.branchId;
    case "team": return !!v.deskId && sh.shareRef === v.deskId;
  }
}

export function canView(v: ViewerFacts, d: Dashboard, shares: ShareRow[]): boolean {
  const sys = systemDef(d);
  if (d.isSystem) {
    // A system row this build does not define (a retired key) is never shown.
    if (!sys || d.deletedAt) return false;
    if (canManageDashboards(v.session)) return true;
    // The 'all' share is "everyone in the roles it's for"; anyone it is
    // shared with by name, role, branch or team sees it as well.
    if (shares.some((sh) => sh.shareType === "all") && sys.visibleTo(v.session)) return true;
    return shares.some((sh) => sh.shareType !== "all" && shareReaches(v, sh));
  }
  if (d.deletedAt) return d.userId === v.session.userId || canManageDashboards(v.session);
  if (d.userId === v.session.userId) return true;
  if (canManageDashboards(v.session)) return true;
  return shares.some((sh) => shareReaches(v, sh));
}

export function canEdit(v: ViewerFacts, d: Dashboard, shares: ShareRow[]): boolean {
  if (d.isSystem || d.deletedAt) return false;
  if (d.userId === v.session.userId || canManageDashboards(v.session)) return true;
  return !d.locked && shares.some((sh) => shareReaches(v, sh));
}

export function canShareOrDelete(v: ViewerFacts, d: Dashboard): boolean {
  if (d.isSystem) return false;
  return d.userId === v.session.userId || canManageDashboards(v.session);
}

/** Who may change whom a dashboard is shared with: its creator or a manager; a role dashboard, a manager. */
export function canShare(v: ViewerFacts, d: Dashboard): boolean {
  if (d.deletedAt) return false;
  return d.isSystem ? canManageDashboards(v.session) : canShareOrDelete(v, d);
}

/**
 * Validate the share targets a viewer may set. A manager may share with anyone;
 * a branch head within their branch (the branch, its teams, its people);
 * anyone else only keeps a dashboard to themselves.
 */
export async function allowedShares(tx: Tx, v: ViewerFacts, rows: ShareRow[]): Promise<ShareRow[] | { error: string }> {
  if (canManageDashboards(v.session)) return rows;
  if (!rows.length) return rows;
  if (!isBranchHead(v.session)) return { error: "Only an admin or a branch head can share a dashboard" };
  const branchId = v.session.branchId!;
  for (const r of rows) {
    if (r.shareType === "branch" && r.shareRef === branchId) continue;
    if (r.shareType === "user") {
      const [u] = await tx.select({ b: users.branchId }).from(users)
        .where(and(eq(users.id, r.shareRef), eq(users.tenantId, v.session.tenantId))).limit(1);
      if (u?.b === branchId) continue;
    }
    if (r.shareType === "team") {
      const t = (await tx.execute(sql`SELECT branch_id FROM desks WHERE id = ${r.shareRef}::uuid AND tenant_id = ${v.session.tenantId}::uuid`)).rows[0] as { branch_id?: string } | undefined;
      if (t?.branch_id === branchId) continue;
    }
    return { error: "A branch head can share only within their own branch" };
  }
  return rows;
}

/* ─────────────────────────────── listing ─────────────────────────────── */

export type DashListItem = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  systemKey: string | null;
  /** A role dashboard that is a full page of its own, not widget cards. */
  centre: CentreKind | null;
  locked: boolean;
  ownerId: string | null;
  ownerName: string | null;
  isFavourite: boolean;
  isMyDefault: boolean;
  lastOpenedAt: string | null;
  updatedAt: string;
  deletedAt: string | null;
  shares: ShareRow[];
  /** Roles this dashboard is the default for. */
  defaultFor: string[];
  group: "assigned" | "mine" | "shared" | "others";
  canEdit: boolean;
  canShare: boolean;
  canDelete: boolean;
  /** A role dashboard's default audience, in words. */
  audience: string | null;
};

export type DashList = {
  items: DashListItem[];
  deleted: DashListItem[];
  canManage: boolean;
};

async function sharesFor(tx: Tx, tenantId: string, ids: string[]): Promise<Map<string, ShareRow[]>> {
  const out = new Map<string, ShareRow[]>();
  if (!ids.length) return out;
  const rows = await tx.select().from(dashboardShares)
    .where(and(eq(dashboardShares.tenantId, tenantId), inArray(dashboardShares.dashboardId, ids)));
  for (const r of rows) {
    const list = out.get(r.dashboardId) ?? [];
    list.push({ shareType: r.shareType as ShareType, shareRef: r.shareRef, includeSubordinates: r.includeSubordinates });
    out.set(r.dashboardId, list);
  }
  return out;
}

export async function listDashboards(tx: Tx, v: ViewerFacts): Promise<DashList> {
  const s = v.session;
  const cutoff = new Date(Date.now() - RESTORE_DAYS * 864e5);
  const rows = await tx.select({ d: dashboards, ownerName: users.name }).from(dashboards)
    .leftJoin(users, eq(users.id, dashboards.userId))
    .where(eq(dashboards.tenantId, s.tenantId))
    .orderBy(desc(dashboards.isSystem), dashboards.name);
  const ids = rows.map((r) => r.d.id);
  const [shares, prefs, defaults] = await inOrder(
    () => sharesFor(tx, s.tenantId, ids),
    () => tx.select().from(dashboardUserPrefs)
      .where(and(eq(dashboardUserPrefs.tenantId, s.tenantId), eq(dashboardUserPrefs.userId, s.userId))),
    () => tx.select().from(dashboardDefaults)
      .where(and(eq(dashboardDefaults.tenantId, s.tenantId), eq(dashboardDefaults.targetType, "role"))),
  );
  const prefBy = new Map(prefs.map((p) => [p.dashboardId, p]));
  const manage = canManageDashboards(s);

  const items: DashListItem[] = [];
  const deleted: DashListItem[] = [];
  for (const { d, ownerName } of rows) {
    const sh = shares.get(d.id) ?? [];
    if (!canView(v, d, sh)) continue;
    if (d.deletedAt && d.deletedAt < cutoff) continue;
    const p = prefBy.get(d.id);
    const sys = systemDef(d);
    const direct = sh.some((x) => x.shareType === "user" && x.shareRef === s.userId);
    const group: DashListItem["group"] = d.isSystem
      ? "assigned"
      : d.userId === s.userId
        ? "mine"
        : direct
          ? "shared"
          : sh.some((x) => x.shareType !== "user" && shareReaches(v, x))
            ? "assigned"
            : "others";
    const item: DashListItem = {
      id: d.id,
      name: d.name,
      description: d.description,
      isSystem: d.isSystem,
      systemKey: d.systemKey,
      centre: sys?.centre ?? null,
      locked: d.isSystem || d.locked,
      ownerId: d.userId,
      ownerName: d.isSystem ? "System" : (ownerName as string | null) ?? null,
      isFavourite: !!p?.isFavourite,
      isMyDefault: !!p?.isDefault,
      lastOpenedAt: p?.lastOpenedAt ? p.lastOpenedAt.toISOString() : null,
      updatedAt: d.updatedAt.toISOString(),
      deletedAt: d.deletedAt ? d.deletedAt.toISOString() : null,
      shares: sh,
      defaultFor: defaults.filter((x) => x.dashboardId === d.id).map((x) => x.targetRef),
      group,
      canEdit: canEdit(v, d, sh),
      canShare: canShare(v, d),
      canDelete: canShareOrDelete(v, d),
      audience: sys?.audience ?? null,
    };
    (d.deletedAt ? deleted : items).push(item);
  }
  // The role dashboards in their defined order (Owner first), then
  // everything else by name.
  const order = new Map<string, number>(SYSTEM_DASHBOARDS.map((d, i) => [d.key, i]));
  const rank = (i: DashListItem) => (i.isSystem ? order.get(i.systemKey ?? "") ?? 99 : 100);
  items.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  // "Other users' dashboards" is for managers only; for anyone else an
  // unreachable dashboard never got past canView above.
  return { items: manage ? items : items.filter((i) => i.group !== "others"), deleted, canManage: manage };
}

/** Load one dashboard the viewer may see, with its shares. Null when absent or not visible. */
export async function loadDashboard(
  tx: Tx, v: ViewerFacts, id: string,
): Promise<{ d: Dashboard; shares: ShareRow[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [d] = await tx.select().from(dashboards)
    .where(and(eq(dashboards.id, id), eq(dashboards.tenantId, v.session.tenantId))).limit(1);
  if (!d) return null;
  const shares = (await sharesFor(tx, v.session.tenantId, [d.id])).get(d.id) ?? [];
  return canView(v, d, shares) ? { d, shares } : null;
}

/** The system dashboard row for a key, when the viewer may see it. */
export async function systemDashboardId(tx: Tx, v: ViewerFacts, key: string): Promise<string | null> {
  const [d] = await tx.select().from(dashboards)
    .where(and(eq(dashboards.tenantId, v.session.tenantId), eq(dashboards.systemKey, key), isNull(dashboards.deletedAt)))
    .limit(1);
  if (!d) return null;
  const shares = (await sharesFor(tx, v.session.tenantId, [d.id])).get(d.id) ?? [];
  return canView(v, d, shares) ? d.id : null;
}

/**
 * The viewer may open this role dashboard — by the roles it is for, or
 * because it was shared with them. The routes behind a role dashboard (its
 * drawers, search and export) use this, so a person it was shared with is not
 * turned away by a capability they were never given.
 */
export async function opensSystemDashboard(tx: Tx, session: SessionUser, key: string): Promise<boolean> {
  return !!(await systemDashboardId(tx, await viewerFacts(tx, session), key));
}

/**
 * The dashboard /dashboard opens: own default → assignment to the user → the
 * last one opened → the first of the user's roles with a default → the Owner
 * Dashboard → anything visible. Every candidate must still be visible and not
 * deleted.
 */
export async function resolveDefaultDashboard(tx: Tx, v: ViewerFacts): Promise<string | null> {
  const s = v.session;
  const candidates: string[] = [];
  const [own] = await tx.select({ id: dashboardUserPrefs.dashboardId }).from(dashboardUserPrefs)
    .where(and(eq(dashboardUserPrefs.tenantId, s.tenantId), eq(dashboardUserPrefs.userId, s.userId), eq(dashboardUserPrefs.isDefault, true)))
    .limit(1);
  if (own) candidates.push(own.id);
  const defs = await tx.select().from(dashboardDefaults).where(eq(dashboardDefaults.tenantId, s.tenantId));
  const assigned = defs.find((x) => x.targetType === "user" && x.targetRef === s.userId);
  if (assigned) candidates.push(assigned.dashboardId);
  // The last dashboard opened is remembered, as in Zoho — after an explicit
  // default and an admin's assignment, before the role default, so a new
  // user still lands on their role's dashboard.
  const [recent] = await tx.select({ id: dashboardUserPrefs.dashboardId }).from(dashboardUserPrefs)
    .where(and(eq(dashboardUserPrefs.tenantId, s.tenantId), eq(dashboardUserPrefs.userId, s.userId), isNotNull(dashboardUserPrefs.lastOpenedAt)))
    .orderBy(desc(dashboardUserPrefs.lastOpenedAt))
    .limit(1);
  if (recent) candidates.push(recent.id);
  for (const r of ROLE_DEFAULTS) {
    if (!s.roles.includes(r.role)) continue;
    const row = defs.find((x) => x.targetType === "role" && x.targetRef === r.role);
    if (row) candidates.push(row.dashboardId);
  }
  for (const id of candidates) {
    const hit = await loadDashboard(tx, v, id);
    if (hit && !hit.d.deletedAt) return hit.d.id;
  }
  const owner = await systemDashboardId(tx, v, "owner");
  if (owner) return owner;
  const list = await listDashboards(tx, v);
  return list.items[0]?.id ?? null;
}

/* ─────────────────────────────── prefs ─────────────────────────────── */

async function upsertPref(tx: Tx, s: SessionUser, dashboardId: string, set: Partial<typeof dashboardUserPrefs.$inferInsert>) {
  await tx.insert(dashboardUserPrefs)
    .values({ tenantId: s.tenantId, userId: s.userId, dashboardId, ...set, updatedAt: new Date() } as never)
    .onConflictDoUpdate({
      target: [dashboardUserPrefs.userId, dashboardUserPrefs.dashboardId],
      set: { ...set, updatedAt: new Date() } as never,
    });
}

export async function setFavourite(tx: Tx, s: SessionUser, id: string, on: boolean) {
  await upsertPref(tx, s, id, { isFavourite: on });
}

export async function setMyDefault(tx: Tx, s: SessionUser, id: string | null) {
  await tx.update(dashboardUserPrefs).set({ isDefault: false, updatedAt: new Date() })
    .where(and(eq(dashboardUserPrefs.tenantId, s.tenantId), eq(dashboardUserPrefs.userId, s.userId), eq(dashboardUserPrefs.isDefault, true)));
  if (id) await upsertPref(tx, s, id, { isDefault: true });
}

export async function touchOpened(tx: Tx, s: SessionUser, id: string) {
  await upsertPref(tx, s, id, { lastOpenedAt: new Date() });
}

export async function saveFilters(tx: Tx, s: SessionUser, id: string, state: FilterState | null) {
  await upsertPref(tx, s, id, { savedFilters: state as never });
}

export async function setCardFilter(tx: Tx, s: SessionUser, id: string, instanceId: string, state: FilterState | null) {
  const [p] = await tx.select({ c: dashboardUserPrefs.cardFilters }).from(dashboardUserPrefs)
    .where(and(eq(dashboardUserPrefs.userId, s.userId), eq(dashboardUserPrefs.dashboardId, id))).limit(1);
  const next = { ...((p?.c as Record<string, unknown>) ?? {}) };
  if (state) next[instanceId.slice(0, 64)] = state;
  else delete next[instanceId];
  await upsertPref(tx, s, id, { cardFilters: next as never });
}

export async function loadPrefs(tx: Tx, s: SessionUser, id: string): Promise<{
  saved: FilterState | null; cards: Record<string, FilterState>; isFavourite: boolean; isDefault: boolean;
}> {
  const [p] = await tx.select().from(dashboardUserPrefs)
    .where(and(eq(dashboardUserPrefs.userId, s.userId), eq(dashboardUserPrefs.dashboardId, id))).limit(1);
  const cards: Record<string, FilterState> = {};
  for (const [k, raw] of Object.entries((p?.cardFilters as Record<string, unknown>) ?? {})) {
    const st = sanitizeFilterState(raw);
    if (st) cards[k] = st;
  }
  return {
    saved: sanitizeFilterState(p?.savedFilters),
    cards,
    isFavourite: !!p?.isFavourite,
    isDefault: !!p?.isDefault,
  };
}

/* ───────────────────────────── writes ───────────────────────────── */

export async function createDashboard(
  tx: Tx, s: SessionUser,
  input: { name: string; description?: string | null; layout: LayoutItem[]; filterConfig?: FilterConfig | null },
): Promise<string> {
  const [row] = await tx.insert(dashboards).values({
    tenantId: s.tenantId,
    userId: s.userId,
    createdBy: s.userId,
    name: input.name.trim().slice(0, 120) || "Untitled dashboard",
    description: input.description?.trim().slice(0, 500) || null,
    scope: "private",
    layout: input.layout as never,
    filterConfig: (input.filterConfig ?? null) as never,
  } as never).returning({ id: dashboards.id });
  return row.id;
}

export async function cloneDashboard(tx: Tx, s: SessionUser, src: Dashboard): Promise<string> {
  return createDashboard(tx, s, {
    name: `${src.name} (copy)`.slice(0, 120),
    description: src.description,
    layout: layoutOf(src),
    filterConfig: filterConfigOf(src),
  });
}

export async function replaceShares(
  tx: Tx, s: SessionUser, d: Dashboard, rows: ShareRow[], locked: boolean,
): Promise<void> {
  await tx.delete(dashboardShares).where(and(eq(dashboardShares.tenantId, s.tenantId), eq(dashboardShares.dashboardId, d.id)));
  const clean = rows.filter((r) => r.shareType === "all" ? true : !!r.shareRef);
  if (clean.length) {
    await tx.insert(dashboardShares).values(clean.map((r) => ({
      tenantId: s.tenantId,
      dashboardId: d.id,
      shareType: r.shareType,
      shareRef: r.shareType === "all" ? "" : r.shareRef.slice(0, 64),
      includeSubordinates: r.shareType === "role" && r.includeSubordinates,
      createdBy: s.userId,
    })) as never).onConflictDoNothing();
  }
  const shared = clean.length > 0;
  // A role dashboard stays locked and listed as shared whoever it reaches.
  await tx.update(dashboards)
    .set({ locked: d.isSystem ? true : locked, scope: d.isSystem || shared ? "shared" : "private", updatedAt: new Date() } as never)
    .where(eq(dashboards.id, d.id));
}

export async function setRoleDefault(tx: Tx, s: SessionUser, role: string, dashboardId: string | null) {
  if (!dashboardId) {
    await tx.delete(dashboardDefaults).where(and(eq(dashboardDefaults.tenantId, s.tenantId),
      eq(dashboardDefaults.targetType, "role"), eq(dashboardDefaults.targetRef, role)));
    return;
  }
  await tx.insert(dashboardDefaults)
    .values({ tenantId: s.tenantId, targetType: "role", targetRef: role, dashboardId, updatedBy: s.userId } as never)
    .onConflictDoUpdate({
      target: [dashboardDefaults.tenantId, dashboardDefaults.targetType, dashboardDefaults.targetRef],
      set: { dashboardId, updatedBy: s.userId, updatedAt: new Date() } as never,
    });
}

export async function setUserAssignment(tx: Tx, s: SessionUser, userId: string, dashboardId: string | null) {
  if (!dashboardId) {
    await tx.delete(dashboardDefaults).where(and(eq(dashboardDefaults.tenantId, s.tenantId),
      eq(dashboardDefaults.targetType, "user"), eq(dashboardDefaults.targetRef, userId)));
    return;
  }
  await tx.insert(dashboardDefaults)
    .values({ tenantId: s.tenantId, targetType: "user", targetRef: userId, dashboardId, updatedBy: s.userId } as never)
    .onConflictDoUpdate({
      target: [dashboardDefaults.tenantId, dashboardDefaults.targetType, dashboardDefaults.targetRef],
      set: { dashboardId, updatedBy: s.userId, updatedAt: new Date() } as never,
    });
}

/** Names for share chips: users, branches and teams by id. */
export async function shareNames(tx: Tx, tenantId: string): Promise<{
  users: Array<{ id: string; name: string; branchId: string | null }>;
  branches: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string; branchId: string | null }>;
}> {
  const [u, b, t] = await inOrder(
    () => tx.select({ id: users.id, name: users.name, branchId: users.branchId }).from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.status, "active" as never))).orderBy(users.name),
    () => tx.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.tenantId, tenantId)).orderBy(branches.name),
    () => tx.execute(sql`SELECT id, name, branch_id FROM desks WHERE tenant_id = ${tenantId}::uuid ORDER BY name`),
  );
  return {
    users: u.map((x) => ({ id: x.id, name: x.name ?? "—", branchId: (x.branchId as string | null) ?? null })),
    branches: b.map((x) => ({ id: x.id, name: x.name ?? "—" })),
    teams: (t.rows as Array<{ id: string; name: string; branch_id: string | null }>).map((x) => ({ id: x.id, name: x.name, branchId: x.branch_id })),
  };
}
