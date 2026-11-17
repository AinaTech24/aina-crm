/**
 * MasterStroke parity — package a1: the four rate × period ready reckoners
 * (#21, #22, #37, #38) and the Step-Up SIP reckoner's ₹1,000 display rounding
 * (#34). Every case-study figure, at the rounding the reference prints.
 */

import { describe, expect, it } from "vitest";
import {
  computeReadyReckoner, displayCell, cleanPeriods, cleanRates, type ReckonerMode,
} from "@/lib/calculators/ready-reckoner";
import { computeReckoner, roundToThousand } from "@/lib/calculators/stepup-reckoner";

function grid(mode: ReckonerMode, amount: number, rates: number[], years: number[]): number[][] {
  const r = computeReadyReckoner({ mode, amount, ratesPct: rates, years });
  expect(r.valid).toBe(true);
  expect(r.rates).toEqual(rates);
  expect(r.years).toEqual(years);
  return r.cells.map((row) => row.map((v) => displayCell(v, r.unit)));
}

describe("#22 Lumpsum FV ready reckoner (₹5,00,000; ₹ lakh 2 dp)", () => {
  it("matches all 15 cells, rows = rates, columns = years", () => {
    expect(grid("lumpsum_fv", 500000, [10, 12, 15], [5, 10, 15, 20, 25])).toEqual([
      [8.05, 12.97, 20.89, 33.64, 54.17],
      [8.81, 15.53, 27.37, 48.23, 85.0],
      [10.06, 20.23, 40.69, 81.83, 164.59],
    ]);
  });
});

describe("#21 Lumpsum need-based ready reckoner (target ₹1 crore; ₹ lakh 2 dp)", () => {
  it("matches all 15 cells", () => {
    expect(grid("lumpsum_need", 10000000, [10, 12, 15], [5, 10, 15, 20, 25])).toEqual([
      [62.09, 38.55, 23.94, 14.86, 9.23],
      [56.74, 32.2, 18.27, 10.37, 5.88],
      [49.72, 24.72, 12.29, 6.11, 3.04],
    ]);
  });
  it("lumpsum needed for 1 Cr @12% / 25y is ₹5,88,233", () => {
    const r = computeReadyReckoner({ mode: "lumpsum_need", amount: 1e7, ratesPct: [12], years: [25] });
    expect(Math.round(r.cells[0][0])).toBe(588233);
  });
});

describe("#37 SIP FV ready reckoner (₹10,000/month; ₹ lakh 2 dp)", () => {
  it("matches all 15 cells", () => {
    expect(grid("sip_fv", 10000, [10, 12, 15], [5, 10, 15, 20, 25])).toEqual([
      [7.72, 20.15, 40.16, 72.4, 124.32],
      [8.11, 22.4, 47.59, 91.99, 170.22],
      [8.73, 26.3, 61.64, 132.71, 275.66],
    ]);
  });
});

describe("#38 SIP need-based ready reckoner (target ₹1 crore; ₹)", () => {
  it("matches all 15 cells to the rupee", () => {
    expect(grid("sip_need", 10000000, [10, 12, 15], [10, 15, 20, 25, 30])).toEqual([
      [49638, 24899, 13812, 8044, 4809],
      [44636, 21011, 10871, 5875, 3246],
      [38020, 16224, 7535, 3628, 1776],
    ]);
  });
});

describe("ready reckoner input rules", () => {
  it("keeps entry order, skips blanks, caps at 3 rates / 5 periods", () => {
    expect(cleanRates([15, null, 10, 12, 8])).toEqual([15, 10, 12]);
    expect(cleanPeriods([25, 5, null, 0, 10, 15, 20, 30])).toEqual([25, 5, 10, 15, 20]);
  });
  it("transposed order follows the entry order", () => {
    const r = computeReadyReckoner({ mode: "lumpsum_fv", amount: 500000, ratesPct: [15, 10], years: [25, 5] });
    expect(r.cells.map((row) => row.map((v) => displayCell(v, "lakh")))).toEqual([
      [164.59, 10.06],
      [54.17, 8.05],
    ]);
  });
  it("rate 0 returns the amount; an empty amount is invalid", () => {
    const r = computeReadyReckoner({ mode: "lumpsum_fv", amount: 500000, ratesPct: [0], years: [10] });
    expect(r.cells[0][0]).toBe(500000);
    expect(computeReadyReckoner({ mode: "sip_need", amount: 0, ratesPct: [12], years: [10] }).valid).toBe(false);
  });
});

describe("#34 SIP + step-up SIP ready reckoner (₹10,000, 12%, +10% / +₹2,000; nearest ₹1,000)", () => {
  const want: Record<number, number[]> = {
    // [reg inv, reg FV, pct inv, pct FV, amt inv, amt FV]
    10: [1200000, 2240000, 1912000, 3269000, 2280000, 3847000],
    15: [1800000, 4759000, 3813000, 8275000, 4320000, 9500000],
    20: [2400000, 9199000, 6873000, 18631000, 6960000, 20274000],
    25: [3000000, 17022000, 11802000, 39355000, 10200000, 40073000],
    30: [3600000, 30810000, 19739000, 79858000, 14040000, 75776000],
  };
  const res = computeReckoner({ monthly: 10000, ratePct: 12, periods: [10, 15, 20, 25, 30], stepUpPct: 10, stepUpAmount: 2000 });
  it("matches all 30 cells after rounding to ₹1,000", () => {
    expect(res.rows.map((r) => r.years)).toEqual([10, 15, 20, 25, 30]);
    for (const r of res.rows) {
      const got = [
        r.regular.invested, r.regular.corpus,
        r.stepPct!.invested, r.stepPct!.corpus,
        r.stepAmt!.invested, r.stepAmt!.corpus,
      ].map(roundToThousand);
      expect(got).toEqual(want[r.years]);
    }
  });
  it("exact values stay available (10y % step-up invested 19,12,491)", () => {
    expect(Math.round(res.rows[0].stepPct!.invested)).toBe(1912491);
    expect(Math.round(res.rows[0].regular.corpus)).toBe(2240359);
  });
});
