/**
 * The Claims Control Centre's URL state, parsed once. Anything unrecognised
 * is dropped rather than trusted: ids must be uuids, keys must be in the
 * CRM's own picklists. Default: every open claim, with period flows for
 * month to date against the same days of last month (the brief).
 */

import { CLAIM_MODES, CLAIM_STATUSES, CLAIM_TYPES } from "@/db/schema";
import type { DashboardThresholds } from "@/lib/dashboard/thresholds";
import { PRODUCT_GROUPS } from "@/lib/insurance/book";
import { CLAIM_AGE_BUCKETS, CLAIM_CLOSED, CLAIM_OPEN, CLAIM_VALUE_BANDS, PENDING_WITH } from "@/lib/insurance/claims-book";
import type { ClaimFilter } from "./window";

type SP = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const s = (sp: SP, k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
const csvIn = (raw: string, allowed: readonly string[]) => raw.split(",").map((x) => x.trim()).filter((x) => allowed.includes(x));

/** Filters only this view reads — the scope switch drops them on the way out. */
export const CLAIM_FILTER_KEYS = [
  "line", "grp", "ctyp", "cst", "mode", "branch", "rm", "own", "insurer", "val", "pw", "doc", "sla", "age", "out", "act",
] as const;
/** View presets and toggles: high-value line, no-update days, client-update days, worklist focus, review mode, ageing order. */
export const CLAIM_VIEW_KEYS = ["hv", "nu", "cu", "wf", "rv", "as"] as const;

/** What a card can focus the worklist on (`wf`). */
export const WORKLIST_FOCUS = [
  "sla", "approaching", "escalated", "hv", "fnr", "docs", "query", "repeat", "assess", "rejected", "rejectedReview", "legal",
  "noowner", "noremark", "noaction", "actiondue", "stale", "update", "age90",
] as const;
export type WorklistFocus = (typeof WORKLIST_FOCUS)[number];

export function parseClaimFilter(sp: SP): ClaimFilter {
  const f: ClaimFilter = {};
  const line = s(sp, "line");
  if (line === "personal" || line === "commercial") f.line = line;
  const groups = csvIn(s(sp, "grp"), PRODUCT_GROUPS.map((g) => g.key));
  if (groups.length) f.groups = groups;
  const ctyp = s(sp, "ctyp");
  if ((CLAIM_TYPES as readonly string[]).includes(ctyp)) f.claimType = ctyp;
  const cst = s(sp, "cst");
  const statuses = cst === "open" ? [...CLAIM_OPEN] : cst === "closed" ? [...CLAIM_CLOSED] : csvIn(cst, CLAIM_STATUSES);
  if (statuses.length) f.statuses = statuses;
  const mode = s(sp, "mode");
  if (mode === "none" || (CLAIM_MODES as readonly string[]).includes(mode)) f.mode = mode;
  if (UUID.test(s(sp, "branch"))) f.branchId = s(sp, "branch");
  if (UUID.test(s(sp, "rm"))) f.rmId = s(sp, "rm");
  const own = s(sp, "own");
  if (own === "none" || UUID.test(own)) f.ownerId = own;
  const insurer = s(sp, "insurer");
  if (insurer && insurer.length <= 120) f.insurer = insurer;
  const val = s(sp, "val");
  if (CLAIM_VALUE_BANDS.some((b) => b.key === val)) f.band = val;
  const pw = s(sp, "pw");
  if (PENDING_WITH.some((p) => p.key === pw)) f.pendingWith = pw;
  const doc = s(sp, "doc");
  if (doc === "complete" || doc === "partial" || doc === "none") f.docs = doc;
  const sla = s(sp, "sla");
  if (sla === "within" || sla === "approaching" || sla === "breached") f.sla = sla;
  const age = s(sp, "age");
  if (CLAIM_AGE_BUCKETS.some((b) => b.key === age)) f.age = age;
  const out = s(sp, "out");
  if (out === "settled_fully" || out === "settled_partially" || out === "rejected" || out === "withdrawn") f.outcome = out;
  const act = s(sp, "act");
  if (act === "none" || UUID.test(act)) f.actionWith = act;
  return f;
}

export const HIGH_VALUE_PRESETS = [100_000, 500_000, 1_000_000, 2_500_000] as const;
export const NO_UPDATE_PRESETS = [1, 2, 3, 5, 7] as const;
export const CLIENT_UPDATE_PRESETS = [3, 7, 14] as const;

/** The viewer's presets over the firm thresholds; out-of-range values fall back to the firm's. */
export function parseClaimView(sp: SP, t: DashboardThresholds) {
  const int = (k: string, lo: number, hi: number, dflt: number) => {
    const n = Number(s(sp, k));
    return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
  };
  const wf = s(sp, "wf");
  return {
    highValue: int("hv", 10_000, 10_000_000_000, t.insHighClaim),
    noUpdateDays: int("nu", 1, 60, t.claimNoUpdateDays),
    clientUpdateDays: int("cu", 1, 60, t.claimClientUpdateDays),
    focus: (WORKLIST_FOCUS as readonly string[]).includes(wf) ? (wf as WorklistFocus) : null,
    review: s(sp, "rv") === "weekly" ? ("weekly" as const) : ("monthly" as const),
    /** The ageing detail's order (§8). */
    ageSort: (["oldest", "amount", "insurer", "type"] as const).find((k) => k === s(sp, "as")) ?? "oldest",
  };
}
