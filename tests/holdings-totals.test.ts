/**
 * The Portfolio holdings Total row: Invested, Gain and Return used to be "—" for a whole client as soon as ONE
 * scheme had no cost on record (2026-11-24). They are now computed over the schemes that have one, flagged as
 * approximate, and Return uses the same schemes as Gain.
 */
import { describe, expect, it } from "vitest";
import { computeHoldingsTotals, type TotalsHolding } from "@/lib/finance/holdings-totals";

const exact = (invested: number, current: number): TotalsHolding => ({
  netUnits: 100, investedNet: invested, currentValue: current, priced: true, hasTxns: true,
});
const noCost = (current: number): TotalsHolding => ({
  netUnits: 100, investedNet: null, investedEstimate: null, currentValue: current, priced: true, hasTxns: true,
});

describe("computeHoldingsTotals", () => {
  it("is exact when every scheme has its cost", () => {
    const t = computeHoldingsTotals([exact(400_000, 500_000), exact(100_000, 120_000)]);
    expect(t.invested).toBe(500_000);
    expect(t.gain).toBe(120_000);
    expect(t.absRet).toBeCloseTo(24, 6);
    expect(t.current).toBe(620_000);
    expect(t.approx).toBe(false);
    expect(t.costRows).toBe(2);
  });

  it("still totals when one scheme has no cost — over the others, flagged approximate", () => {
    const t = computeHoldingsTotals([exact(400_000, 500_000), noCost(540_469), exact(100_000, 120_000)]);
    expect(t.invested).toBe(500_000);
    expect(t.gain).toBe(120_000);
    expect(t.absRet).toBeCloseTo(24, 6); // the unknown-cost scheme's value is NOT in the Return maths
    expect(t.current).toBe(1_160_469); // Current value still counts every priced scheme
    expect(t.costRows).toBe(2);
    expect(t.rows).toBe(3);
    expect(t.approx).toBe(true);
  });

  it("uses an estimated cost where that is all there is, and says so", () => {
    const est: TotalsHolding = { netUnits: 76, investedNet: null, investedEstimate: 40_091, currentValue: 45_419, priced: true, hasTxns: true };
    const t = computeHoldingsTotals([exact(100_000, 110_000), est]);
    expect(t.invested).toBe(140_091);
    expect(t.gain).toBe(10_000 + 5_328);
    expect(t.approx).toBe(true);
  });

  it("leaves an unpriced scheme out of Gain and Return but not out of Invested", () => {
    const unpriced: TotalsHolding = { netUnits: 50, investedNet: 30_000, currentValue: null, priced: false, hasTxns: true };
    const t = computeHoldingsTotals([exact(100_000, 150_000), unpriced]);
    expect(t.invested).toBe(130_000);
    expect(t.gain).toBe(50_000);
    expect(t.absRet).toBeCloseTo(50, 6); // 50,000 on the 100,000 that was priced, not on 130,000
    expect(t.approx).toBe(true);
  });

  it("reads '—' (null) only when no scheme has a cost at all", () => {
    const t = computeHoldingsTotals([noCost(100_000), noCost(50_000)]);
    expect(t.invested).toBeNull();
    expect(t.gain).toBeNull();
    expect(t.absRet).toBeNull();
    expect(t.current).toBe(150_000);
  });

  it("handles an empty list", () => {
    const t = computeHoldingsTotals([]);
    expect(t.invested).toBeNull();
    expect(t.rows).toBe(0);
    expect(t.approx).toBe(false);
  });
});
