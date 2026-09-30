/**
 * Insurance targets (§8, §44). Stored in annual_targets / kra_targets; actuals
 * always live.
 *
 *   · The firm sets its FY targets per metric (Settings → Targets → Insurance
 *     targets); annual_targets, scope 'firm'.
 *   · A branch view, or the branch filter, reads that branch's own target —
 *     the branch targets grid holds "Insurance" (insurance_business) only.
 *   · An RM (the owner filter, or someone's own book) reads their KRA target,
 *     insurance_business only.
 *   · A shorter period is held to the annual target phased by days (the firm's
 *     targetPhasing — off means "Not phased", never an invented target).
 *   · Any other filter (a line, a product, an insurer…) narrows the actuals but
 *     not the target, so the meter says it is not comparable rather than
 *     judging a subset against a whole-book target.
 */

import { sql } from "drizzle-orm";
import { phaseFraction } from "@/lib/dashboard/my/kpis";
import { loadBiz, pick } from "./business";
import { loadCorporateClients, loadNewClients } from "./clients";
import { fyLabelOf, num, type InsWindow, type Row, type Tx } from "./window";

export const INS_TARGETS = [
  { key: "insurance_business", label: "Total insurance premium", format: "currency" },
  { key: "insurance_personal", label: "Personal Lines premium", format: "currency" },
  { key: "insurance_commercial", label: "Commercial Lines premium", format: "currency" },
  { key: "insurance_new", label: "New business premium", format: "currency" },
  { key: "insurance_renewal", label: "Renewal premium", format: "currency" },
  { key: "insurance_new_clients", label: "New insurance clients", format: "count" },
  { key: "insurance_policies", label: "Policies issued", format: "count" },
  { key: "insurance_corporate_clients", label: "Corporate clients", format: "count" },
] as const;
export type InsTargetKey = (typeof INS_TARGETS)[number]["key"];
export const INS_TARGET_KEYS = new Set<string>(INS_TARGETS.map((t) => t.key));

export type TargetMeter = {
  key: InsTargetKey; label: string; format: "currency" | "count";
  annual: number | null; target: number | null; actual: number; pace: number | null; missing: string;
};

type Span = "mtd" | "qtd" | "fytd";

function spanStart(w: InsWindow, span: Span): string {
  if (span === "fytd") return w.fyStart;
  if (span === "mtd") return `${w.today.slice(0, 8)}01`;
  const m = Number(w.today.slice(5, 7));
  const qStartMonth = [4, 7, 10, 1][Math.floor(((m - 4 + 12) % 12) / 3)];
  const y = Number(w.today.slice(0, 4));
  return `${y}-${String(qStartMonth).padStart(2, "0")}-01`;
}

/** Only branch / owner narrow the book the way a target is set. */
export function targetsComparable(w: InsWindow): boolean {
  const f = w.filter;
  return !f.line && !f.groups?.length && !f.nature && !f.insurer && !f.categories?.length && !f.clientType && !f.mf
    && !f.statuses?.length && !f.band && !f.source && !f.execId;
}

export async function loadAnnualTargets(tx: Tx, w: InsWindow): Promise<Map<string, number>> {
  const fy = fyLabelOf(w.today);
  const branchId = w.scope.kind === "branch" ? w.scope.branchId : w.filter.branchId;
  const userId = w.filter.ownerId ?? (w.scope.kind === "self" ? w.scope.userId : null);
  if (userId) {
    const rows = (await tx.execute(sql`
      SELECT metric_key, annual_target AS v FROM kra_targets
       WHERE tenant_id = ${w.tenantId}::uuid AND user_id = ${userId}::uuid AND fiscal_year = ${fy} AND metric_key = 'insurance_business'
    `)).rows as Row[];
    return new Map(rows.map((r) => [String(r.metric_key), num(r.v)]));
  }
  const rows = (await tx.execute(sql`
    SELECT metric_key, target_value AS v FROM annual_targets
     WHERE tenant_id = ${w.tenantId}::uuid AND fiscal_year = ${fy}
       AND metric_key IN (${sql.join(INS_TARGETS.map((t) => sql`${t.key}`), sql`, `)})
       AND ${branchId ? sql`scope_type = 'branch' AND scope_id = ${branchId}::uuid` : sql`scope_type = 'firm' AND scope_id IS NULL`}
  `)).rows as Row[];
  return new Map(rows.filter((r) => num(r.v) > 0).map((r) => [String(r.metric_key), num(r.v)]));
}

export async function loadTargetMeters(tx: Tx, w: InsWindow, span: Span): Promise<{ span: Span; since: string; meters: TargetMeter[] }> {
  const since = spanStart(w, span);
  const to = w.today;
  const [annual, biz, nc, corp] = [
    await loadAnnualTargets(tx, w),
    await loadBiz(tx, w, [{ k: "s", from: since, to }], ["line"]),
    await loadNewClients(tx, w, since, to),
    await loadCorporateClients(tx, w, since, to),
  ];
  const all = pick(biz, "s");
  const personal = pick(biz, "s", (r) => r.d.line === "personal");
  const commercial = pick(biz, "s", (r) => r.d.line === "commercial");
  const actual: Record<InsTargetKey, number> = {
    insurance_business: all.total,
    insurance_personal: personal.total,
    insurance_commercial: commercial.total,
    insurance_new: all.newAmt,
    insurance_renewal: all.renAmt,
    insurance_new_clients: nc.total,
    insurance_policies: all.policies,
    insurance_corporate_clients: corp,
  };
  const comparable = targetsComparable(w);
  const phase = span === "fytd" ? 1 : phaseFraction(since, to, w.fyStart, w.t.targetPhasing);
  const pace = span === "fytd" ? phaseFraction(w.fyStart, to, w.fyStart, w.t.targetPhasing) : null;
  return {
    span, since,
    meters: INS_TARGETS.map((d) => {
      const a = comparable ? annual.get(d.key) ?? null : null;
      const missing = !comparable ? "Not for a filtered view" : a == null ? "Not set" : phase == null ? "Not phased" : "Not set";
      return {
        key: d.key, label: d.label, format: d.format,
        annual: a,
        target: a == null || phase == null ? null : d.format === "count" ? Math.round(a * phase * 10) / 10 : a * phase,
        actual: actual[d.key],
        pace,
        missing,
      };
    }),
  };
}

/** §44 — FY target, FYTD actual, remaining, achievement. No year-end forecast. */
export type FyRow = { key: InsTargetKey; label: string; format: "currency" | "count"; target: number | null; actual: number; remaining: number | null; pct: number | null };

export async function loadFyScorecard(tx: Tx, w: InsWindow): Promise<{ rows: FyRow[]; comparable: boolean; pace: number | null }> {
  const { meters } = await loadTargetMeters(tx, w, "fytd");
  return {
    comparable: targetsComparable(w),
    pace: phaseFraction(w.fyStart, w.today, w.fyStart, w.t.targetPhasing),
    rows: meters.map((m) => ({
      key: m.key, label: m.label, format: m.format, target: m.annual, actual: m.actual,
      remaining: m.annual == null ? null : Math.max(0, m.annual - m.actual),
      pct: m.annual && m.annual > 0 ? m.actual / m.annual : null,
    })),
  };
}
