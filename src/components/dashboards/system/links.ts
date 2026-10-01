/**
 * Drill-down links. A number on a card opens its list with the SAME filters —
 * period, RM, branch and the client filters — in the params that list already
 * reads, so the count on the card is the row count in the list (D9).
 */

import type { WidgetCtx } from "./types";

type Val = string | number | null | undefined | string[];

export function qs(params: Record<string, Val>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    const s = Array.isArray(v) ? v.filter(Boolean).join(",") : String(v);
    if (s) p.set(k, s);
  }
  const out = p.toString();
  return out ? `?${out}` : "";
}

/** The client filters as the Clients list names them. */
function clientParams(ctx: WidgetCtx): Record<string, Val> {
  const s = ctx.scope;
  return {
    rm: s.rmIds,
    branch: s.branchIds,
    segment: s.segments,
    category: s.categories,
    fam: s.familyIds,
    tag: s.tags,
    src: s.leadSources,
  };
}

/** The Clients list on live clients in scope (`alive=1`: not closed, not merged). */
export function clientsHref(ctx: WidgetCtx, extra: Record<string, Val> = {}): string {
  return `/dashboard/investors${qs({ alive: "1", ...clientParams(ctx), ...extra })}`;
}

/** Every client RECORD in scope, closed included — the Client book's "By
 *  status" counts these (clientRecordWhere), so it must not add `alive=1`. */
export function clientRecordsHref(ctx: WidgetCtx, extra: Record<string, Val> = {}): string {
  return `/dashboard/investors${qs({ ...clientParams(ctx), ...extra })}`;
}

/** Clients onboarded in the period — the New clients figure. */
export function newClientsHref(
  ctx: WidgetCtx, from = ctx.period.from, to = ctx.period.to, extra: Record<string, Val> = {},
): string {
  return `/dashboard/investors${qs({ ...clientParams(ctx), onboarded_from: from, onboarded_to: to, ...extra })}`;
}

/** The SIP Book on active SIPs of clients in scope. */
export function sipsHref(ctx: WidgetCtx, extra: Record<string, Val> = {}): string {
  return `/dashboard/sips${qs({ status: "active", ...clientParams(ctx), amc: ctx.scope.amcs, ...extra })}`;
}

/** Transactions in the period for clients in scope. */
export function transactionsHref(ctx: WidgetCtx, extra: Record<string, Val> = {}): string {
  return `/dashboard/transactions${qs({
    date_from: ctx.period.from, date_to: ctx.period.to, status: "processed", ...clientParams(ctx), amc: ctx.scope.amcs, ...extra,
  })}`;
}

/** Leads created in the period, owned / captured in scope. */
export function leadsHref(ctx: WidgetCtx, extra: Record<string, Val> = {}, withPeriod = true): string {
  return `/dashboard/leads${qs({
    owner: ctx.scope.rmIds,
    branch: ctx.scope.branchIds,
    source: ctx.scope.leadSources,
    ...(withPeriod ? { created_from: ctx.period.from, created_to: ctx.period.to } : {}),
    ...extra,
  })}`;
}

/** Tasks assigned to people in scope. */
export function tasksHref(ctx: WidgetCtx, extra: Record<string, Val> = {}): string {
  const self = ctx.access.kind === "self";
  return `/dashboard/tasks${qs({
    view: self ? "to_me" : undefined,
    assignee: self ? undefined : ctx.scope.rmIds,
    branch: ctx.scope.branchIds,
    ...extra,
  })}`;
}

/** Service requests about clients in scope. */
export function serviceRequestsHref(ctx: WidgetCtx, extra: Record<string, Val> = {}): string {
  return `/dashboard/service-requests${qs({ rm: ctx.scope.rmIds, branch: ctx.scope.branchIds, ...extra })}`;
}

/** The Risk Profiles page on clients in scope. */
export function riskProfilesHref(ctx: WidgetCtx, filter: string): string {
  return `/dashboard/risk-profiles${qs({ filter, rm: ctx.scope.rmIds, branch: ctx.scope.branchIds })}`;
}
