/**
 * The strategic objective (The E-Myth Revisited): the owner's primary aim —
 * what they want the practice to give them, and when — turned into figures the
 * firm can be measured against, and a path from where it stood (the baseline)
 * to the objective, year by year.
 *
 * Years are Indian financial years named by the year they END in: FY2031 is
 * April 2030 – March 2031. The baseline is captured on the first save and
 * stands at the day it was captured; the path runs from there to 31 March of
 * the objective year.
 *
 * Money (AUM, SIP book, revenue) grows on a compound path (a constant annual
 * rate — CAGR); counts (clients, team, owner hours) on a straight line.
 *
 * SERVER-ONLY for the loaders; the path maths at the top is pure.
 */

import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { firmStrategy, type StrategyFigures } from "@/db/schema";
import { getAUM, getActiveClients } from "@/lib/metrics/clients";
import { getSipBook } from "@/lib/metrics/sip";
import { getBrokerage } from "@/lib/metrics/practice";
import { getTarget } from "@/lib/metrics/targets";

/* ───────────────────────────── vocabulary ───────────────────────────── */

export type FigureKey = keyof Required<StrategyFigures>;
export const FIGURE_KEYS: FigureKey[] = ["aum", "clients", "sipBook", "revenue", "teamSize", "ownerHoursPerWeek"];

export const FIGURES: Record<FigureKey, { label: string; unit: "inr" | "count" | "hours"; compound: boolean; hint: string }> = {
  aum: { label: "AUM", unit: "inr", compound: true, hint: "Assets under management of live clients" },
  clients: { label: "Clients", unit: "count", compound: false, hint: "Live clients" },
  sipBook: { label: "SIP book (monthly)", unit: "inr", compound: true, hint: "Monthly SIP of live clients" },
  revenue: { label: "Revenue (12 months)", unit: "inr", compound: true, hint: "Brokerage over the last 12 statement months" },
  teamSize: { label: "Team", unit: "count", compound: false, hint: "Active team members" },
  ownerHoursPerWeek: { label: "Owner's hours a week", unit: "hours", compound: false, hint: "Hours the owner works IN the practice" },
};

/**
 * The stored baseline also carries the day it was captured and — because the
 * CRM cannot measure it — the owner's own latest statement of their hours.
 */
export type StoredBaseline = StrategyFigures & { capturedOn?: string; ownerHoursNow?: number; ownerHoursNowOn?: string };

/* ──────────────────────────── pure maths ──────────────────────────── */

/** The FY (named by its end year) a date falls in: 8 Oct 2026 → 2027. */
export function fyEndYear(d: Date | string): number {
  const iso = typeof d === "string" ? d : istDate(d);
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m >= 4 ? y + 1 : y;
}

/** How much of the FY ending `fy` has passed on `d` (0–1). */
export function fyElapsed(d: Date | string, fy = fyEndYear(d)): number {
  const iso = typeof d === "string" ? d : istDate(d);
  const start = Date.UTC(fy - 1, 3, 1);
  const end = Date.UTC(fy, 3, 1);
  const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.min(1, Math.max(0, (t - start) / (end - start)));
}

/** "2026-27" for the FY ending 2027. */
export function fyLabelOf(fyEnd: number): string {
  return `${fyEnd - 1}-${String(fyEnd % 100).padStart(2, "0")}`;
}

export function istDate(d: Date): string {
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export type ObjectivePath = {
  /** True when the path compounds (money with a positive baseline and target). */
  compound: boolean;
  /** Each FY on the path and the figure needed by its end (31 March). */
  points: Array<{ fy: number; needed: number }>;
  /** Needed by the end of the current FY. */
  neededThisYear: number;
  /**
   * Where the path stood at the start of the current FY (1 April). In the
   * baseline's own FY the path is carried back at the same rate, so "the path
   * asks you to add X this year" covers the whole FY, as an annual target does.
   */
  neededAtYearStart: number;
  /** Where the path stands today. */
  expectedNow: number;
  /** Compound: the annual growth rate (0.12 = 12% a year). Straight: the change per year. */
  perYear: number;
};

/**
 * The path from `baseline` to `target` by the end of FY `objectiveYear`: the
 * figure needed by the end of each FY. Time runs continuously: the baseline
 * stands `baselineElapsed` (0–1) of the way through FY `baselineYear` — the
 * day it was captured — and today is `elapsed` of the way through
 * `currentYear`. So a baseline captured today reads exactly on track today.
 *
 * `compound` is honoured only when both ends are positive; otherwise straight.
 * Null when either end is missing or the objective ends before the baseline.
 */
export function pathToObjective(
  baseline: number | null | undefined,
  target: number | null | undefined,
  baselineYear: number,
  objectiveYear: number,
  currentYear: number,
  opts: { compound?: boolean; elapsed?: number; baselineElapsed?: number } = {},
): ObjectivePath | null {
  if (baseline == null || target == null || !Number.isFinite(baseline) || !Number.isFinite(target)) return null;
  if (objectiveYear < baselineYear) return null;
  const clamp01 = (x: number | undefined, d: number) => Math.min(1, Math.max(0, x ?? d));
  // Positions on a continuous FY scale: FY Y runs from Y - 1 (1 April) to Y (31 March).
  const b = baselineYear - 1 + clamp01(opts.baselineElapsed, 0);
  const end = objectiveYear;
  const span = end - b;
  if (span <= 0) return null;
  const compound = !!opts.compound && baseline > 0 && target > 0;
  const rate = compound ? Math.pow(target / baseline, 1 / span) - 1 : (target - baseline) / span;
  // Never past the objective; before the baseline the path is carried back at its rate.
  const at = (p: number): number => {
    const t = Math.min(end, p) - b;
    return compound ? baseline * Math.pow(1 + rate, t) : baseline + rate * t;
  };
  const points = Array.from({ length: objectiveYear - baselineYear + 1 }, (_, i) => ({
    fy: baselineYear + i,
    needed: at(baselineYear + i),
  }));
  const cy = Math.min(objectiveYear, Math.max(baselineYear, currentYear));
  const now = currentYear - 1 + clamp01(opts.elapsed, 1);
  return {
    compound,
    points,
    neededThisYear: at(cy),
    neededAtYearStart: at(cy - 1),
    expectedNow: at(Math.max(b, now)),
    perYear: rate,
  };
}

/** Up when the objective is above the baseline (AUM); down when below (owner hours). */
export function direction(baseline: number, target: number): "up" | "down" {
  return target < baseline ? "down" : "up";
}

/**
 * Where the figure stands against what this FY needs, as a %: current ÷
 * needed going up, needed ÷ current going down. Null without a current figure.
 */
export function progressPct(current: number | null | undefined, needed: number, dir: "up" | "down"): number | null {
  if (current == null || !Number.isFinite(current)) return null;
  if (dir === "up") return needed > 0 ? Math.round((current / needed) * 1000) / 10 : null;
  return current > 0 ? Math.round((needed / current) * 1000) / 10 : null;
}

export type TrackStatus = "on_track" | "behind" | "well_behind" | "no_data";

/**
 * Against where the path stands today: on track at or past it, behind within
 * `tolerance` (10%) of it, well behind beyond. "no_data" without a figure.
 */
export function trackStatus(current: number | null | undefined, expectedNow: number, dir: "up" | "down", tolerance = 0.1): TrackStatus {
  if (current == null || !Number.isFinite(current)) return "no_data";
  if (expectedNow === 0) return dir === "up" ? (current >= 0 ? "on_track" : "behind") : (current <= 0 ? "on_track" : "well_behind");
  const shortfall = dir === "up" ? (expectedNow - current) / Math.abs(expectedNow) : (current - expectedNow) / Math.abs(expectedNow);
  if (shortfall <= 0) return "on_track";
  return shortfall <= tolerance ? "behind" : "well_behind";
}

/** Strip a figures object to finite positive-or-zero numbers. */
export function cleanFigures(f: StrategyFigures | null | undefined): StrategyFigures {
  const out: StrategyFigures = {};
  for (const k of FIGURE_KEYS) {
    const v = f?.[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

/* ──────────────────────────── loaders ──────────────────────────── */

export type Strategy = {
  primaryAim: string | null;
  objectiveYear: number | null;
  targets: StrategyFigures;
  baseline: StoredBaseline;
  /** FY (end year) the baseline was captured in, and how far through it (0–1). */
  baselineYear: number | null;
  baselineElapsed: number;
  updatedAt: string | null;
};

export async function loadStrategy(tx: Tx, tenantId: string): Promise<Strategy | null> {
  const [row] = await tx.select().from(firmStrategy).where(eq(firmStrategy.tenantId, tenantId)).limit(1);
  if (!row) return null;
  const baseline = (row.baseline ?? {}) as StoredBaseline;
  const capturedOn = typeof baseline.capturedOn === "string" ? baseline.capturedOn : null;
  const hasBaseline = FIGURE_KEYS.some((k) => baseline[k] != null);
  return {
    primaryAim: row.primaryAim,
    objectiveYear: row.objectiveYear,
    targets: cleanFigures(row.targets),
    baseline,
    baselineYear: hasBaseline ? fyEndYear(capturedOn ?? istDate(row.updatedAt)) : null,
    baselineElapsed: hasBaseline ? fyElapsed(capturedOn ?? istDate(row.updatedAt)) : 0,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Each figure as the CRM has it today; null where the CRM cannot say (never 0 for "unknown"). */
export type CurrentFigures = Record<FigureKey, number | null> & { revenueNote: string | null };

export async function currentFigures(tx: Tx, tenantId: string, now = new Date()): Promise<CurrentFigures> {
  const scope = { tenantId };
  const aum = await getAUM(tx, scope);
  const clients = await getActiveClients(tx, scope);
  const sip = await getSipBook(tx, scope);
  const team = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM users
     WHERE tenant_id = ${tenantId}::uuid AND status = 'active' AND deleted_at IS NULL
       AND NOT (roles::text[] && ARRAY['investor', 'platform_admin']::text[])
  `)).rows[0] as { n: number } | undefined;

  // Revenue: brokerage over the last 12 statement months — only when twelve are on record.
  const today = istDate(now);
  const brk = await getBrokerage(tx, tenantId, { from: today, to: today }, 13);
  let revenue: number | null = null;
  let revenueNote: string | null = null;
  if (brk.latestMonth) {
    const [ly, lm] = brk.latestMonth.split("-").map(Number);
    const firstIdx = ly * 12 + (lm - 1) - 11;
    const last12 = brk.byMonth.filter((m) => {
      const [y, mm] = m.month.split("-").map(Number);
      return y * 12 + (mm - 1) >= firstIdx;
    });
    if (last12.length >= 12) revenue = last12.reduce((s, m) => s + m.amount, 0);
    else revenueNote = `Only ${last12.length} of the last 12 months' brokerage statements are imported.`;
  } else {
    revenueNote = "No brokerage statement has been imported.";
  }

  return {
    aum: aum.aum,
    clients: clients.clients,
    sipBook: sip.monthly,
    revenue,
    teamSize: Number(team?.n ?? 0),
    // The CRM does not record the owner's hours; the owner states them.
    ownerHoursPerWeek: null,
    revenueNote,
  };
}

export type StrategyInput = {
  primaryAim: string | null;
  objectiveYear: number;
  targets: StrategyFigures;
  /** The owner's hours a week today — the CRM cannot measure it. */
  ownerHoursNow?: number | null;
  /** Capture a fresh baseline from today's figures. */
  rebaseline?: boolean;
};

/** Saves the objective. The first save (or a rebaseline) captures today's figures as the baseline. */
export async function saveStrategy(tx: Tx, tenantId: string, userId: string, input: StrategyInput): Promise<Strategy> {
  const existing = await loadStrategy(tx, tenantId);
  const today = istDate(new Date());
  let baseline: StoredBaseline | undefined;
  if (!existing || existing.baselineYear == null || input.rebaseline) {
    const now = await currentFigures(tx, tenantId);
    baseline = { capturedOn: today };
    for (const k of FIGURE_KEYS) {
      const v = now[k];
      if (v != null) baseline[k] = v;
    }
    const hours = input.ownerHoursNow ?? existing?.baseline.ownerHoursNow ?? null;
    if (hours != null) {
      baseline.ownerHoursPerWeek = hours;
      baseline.ownerHoursNow = hours;
      baseline.ownerHoursNowOn = today;
    }
  } else if (input.ownerHoursNow != null) {
    // A later statement of the owner's hours is "now", never a new baseline.
    baseline = { ...existing.baseline, ownerHoursNow: input.ownerHoursNow, ownerHoursNowOn: today };
    if (baseline.ownerHoursPerWeek == null) baseline.ownerHoursPerWeek = input.ownerHoursNow;
  }
  const values = {
    primaryAim: input.primaryAim?.trim() || null,
    objectiveYear: input.objectiveYear,
    targets: cleanFigures(input.targets),
    updatedAt: new Date(),
    updatedBy: userId,
    ...(baseline ? { baseline: baseline as StrategyFigures } : {}),
  };
  await tx
    .insert(firmStrategy)
    .values({ tenantId, ...values, baseline: (baseline ?? {}) as StrategyFigures })
    .onConflictDoUpdate({ target: firmStrategy.tenantId, set: values });
  return (await loadStrategy(tx, tenantId))!;
}

/* ───────────────────────── this FY's annual targets ───────────────────────── */

export type FyTarget = {
  value: number;
  /** A closing figure (AUM at 31 March) or an addition over the year. */
  kind: "closing" | "addition";
  source: string;
};

/**
 * This FY's firm targets for the figures the path covers, read where the firm
 * keeps them: annual_targets (firm scope, else the sum of branch targets) and
 * business_targets (Finances → Progress; new clients via lib/metrics/targets).
 */
export async function loadFyTargets(tx: Tx, tenantId: string, fy: string): Promise<Partial<Record<FigureKey, FyTarget>>> {
  const out: Partial<Record<FigureKey, FyTarget>> = {};
  const annual = (await tx.execute(sql`
    SELECT metric_key, scope_type, COUNT(*)::int AS n, SUM(target_value) AS v
      FROM annual_targets
     WHERE tenant_id = ${tenantId}::uuid AND fiscal_year = ${fy}
       AND metric_key IN ('aum', 'sip_book_addition') AND target_value > 0
       AND scope_type IN ('firm', 'branch')
     GROUP BY 1, 2
  `)).rows as Array<{ metric_key: string; scope_type: string; n: number; v: string }>;
  const firmBiz = (await tx.execute(sql`
    SELECT metric, annual_target FROM business_targets
     WHERE tenant_id = ${tenantId}::uuid AND fiscal_year = ${fy}
       AND metric IN ('aum_addition', 'sip_book_addition') AND annual_target > 0
  `)).rows as Array<{ metric: string; annual_target: string }>;
  const pickAnnual = (key: string) =>
    annual.find((r) => r.metric_key === key && r.scope_type === "firm")
    ?? annual.find((r) => r.metric_key === key && r.scope_type === "branch");
  const describe = (r: { scope_type: string; n: number }) =>
    r.scope_type === "firm" ? "firm target (Settings → Targets)" : `sum of ${r.n} branch target${r.n === 1 ? "" : "s"} (Settings → Targets)`;

  const aum = pickAnnual("aum");
  const aumAdd = firmBiz.find((r) => r.metric === "aum_addition");
  if (aum) out.aum = { value: Number(aum.v), kind: "closing", source: describe(aum) };
  else if (aumAdd) out.aum = { value: Number(aumAdd.annual_target), kind: "addition", source: "AUM addition target (Finances → Progress)" };

  const sipAdd = firmBiz.find((r) => r.metric === "sip_book_addition");
  const sipBranch = pickAnnual("sip_book_addition");
  if (sipAdd) out.sipBook = { value: Number(sipAdd.annual_target), kind: "addition", source: "SIP book addition target (Finances → Progress)" };
  else if (sipBranch) out.sipBook = { value: Number(sipBranch.v), kind: "addition", source: describe(sipBranch) };

  const nc = await getTarget(tx, { tenantId }, fy, "new_clients");
  if (nc != null) out.clients = { value: nc, kind: "addition", source: "new clients target (Finances → Progress)" };
  return out;
}

/**
 * What the path asks of this FY in the target's own terms: the closing figure,
 * or the addition from the start of the year (needed this year − path at the
 * start of the year).
 */
export function pathAskFor(path: ObjectivePath, kind: FyTarget["kind"]): number {
  return kind === "closing" ? path.neededThisYear : path.neededThisYear - path.neededAtYearStart;
}

/* ───────────────────────── the page's rows (pure) ───────────────────────── */

export type StrategyRow = {
  key: FigureKey;
  label: string;
  unit: "inr" | "count" | "hours";
  baseline: number | null;
  current: number | null;
  /** Why there is no current figure, or where it came from. */
  currentNote: string | null;
  target: number;
  dir: "up" | "down";
  path: ObjectivePath | null;
  progress: number | null;
  status: TrackStatus;
  /** This FY's annual target and what the path asks in the same terms. */
  fyTarget: (FyTarget & { pathAsk: number }) | null;
};

/** One row per figure the objective sets, with the path and this FY's target beside it. */
export function strategyRows(
  s: Strategy,
  current: CurrentFigures,
  fyTargets: Partial<Record<FigureKey, FyTarget>>,
  now: Date,
): StrategyRow[] {
  const cy = fyEndYear(now);
  const elapsed = fyElapsed(now, cy);
  const rows: StrategyRow[] = [];
  for (const key of FIGURE_KEYS) {
    const target = s.targets[key];
    if (target == null) continue;
    const meta = FIGURES[key];
    const baseline = s.baseline[key] ?? null;
    let cur = current[key];
    let currentNote: string | null = null;
    if (key === "ownerHoursPerWeek") {
      cur = s.baseline.ownerHoursNow ?? null;
      currentNote = cur == null ? "Not recorded — the CRM cannot measure it" : s.baseline.ownerHoursNowOn ? `As you stated on ${s.baseline.ownerHoursNowOn}` : null;
    } else if (key === "revenue" && cur == null) {
      currentNote = current.revenueNote;
    }
    const path = s.baselineYear != null && s.objectiveYear != null
      ? pathToObjective(baseline, target, s.baselineYear, s.objectiveYear, cy, {
          compound: meta.compound, elapsed, baselineElapsed: s.baselineElapsed,
        })
      : null;
    const dir = baseline != null ? direction(baseline, target) : "up";
    const fy = fyTargets[key];
    rows.push({
      key,
      label: meta.label,
      unit: meta.unit,
      baseline,
      current: cur,
      currentNote,
      target,
      dir,
      path,
      progress: path ? progressPct(cur, path.neededThisYear, dir) : null,
      status: path ? trackStatus(cur, path.expectedNow, dir) : "no_data",
      fyTarget: fy && path ? { ...fy, pathAsk: pathAskFor(path, fy.kind) } : null,
    });
  }
  return rows;
}
