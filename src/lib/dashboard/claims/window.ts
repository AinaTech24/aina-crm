/**
 * The Insurance Claims Control Centre's window: who is looking (scope), what
 * they filtered to, the period, and the firm's claim thresholds with the
 * viewer's own presets over them. Every loader takes one of these.
 *
 * Filters come in two kinds. RECORDED ones (line, product, claim type,
 * status, mode, branch, RM, owner, insurer, value band) narrow the claim set
 * in SQL. DERIVED ones (pending with, document status, SLA state, ageing
 * bucket, outcome, next action with) describe a claim's state today, are
 * computed from the set (./set.ts), and so only ever match open claims —
 * except outcome, which only matches closed ones.
 */

import { sql, type SQL } from "drizzle-orm";
import type { withTenant } from "@/db/client";
import type { DashboardThresholds } from "@/lib/dashboard/thresholds";
import { inList, typesOfGroups, typesOfLine } from "@/lib/insurance/book";
import { CLAIM_VALUE_BANDS } from "@/lib/insurance/claims-book";

export type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];
export type Row = Record<string, unknown>;

/** Claims are firm-wide for the claims team; a branch-locked head sees their branch. */
/**
 * Whose claims: the firm's, a branch's, or — for someone the Claims Dashboard
 * was shared with who cannot see the claims register — the claims of their own
 * clients and the claims they own.
 */
export type ClaimScope = { kind: "firm" } | { kind: "branch"; branchId: string } | { kind: "self"; userId: string };

export type ClaimFilter = {
  line?: "personal" | "commercial";
  groups?: string[];
  claimType?: string;
  statuses?: string[];
  /** A claim mode, or "none" for claims with no mode recorded. */
  mode?: string;
  branchId?: string;
  /** The client's RM (investors.rm_id). */
  rmId?: string;
  /** The claim's owner — its own RM field (insurance_claims.rm_id) — or "none". */
  ownerId?: string;
  /** Insurer, as the lower-cased trimmed name. */
  insurer?: string;
  band?: string;
  // derived — see set.ts
  pendingWith?: string;
  docs?: "complete" | "partial" | "none";
  sla?: "within" | "approaching" | "breached";
  age?: string;
  outcome?: "settled_fully" | "settled_partially" | "rejected" | "withdrawn";
  /** Whose open follow-up the claim's next action is, or "none". */
  actionWith?: string;
};

export type ClaimWindow = {
  tenantId: string;
  userId: string;
  scope: ClaimScope;
  filter: ClaimFilter;
  from: string;
  to: string;
  periodLabel: string;
  prevFrom: string;
  prevTo: string;
  prevLabel: string;
  fyStart: string;
  today: string;
  t: DashboardThresholds;
  /** The high-value line on this view (the firm's, or a preset the viewer picked). */
  highValue: number;
  /** "No update for N days" on this view. */
  noUpdateDays: number;
  /** A client is due an update after N days without one, on this view. */
  clientUpdateDays: number;
};

export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

export const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Whole days from a to b (ISO dates), b later. */
export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** India calendar date of an instant. */
export const istDate = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const x = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(x.getTime()) ? null : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(x);
};
export const fyStartOf = (iso: string): string => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return `${m >= 4 ? y : y - 1}-04-01`;
};
export const fyLabelOf = (iso: string): string => {
  const s = Number(fyStartOf(iso).slice(0, 4));
  return `FY ${s}-${String((s + 1) % 100).padStart(2, "0")}`;
};
export const monthStart = (iso: string): string => `${iso.slice(0, 7)}-01`;
export const monthBefore = (iso: string): string => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return `${py}-${String(pm).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
};

/** The recorded filters and the scope, against the claim set's columns (alias `x`). */
export function recordedWhere(w: ClaimWindow, a = "x"): SQL {
  const c = (col: string) => sql.raw(`${a}.${col}`);
  const f = w.filter;
  const parts: SQL[] = [];
  if (w.scope.kind === "branch") parts.push(sql`${c("branch_id")} = ${w.scope.branchId}`);
  if (w.scope.kind === "self") parts.push(sql`(${c("client_rm_id")} = ${w.scope.userId} OR ${c("owner_id")} = ${w.scope.userId})`);
  if (f.line) parts.push(sql`${c("policy_type")} IN (${inList(typesOfLine(f.line))})`);
  if (f.groups?.length) parts.push(sql`${c("policy_type")} IN (${inList(typesOfGroups(f.groups))})`);
  if (f.claimType) parts.push(sql`${c("claim_type")} = ${f.claimType}`);
  if (f.statuses?.length) parts.push(sql`${c("status")} IN (${inList(f.statuses)})`);
  if (f.mode === "none") parts.push(sql`${c("claim_mode")} IS NULL`);
  else if (f.mode) parts.push(sql`${c("claim_mode")} = ${f.mode}`);
  if (f.branchId) parts.push(sql`${c("branch_id")} = ${f.branchId}`);
  if (f.rmId) parts.push(sql`${c("client_rm_id")} = ${f.rmId}`);
  if (f.ownerId === "none") parts.push(sql`${c("owner_id")} IS NULL`);
  else if (f.ownerId) parts.push(sql`${c("owner_id")} = ${f.ownerId}`);
  if (f.insurer) parts.push(sql`${c("insurer_key")} = ${f.insurer.trim().toLowerCase()}`);
  if (f.band) {
    const b = CLAIM_VALUE_BANDS.find((x) => x.key === f.band);
    if (b) parts.push(b.hi == null ? sql`${c("claimed")} >= ${b.lo}` : sql`${c("claimed")} >= ${b.lo} AND ${c("claimed")} < ${b.hi}`);
  }
  return parts.length ? sql.join(parts, sql` AND `) : sql`TRUE`;
}

export const hasFilter = (w: ClaimWindow): boolean => Object.values(w.filter).some((v) => (Array.isArray(v) ? v.length > 0 : v != null && v !== ""));
