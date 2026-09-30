/**
 * Everything a dashboard render needs, resolved once: the dashboard (visible
 * to this viewer or not found), its layout and filter configuration, the
 * filter state (URL → saved filter → dashboard defaults), the viewer's access
 * and the per-card filters. SERVER-ONLY. The page and the CSV export both use
 * it, so an export is exactly what the card showed.
 *
 * A role dashboard that is a full page of its own (a centre: Branch Head, RM,
 * Operations, Insurance Team, Claims) resolves to a PreparedCentre instead:
 * the header's facts only. The centre decides its own access, book and
 * filters (components/dashboards/system/centres.tsx).
 */

import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import {
  ensureSystemDashboards, filterConfigOf, layoutOf, listDashboards, loadDashboard, loadPrefs, systemDef,
  touchOpened, viewerFacts, canEdit, canShare, canShareOrDelete, canManageDashboards, type DashList,
} from "@/lib/dashboards/platform";
import { accessLabel, canFilterBranch, canFilterRm, scopeFor, type DataAccess } from "@/lib/dashboards/system/access";
import { resolveDataAccess } from "@/lib/dashboards/team";
import {
  EXTRA_FILTERS, FILTER_FIELDS, activeFilterKeys, hasFilterParams, parseFilterState,
  type FilterConfig, type FilterKey, type FilterState,
} from "@/lib/dashboards/system/filters";
import { resolvePeriod, type ResolvedPeriod } from "@/lib/dashboards/system/period";
import { SYSTEM_WIDGETS_BY_KEY, type LayoutItem } from "@/lib/dashboards/system/catalog";
import type { FilterOptions } from "@/lib/dashboards/system/options";
import type { CentreKind } from "@/lib/dashboards/system/definitions";
import { loadFilterOptions, realBranches } from "@/lib/dashboards/load-options";
import { loadDashboardThresholds, type DashboardThresholds } from "@/lib/dashboard/thresholds";
import type { WidgetCtx } from "./types";
import { inOrder } from "@/lib/metrics/in-order";

export type PreparedDashboard = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  systemKey: string | null;
  locked: boolean;
  layout: LayoutItem[];
  filterConfig: FilterConfig;
  /** Filters in force on the dashboard (before any card filter). */
  state: FilterState;
  /** The viewer's saved filter for this dashboard, if any. */
  saved: FilterState | null;
  /** The saved filter is what is showing (the URL set nothing). */
  usingSaved: boolean;
  period: ResolvedPeriod;
  access: DataAccess;
  showing: string;
  /** Which filter fields the bar offers this viewer. */
  bar: { rm: boolean; branch: boolean; extras: FilterKey[]; pinned: FilterKey[] };
  options: FilterOptions;
  cards: Record<string, FilterState>;
  isFavourite: boolean;
  isDefault: boolean;
  canEdit: boolean;
  canShare: boolean;
  canDelete: boolean;
  canManage: boolean;
  /** A role dashboard: the roles it is for, in words. */
  audience: string | null;
  list: DashList;
  base: Omit<WidgetCtx, "state" | "period" | "scope">;
};

/** A role dashboard that is a full page of its own: what its header needs. */
export type PreparedCentre = {
  centre: CentreKind;
  id: string;
  name: string;
  description: string | null;
  systemKey: string;
  filterConfig: FilterConfig;
  /** The viewer's saved filter (the Operations Dashboard's filter bar keeps one). */
  saved: FilterState | null;
  isFavourite: boolean;
  isDefault: boolean;
  canManage: boolean;
  /** An admin may share a role dashboard with particular people. */
  canShare: boolean;
  audience: string;
  list: DashList;
};

type Params = Record<string, string | string[] | undefined>;

export async function prepareDashboard(
  session: SessionUser, id: string, sp: Params, opts: { touch?: boolean } = {},
): Promise<PreparedDashboard | PreparedCentre | { notFound: true }> {
  return withTenant(session.tenantId, async (tx) => {
    await ensureSystemDashboards(tx, session.tenantId);
    const v = await viewerFacts(tx, session);
    const hit = await loadDashboard(tx, v, id);
    if (!hit || hit.d.deletedAt) return { notFound: true as const };
    const d = hit.d;
    const sys = systemDef(d);
    if (sys?.centre) {
      const [prefs, list] = await inOrder(() => loadPrefs(tx, session, d.id), () => listDashboards(tx, v));
      if (opts.touch) await touchOpened(tx, session, d.id);
      return {
        centre: sys.centre,
        id: d.id,
        name: d.name,
        description: d.description,
        systemKey: sys.key,
        filterConfig: sys.filters,
        saved: prefs.saved,
        isFavourite: prefs.isFavourite,
        isDefault: prefs.isDefault,
        canManage: canManageDashboards(session),
        canShare: canShare(v, d),
        audience: sys.audience,
        list,
      };
    }

    const fc = filterConfigOf(d);
    const prefs = await loadPrefs(tx, session, d.id);
    const explicit = hasFilterParams(sp);
    const defaults: Partial<FilterState> = { period: fc.defaults?.period ?? "fy", values: fc.defaults?.values ?? {} };
    // URL first; else the viewer's saved filter; else the dashboard's defaults.
    const base = explicit ? { period: defaults.period, values: {} } : prefs.saved ?? defaults;
    let state = parseFilterState(sp, base);

    // Every card follows the viewer's record access (with their team, when
    // anyone reports to them), whatever dashboard it is on.
    const access: DataAccess = await resolveDataAccess(tx, session);
    const branches = await realBranches(tx, session.tenantId);
    const barRm = canFilterRm(access);
    const barBranch = canFilterBranch(access, branches.length);
    // Filters the viewer cannot use are dropped, never silently applied.
    const values = { ...state.values };
    if (!barRm) delete values.rm;
    if (!barBranch) delete values.branch;
    state = { ...state, values };

    const period = resolvePeriod(state.period, { from: state.from, to: state.to, fallback: defaults.period });
    const extras = (fc.fields.length ? fc.fields : EXTRA_FILTERS).filter((k) => k !== "rm" && k !== "branch");
    const wanted: FilterKey[] = [...(barRm ? (["rm"] as FilterKey[]) : []), ...(barBranch ? (["branch"] as FilterKey[]) : []), ...extras];
    const [options, thresholds, names, list] = await inOrder(
      () => loadFilterOptions(tx, session.tenantId, access, wanted),
      () => loadDashboardThresholds(tx),
      () => tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid`),
      () => listDashboards(tx, v),
    );
    if (opts.touch) await touchOpened(tx, session, d.id);

    const branchName = access.kind === "branch" ? branches.find((b) => b.id === access.branchId)?.name ?? null : null;
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      isSystem: d.isSystem,
      systemKey: d.systemKey,
      locked: d.isSystem || d.locked,
      layout: layoutOf(d),
      filterConfig: fc,
      state,
      saved: prefs.saved,
      usingSaved: !explicit && !!prefs.saved,
      period,
      access,
      showing: accessLabel(access, branchName),
      bar: { rm: barRm, branch: barBranch, extras, pinned: fc.pinned ?? [] },
      options,
      cards: prefs.cards,
      isFavourite: prefs.isFavourite,
      isDefault: prefs.isDefault,
      canEdit: canEdit(v, d, hit.shares),
      canShare: canShare(v, d),
      canDelete: canShareOrDelete(v, d),
      canManage: canManageDashboards(session),
      audience: sys?.audience ?? null,
      list,
      base: {
        session,
        tenantId: session.tenantId,
        access,
        thresholds: thresholds as DashboardThresholds,
        branchCount: branches.length,
        userNames: new Map((names.rows as Array<{ id: string; name: string | null }>).map((r) => [r.id, r.name ?? "—"])),
        branchNames: new Map(branches.map((b) => [b.id, b.name])),
      },
    };
  });
}

/** The context one card renders with: the dashboard's filters, or the viewer's card filter over them. */
export function widgetCtx(p: PreparedDashboard, item: LayoutItem): { ctx: WidgetCtx; cardFilter: FilterState | null } {
  const card = p.cards[item.id] ?? null;
  const state: FilterState = card
    ? { ...p.state, period: card.period, from: card.from, to: card.to }
    : p.state;
  const period = card ? resolvePeriod(card.period, { from: card.from, to: card.to, fallback: p.state.period }) : p.period;
  return {
    ctx: { ...p.base, state, period, scope: scopeFor(p.base.tenantId, p.base.session, p.access, state) },
    cardFilter: card,
  };
}

/** Labels of active filters this widget cannot use — shown as "Filter not applied". */
export function notAppliedFor(p: PreparedDashboard, item: LayoutItem): string[] {
  const meta = SYSTEM_WIDGETS_BY_KEY[item.widgetKey];
  if (!meta) return [];
  const out = activeFilterKeys(p.state)
    .filter((k) => !meta.supports.includes(k))
    .map((k) => FILTER_FIELDS[k].label);
  // Period is only called out when someone moved it off the dashboard's default.
  const defaultPeriod = p.filterConfig.defaults?.period ?? "fy";
  if (!meta.supports.includes("period") && p.state.period !== defaultPeriod) out.unshift("Period");
  return out;
}
