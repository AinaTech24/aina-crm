/**
 * Judging an RM against their targets — one rule, shared by the scoreboard,
 * the target matrix and the one-on-one panel, so the three can never disagree
 * about whether an RM is on track.
 *
 * ── What is compared with what ─────────────────────────────────────────────
 *
 *   flows     the period's actual against the ANNUAL target phased to the
 *             period (see phaseFraction — linear by days, or off). With
 *             phasing off there is no shorter-period target, and the cell says
 *             "Not phased" rather than inventing one.
 *   balances  AUM and SIP book as they stand today against the annual closing
 *             target. Never phased: a closing balance is not built a twelfth
 *             at a time.
 *
 * ── The bands ──────────────────────────────────────────────────────────────
 *
 *   achieved  at or above target
 *   near      at or above the firm's near band (targetNearFraction, default
 *             80%) — configurable, because the brief forbids hard-coding a
 *             judgement threshold
 *   short     below the near band
 *
 * There is deliberately no overall score. "3 achieved · 1 near · 2 short" is a
 * count of statuses the reader can check cell by cell; a weighted blend of six
 * metrics into one number is a formula management has not approved.
 */

import type { TargetKey } from "../my/window";
import type { RmLedgerRow } from "./rm-ledger";

export type Band = "achieved" | "near" | "short";

export function bandOf(pct: number, near: number): Band {
  return pct >= 1 ? "achieved" : pct >= near ? "near" : "short";
}

export type TargetCell = {
  key: TargetKey;
  label: string;
  format: "currency" | "count";
  stock: boolean;
  annual: number | null;
  /** The target this period is held to — phased for a flow, annual for a balance. */
  target: number | null;
  actual: number;
  gap: number | null;
  pct: number | null;
  band: Band | null;
  /** Why there is no target: "Not set", "Not phased", "Other FY". */
  missing: string | null;
};

const DEFS: Array<{ key: TargetKey; label: string; format: "currency" | "count"; stock: boolean; actual: (r: RmLedgerRow) => number }> = [
  { key: "aum", label: "AUM", format: "currency", stock: true, actual: (r) => r.aum },
  { key: "sip_book", label: "SIP book", format: "currency", stock: true, actual: (r) => r.sipBook },
  { key: "net_sip", label: "Net new SIP", format: "currency", stock: false, actual: (r) => r.grossSip - r.sipStop },
  { key: "net_business", label: "Net business", format: "currency", stock: false, actual: (r) => r.grossInvestment - r.redemption },
  { key: "new_clients", label: "New clients", format: "count", stock: false, actual: (r) => r.newClients },
  { key: "meetings", label: "Meetings", format: "count", stock: false, actual: (r) => r.meetingsHeld ?? 0 },
  { key: "reviews", label: "Reviews", format: "count", stock: false, actual: (r) => r.reviewMeetings ?? 0 },
  { key: "insurance", label: "Insurance business", format: "currency", stock: false, actual: (r) => r.insurance },
];

/**
 * @param phase    share of the annual target this period carries, or null
 *                 when there is none (phasing off, or a period outside the FY)
 * @param noPhase  the reason to print when `phase` is null
 */
export function targetCells(
  r: RmLedgerRow, phase: number | null, near: number, noPhase: string,
  only?: TargetKey[],
): TargetCell[] {
  return DEFS.filter((d) => !only || only.includes(d.key)).map((d) => {
    const annual = r.targets[d.key] ?? null;
    const actual = d.actual(r);
    let target: number | null = null;
    let missing: string | null = null;
    if (annual == null) missing = "Not set";
    else if (d.stock) target = annual;
    else if (phase == null) missing = noPhase;
    else target = annual * phase;
    const pct = target != null && target > 0 ? actual / target : null;
    return {
      key: d.key, label: d.label, format: d.format, stock: d.stock,
      annual, target, actual,
      gap: target != null ? actual - target : null,
      pct,
      band: pct == null ? null : bandOf(pct, near),
      missing,
    };
  });
}

export type TargetStatus = { achieved: number; near: number; short: number; judged: number };

export function targetStatus(cells: TargetCell[]): TargetStatus {
  const s = { achieved: 0, near: 0, short: 0, judged: 0 };
  for (const c of cells) {
    if (!c.band) continue;
    s[c.band] += 1;
    s.judged += 1;
  }
  return s;
}

/** Average of two numbers where the denominator can be zero — null, never ∞. */
export function ratio(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null || b === 0) return null;
  return a / b;
}
