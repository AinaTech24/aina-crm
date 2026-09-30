/**
 * The command centre's URL state, parsed once. Anything unrecognised is
 * dropped rather than trusted: ids must be uuids, keys must be in the
 * vocabulary. Default period: month to date, compared with the same slice of
 * the previous month (the brief).
 */

import { resolvePeriodRange, resolvePreviousRange, toLocalISODate, type Period } from "@/lib/dashboard/period";
import { PRODUCT_GROUPS, POLICY_STATUS_LABEL } from "@/lib/insurance/book";
import { CLAIM_GROUPS, PREMIUM_BANDS, type InsFilter } from "./window";

type SP = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const s = (sp: SP, k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
const csvIn = (raw: string, allowed: readonly string[]) => raw.split(",").map((x) => x.trim()).filter((x) => allowed.includes(x));

/** Every param the command centre owns — the scope switch drops them on the way out. */
export const INS_PARAM_KEYS = [
  "line", "nature", "grp", "branch", "rm", "exec", "insurer", "cat", "ctype", "mf", "pst", "band", "src", "cst", "ctyp", "ind", "lr",
] as const;
export const INS_VIEW_KEYS = ["tp", "rv"] as const;

export function parseInsFilter(sp: SP): InsFilter {
  const f: InsFilter = {};
  const line = s(sp, "line");
  if (line === "personal" || line === "commercial") f.line = line;
  const nature = s(sp, "nature");
  if (nature === "new" || nature === "renewal") f.nature = nature;
  const groups = csvIn(s(sp, "grp"), PRODUCT_GROUPS.map((g) => g.key));
  if (groups.length) f.groups = groups;
  if (UUID.test(s(sp, "branch"))) f.branchId = s(sp, "branch");
  if (UUID.test(s(sp, "rm"))) f.ownerId = s(sp, "rm");
  if (UUID.test(s(sp, "exec"))) f.execId = s(sp, "exec");
  const insurer = s(sp, "insurer");
  if (insurer && insurer.length <= 120) f.insurer = insurer;
  const cats = csvIn(s(sp, "cat"), ["A", "B", "C", "D", "none"]);
  if (cats.length) f.categories = cats;
  const ctype = s(sp, "ctype");
  if (ctype === "individual" || ctype === "family" || ctype === "corporate") f.clientType = ctype;
  const mf = s(sp, "mf");
  if (mf === "yes" || mf === "no") f.mf = mf;
  const pst = csvIn(s(sp, "pst"), Object.keys(POLICY_STATUS_LABEL));
  if (pst.length) f.statuses = pst;
  const band = s(sp, "band");
  if (PREMIUM_BANDS.some((b) => b.key === band)) f.band = band;
  const src = s(sp, "src");
  if (/^[a-z_]{1,40}$/.test(src)) f.source = src;
  const cst = s(sp, "cst");
  if (CLAIM_GROUPS.some((g) => g.key === cst)) f.claimGroup = cst;
  const ctyp = s(sp, "ctyp");
  if (["main_claim", "supplementary", "pre_authorization", "rider", "other"].includes(ctyp)) f.claimType = ctyp;
  const ind = s(sp, "ind");
  if (ind && ind.length <= 120) f.industry = ind;
  const lr = s(sp, "lr");
  if (lr && lr.length <= 200) f.lossReason = lr;
  return f;
}

const PERIODS = ["today", "yd", "tw", "lw", "mtd", "lm", "qtd", "lq", "fytd", "ly", "custom"];

export function parseInsPeriod(sp: SP, now = new Date()) {
  const raw = s(sp, "period");
  const period = (PERIODS.includes(raw) ? raw : "mtd") as Period;
  const opts = {
    customStart: s(sp, "pstart") || undefined,
    from: s(sp, "pfrom").slice(0, 10) || undefined,
    to: s(sp, "pto").slice(0, 10) || undefined,
  };
  const r = resolvePeriodRange(period, now, opts);
  const p = resolvePreviousRange(period, now, opts);
  return {
    period,
    from: toLocalISODate(r.fromDate),
    to: toLocalISODate(r.toDate),
    label: r.label,
    prevFrom: toLocalISODate(p.fromDate),
    prevTo: toLocalISODate(p.toDate),
    prevLabel: p.label,
  };
}

/** India calendar date for `now`. */
export function istToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}
