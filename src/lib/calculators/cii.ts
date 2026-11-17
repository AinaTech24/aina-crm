/**
 * Cost Inflation Index (CII) — the full table and cost indexation.
 *
 * The index values are the official ones notified by CBDT under Section 48 of
 * the Income-tax Act (base FY 2001-02 = 100) and come from ONE place, the CII
 * table in capital-gains.ts, which the Capital Gains Tax calculator also uses.
 *
 *   Indexed cost = cost × CII(year of sale / target FY) ÷ CII(year of purchase)
 *
 * An asset bought before 1 April 2001 takes its cost (or fair market value) as
 * on 1 April 2001, i.e. FY 2001-02's index of 100. Indexation for LTCG survives
 * after 23 July 2024 only for land / buildings bought before that date by
 * resident individuals and HUFs (who pay the lower of 20% indexed and 12.5%
 * unindexed) — the Capital Gains Tax calculator applies that rule.
 */

import { CII, CII_BASE_YEAR } from "./capital-gains";

export type CiiRow = { fyStart: number; label: string; cii: number };

/** "2001-02" for the FY starting in 2001. */
export function fyLabel(fyStart: number): string {
  return `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
}

/** Every notified year, oldest first. */
export function ciiTable(): CiiRow[] {
  return Object.keys(CII)
    .map(Number)
    .filter((y) => y >= CII_BASE_YEAR)
    .sort((a, b) => a - b)
    .map((y) => ({ fyStart: y, label: fyLabel(y), cii: CII[y] }));
}

export function latestCiiYear(): number {
  return Math.max(...Object.keys(CII).map(Number));
}

export type IndexationResult = {
  fromFy: number;
  toFy: number;
  ciiFrom: number;
  ciiTo: number;
  /** cost × ciiTo / ciiFrom, unrounded. */
  indexedCost: number;
  /** ciiTo / ciiFrom. */
  factor: number;
  /** Indexed cost − cost. */
  inflationUplift: number;
  error: string | null;
};

/**
 * Index `cost` from the FY starting `fromFy` to the FY starting `toFy`. A year
 * before 2001-02 is read as 2001-02 (the 1 April 2001 value rule).
 */
export function indexCost(cost: number, fromFy: number, toFy: number): IndexationResult {
  const from = Math.max(fromFy, CII_BASE_YEAR);
  const ciiFrom = CII[from];
  const ciiTo = CII[toFy];
  const empty = { fromFy: from, toFy, ciiFrom: ciiFrom ?? 0, ciiTo: ciiTo ?? 0, indexedCost: 0, factor: 0, inflationUplift: 0 };
  if (ciiFrom == null) return { ...empty, error: `No index notified for FY ${fyLabel(from)}.` };
  if (ciiTo == null) return { ...empty, error: `No index notified for FY ${fyLabel(toFy)}.` };
  if (toFy < from) return { ...empty, error: "The target year must be the same as or later than the purchase year." };
  const factor = ciiTo / ciiFrom;
  const indexedCost = Math.max(0, cost) * factor;
  return { fromFy: from, toFy, ciiFrom, ciiTo, indexedCost, factor, inflationUplift: indexedCost - Math.max(0, cost), error: null };
}
