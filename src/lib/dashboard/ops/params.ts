/**
 * The Operations page's URL state, parsed once — by the page and by the export
 * route, so an export always carries exactly the filters on screen. Anything
 * unrecognised is dropped rather than trusted: ids must be uuids, keys must be
 * in the vocabulary.
 *
 * The params are the shared dashboard filter bar's (lib/dashboards/system/
 * filters.ts): every field is a comma-separated list — `branch`, `rm`, `exec`,
 * `kind`, `st`, `prio`, `sla`, `pw`, `cat`, `age`, `mode` — plus `period` with
 * `from` / `to` for a custom range.
 */

import { resolvePeriodRange, toLocalISODate, type Period } from "@/lib/dashboard/period";
import { formatRange } from "@/lib/dashboards/system/period";
import { AGE_BUCKETS, MODE_FILTERS, OPS_KINDS, PENDING_WITH, PRIORITIES, SLA_STATES, STATUS_FILTERS, type OpsFilter } from "./window";

type SP = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const s = (sp: SP, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] ?? "" : v ?? "").trim();
};
const list = (raw: string) => [...new Set(raw.split(",").map((x) => x.trim()).filter(Boolean))];
const listIn = (raw: string, allowed: readonly string[]) => list(raw).filter((x) => allowed.includes(x));
const uuids = (xs: string[]) => xs.filter((x) => UUID.test(x));

export function parseOpsFilter(sp: SP, userId: string): OpsFilter {
  const f: OpsFilter = {};
  const branchIds = uuids(list(s(sp, "branch")));
  if (branchIds.length) f.branchIds = branchIds;
  // RM: clients' RMs by id, and "me" — work assigned to the viewer (the old
  // Mine switch, exec=me). See OpsFilter.mine.
  const rm = list(s(sp, "rm"));
  const rmIds = uuids(rm);
  if (rmIds.length) f.rmIds = rmIds;
  if (rm.includes("me")) f.mine = userId;
  const exec = [...new Set(list(s(sp, "exec")).map((x) => (x === "me" ? userId : x)))]
    .filter((x) => x === "none" || UUID.test(x));
  if (exec.length) f.execIds = exec;
  const kinds = listIn(s(sp, "kind"), OPS_KINDS.map((k) => k.key));
  if (kinds.length) f.kinds = kinds;
  const st = listIn(s(sp, "st"), STATUS_FILTERS.map((x) => x.key));
  if (st.length) f.statuses = st;
  const pr = listIn(s(sp, "prio"), PRIORITIES.map((x) => x.key));
  if (pr.length) f.priorities = pr;
  const sla = listIn(s(sp, "sla"), SLA_STATES.map((x) => x.key));
  if (sla.length) f.sla = sla;
  const pw = listIn(s(sp, "pw"), PENDING_WITH.map((x) => x.key));
  if (pw.length) f.pendingWith = pw;
  const cat = listIn(s(sp, "cat"), ["A", "B", "C", "D", "none"]);
  if (cat.length) f.categories = cat;
  const ages = listIn(s(sp, "age"), AGE_BUCKETS.map((x) => x.key));
  if (ages.length) f.ages = ages;
  const modes = listIn(s(sp, "mode"), MODE_FILTERS.map((x) => x.key));
  if (modes.length) f.modes = modes;
  return f;
}

/**
 * The filter bar's period keys (lib/dashboards/system/period.ts) → the keys of
 * the resolver the tower's loaders and labels were built on
 * (lib/dashboard/period.ts). The URL only ever carries the bar's keys; both
 * resolvers agree on every range (Monday weeks, India FY quarters, 1 April).
 */
const BAR_PERIOD = new Map<string, Period>([
  ["today", "today"],
  ["week", "tw"],
  ["month", "mtd"],
  ["last_month", "lm"],
  ["quarter", "qtd"],
  ["fy", "fytd"],
  ["last_fy", "ly"],
  ["custom", "custom"],
]);

/** Today by default — the brief: "Default: Today + Open/Pending Records". */
export function parseOpsPeriod(sp: SP, now = new Date()) {
  const period = BAR_PERIOD.get(s(sp, "period")) ?? "today";
  const r = resolvePeriodRange(period, now, {
    from: s(sp, "from").slice(0, 10) || undefined,
    to: s(sp, "to").slice(0, 10) || undefined,
  });
  const from = toLocalISODate(r.fromDate);
  const to = toLocalISODate(r.toDate);
  return {
    period,
    from,
    to,
    // A custom range reads the way the filter bar prints it: "1 Sep – 15 Sep 2026".
    label: period === "custom" ? formatRange(from, to) : r.label,
  };
}

/** A rupee figure from the URL within sane bounds, else the fallback. */
export function parseRupees(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 10_000 && n <= 1e10 ? Math.round(n) : fallback;
}

/** India calendar date for `now`. */
export function istToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}
