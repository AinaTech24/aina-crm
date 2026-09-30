/**
 * Dashboard filters — pure and client-safe. The URL is the state:
 *
 *   ?period=fy&from=&to=&rm=a,b&branch=c&seg=HNI&cat=A&amc=…&prod=mf&src=referral&tag=…&fam=…
 *
 * so a filtered view can be shared as a link and a reload keeps it. "Save
 * filter" stores the same state per user and dashboard
 * (dashboard_user_prefs.saved_filters) and is applied when the URL carries no
 * filter of its own.
 *
 * Period is always there. RM and Branch sit on the bar when they apply to the
 * viewer. The rest are added from "+ Filter" — at most three, from the list the
 * dashboard offers (its filter config).
 */

import { isPeriodKey, type PeriodKey } from "./period";

export const FILTER_KEYS = [
  "rm", "branch", "segment", "category", "amc", "product", "leadSource", "tags", "family",
  // Operations only.
  "status", "executive", "requestType", "priority", "slaState", "pendingWith",
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export type FilterField = {
  key: FilterKey;
  label: string;
  /** URL param. The ops fields keep the Operations page's existing names. */
  param: string;
};

export const FILTER_FIELDS: Record<FilterKey, FilterField> = {
  rm: { key: "rm", label: "RM", param: "rm" },
  branch: { key: "branch", label: "Branch", param: "branch" },
  segment: { key: "segment", label: "Client segment", param: "seg" },
  category: { key: "category", label: "Client category", param: "cat" },
  amc: { key: "amc", label: "AMC", param: "amc" },
  product: { key: "product", label: "Product type", param: "prod" },
  leadSource: { key: "leadSource", label: "Lead source", param: "src" },
  tags: { key: "tags", label: "Tags", param: "tag" },
  family: { key: "family", label: "Family", param: "fam" },
  status: { key: "status", label: "Status", param: "st" },
  executive: { key: "executive", label: "Executive", param: "exec" },
  requestType: { key: "requestType", label: "Request type", param: "kind" },
  priority: { key: "priority", label: "Priority", param: "prio" },
  slaState: { key: "slaState", label: "SLA state", param: "sla" },
  pendingWith: { key: "pendingWith", label: "Pending with", param: "pw" },
};

/** The "+ Filter" fields every business dashboard may offer (D9). */
export const EXTRA_FILTERS: FilterKey[] = ["segment", "category", "amc", "product", "leadSource", "tags", "family"];

/** At most this many "+ Filter" fields at once. */
export const MAX_EXTRA_FILTERS = 3;

export type FilterValues = Partial<Record<FilterKey, string[]>>;

export type FilterState = {
  period: PeriodKey;
  from?: string;
  to?: string;
  values: FilterValues;
};

/** A dashboard's filter configuration (dashboards.filter_config). */
export type FilterConfig = {
  /** Fields offered under "+ Filter", in order. */
  fields: FilterKey[];
  /** Fields always on the bar after Period (Operations: RM, Status). */
  pinned?: FilterKey[];
  /** Defaults applied when neither the URL nor a saved filter sets them. */
  defaults?: { period?: PeriodKey; values?: FilterValues };
};

const csv = (v: string | undefined | null) =>
  (v ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 50);

type Params = Record<string, string | string[] | undefined>;
const one = (sp: Params, k: string) => {
  const v = sp[k];
  return Array.isArray(v) ? v[0] : v;
};

/** True when the URL sets any dashboard filter (so a saved filter is not applied over it). */
export function hasFilterParams(sp: Params): boolean {
  if (one(sp, "period")) return true;
  return FILTER_KEYS.some((k) => !!one(sp, FILTER_FIELDS[k].param));
}

/** Read the filter state from the URL, over `base` (a saved filter or the dashboard's defaults). */
export function parseFilterState(sp: Params, base?: Partial<FilterState> | null): FilterState {
  const period = one(sp, "period");
  const values: FilterValues = { ...(base?.values ?? {}) };
  for (const k of FILTER_KEYS) {
    const raw = one(sp, FILTER_FIELDS[k].param);
    if (raw != null) {
      const v = csv(raw);
      if (v.length) values[k] = v;
      else delete values[k];
    }
  }
  const periodKey = isPeriodKey(period) ? period : base?.period && isPeriodKey(base.period) ? base.period : "fy";
  return {
    period: periodKey,
    from: one(sp, "from") ?? (periodKey === "custom" ? base?.from : undefined),
    to: one(sp, "to") ?? (periodKey === "custom" ? base?.to : undefined),
    values,
  };
}

/** The state as query params (empty values dropped). */
export function filterStateToParams(state: FilterState): URLSearchParams {
  const p = new URLSearchParams();
  p.set("period", state.period);
  if (state.period === "custom") {
    if (state.from) p.set("from", state.from);
    if (state.to) p.set("to", state.to);
  }
  for (const k of FILTER_KEYS) {
    const v = state.values[k];
    if (v?.length) p.set(FILTER_FIELDS[k].param, v.join(","));
  }
  return p;
}

/** Keys with at least one value. */
export function activeFilterKeys(state: FilterState): FilterKey[] {
  return FILTER_KEYS.filter((k) => (state.values[k]?.length ?? 0) > 0);
}

/** Sanitise a stored/posted state: known keys, bounded lists, valid period. */
export function sanitizeFilterState(input: unknown): FilterState | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const values: FilterValues = {};
  const v = (r.values && typeof r.values === "object" ? r.values : {}) as Record<string, unknown>;
  for (const k of FILTER_KEYS) {
    const list = v[k];
    if (Array.isArray(list)) {
      const clean = list.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 120).slice(0, 50);
      if (clean.length) values[k] = clean;
    }
  }
  const dateOk = (x: unknown) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);
  return {
    period: isPeriodKey(r.period) ? r.period : "fy",
    from: dateOk(r.from) ? (r.from as string) : undefined,
    to: dateOk(r.to) ? (r.to as string) : undefined,
    values,
  };
}

export function sanitizeFilterConfig(input: unknown): FilterConfig | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const keys = (x: unknown) =>
    Array.isArray(x) ? (x.filter((k) => (FILTER_KEYS as readonly string[]).includes(k as string)) as FilterKey[]) : [];
  const d = r.defaults && typeof r.defaults === "object" ? (r.defaults as Record<string, unknown>) : null;
  const defaults = d ? sanitizeFilterState({ period: d.period, values: d.values }) : null;
  return {
    fields: keys(r.fields),
    pinned: keys(r.pinned),
    defaults: defaults ? { period: isPeriodKey(d?.period) ? (d!.period as PeriodKey) : undefined, values: defaults.values } : undefined,
  };
}
