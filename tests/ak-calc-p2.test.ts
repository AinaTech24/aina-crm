/**
 * Fund Research (package p2) — engines over synthetic NAV series whose answers
 * are worked out by hand in the comments. mfapi.in is not reachable from a
 * test, and none is needed: every tool is a pure function of a NAV array.
 */

import { describe, expect, it } from "vitest";
import { xnpv } from "@/lib/calculators/xirr";
import {
  addMonths, addYears, absoluteReturnPct, cagrPct, dayNum, execute, fullYearsBetween, isoFromDay,
  median, navOnOrAfter, navOnOrBefore, navSeries, sampleStd, scheduleDates, type NavPoint, type NavSeries,
} from "@/lib/fund-research/nav";
import { sipReturn } from "@/lib/fund-research/sip";
import { lumpsumReturn } from "@/lib/fund-research/lumpsum";
import { stpReturn } from "@/lib/fund-research/stp";
import { redeemFifo, swpReturn, type Lot } from "@/lib/fund-research/swp";
import { rollingReturns } from "@/lib/fund-research/rolling";
import { pointToPoint } from "@/lib/fund-research/compare";
import { periodReturns, returnGrid } from "@/lib/fund-research/periodic";

const S = (pts: Array<[string, number]>): NavSeries => navSeries(pts.map(([date, nav]) => ({ date, nav })));

/** One NAV on every calendar day from `from` to `to`, valued by `f(date)`. */
function daily(from: string, to: string, f: (iso: string) => number): NavSeries {
  const pts: NavPoint[] = [];
  for (let d = dayNum(from); d <= dayNum(to); d++) {
    const iso = isoFromDay(d);
    pts.push({ date: iso, nav: f(iso) });
  }
  return navSeries(pts);
}

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
}

describe("NAV core", () => {
  // 2024-06-08 / 09 are a Saturday and Sunday: no NAV.
  const s = S([["2024-06-10", 102], ["2024-06-07", 101], ["2024-06-06", 100], ["bad", 5], ["2024-06-11", -1]]);

  it("sorts, drops bad rows", () => {
    expect(s.dates).toEqual(["2024-06-06", "2024-06-07", "2024-06-10"]);
    expect(s.navs).toEqual([100, 101, 102]);
  });
  it("transaction on a holiday takes the NEXT NAV; valuation takes the latest on or before", () => {
    expect(navOnOrAfter(s, "2024-06-08")?.date).toBe("2024-06-10");
    expect(navOnOrBefore(s, "2024-06-08")?.date).toBe("2024-06-07");
    expect(navOnOrAfter(s, "2024-06-07")?.nav).toBe(101);
    expect(navOnOrBefore(s, "2024-06-07")?.nav).toBe(101);
    expect(navOnOrAfter(s, "2024-06-11")).toBeNull();
    expect(navOnOrBefore(s, "2024-06-05")).toBeNull();
  });
  it("execute: before launch / after end", () => {
    expect(execute(s, "2024-06-01", "2024-06-30")).toMatchObject({ ok: false, reason: "before_launch" });
    expect(execute(s, "2024-06-08", "2024-06-09")).toMatchObject({ ok: false, reason: "after_end" });
    expect(execute(s, "2024-06-08", "2024-06-30")).toMatchObject({ ok: true, hit: { date: "2024-06-10" } });
  });
  it("calendar arithmetic clamps to short months", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2023-01-31", 1)).toBe("2023-02-28");
    expect(addMonths("2023-11-30", 3)).toBe("2024-02-29");
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
    expect(fullYearsBetween("2024-01-05", "2026-01-04")).toBe(1);
    expect(fullYearsBetween("2024-01-05", "2026-01-05")).toBe(2);
  });
  it("schedules", () => {
    expect(scheduleDates("monthly", "2024-01-15", "2024-04-30", 31)).toEqual(["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"]);
    expect(scheduleDates("monthly", "2024-01-15", "2024-03-10", 5)).toEqual(["2024-02-05", "2024-03-05"]);
    expect(scheduleDates("quarterly", "2024-01-01", "2024-12-31", 10)).toEqual(["2024-01-10", "2024-04-10", "2024-07-10", "2024-10-10"]);
    expect(scheduleDates("weekly", "2024-01-01", "2024-01-29")).toEqual(["2024-01-01", "2024-01-08", "2024-01-15", "2024-01-22", "2024-01-29"]);
    expect(scheduleDates("fortnightly", "2024-01-01", "2024-01-29")).toEqual(["2024-01-01", "2024-01-15", "2024-01-29"]);
    expect(scheduleDates("monthly", "2024-02-01", "2024-01-01", 1)).toEqual([]);
  });
  it("returns and statistics", () => {
    expect(cagrPct(100, 121, 730)).toBeCloseTo(10, 10);
    expect(cagrPct(100, 121, 364)).toBeNull();
    expect(absoluteReturnPct(100, 121)).toBeCloseTo(21, 10);
    expect(absoluteReturnPct(0, 121)).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    // {2, 4, 4, 4, 5, 5, 7, 9}: mean 5, Σ(x−5)² = 32, sample var 32/7.
    expect(sampleStd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 12);
  });
});

describe("SIP return", () => {
  // NAV on the 1st, except 1 Feb (holiday) → 2 Feb.
  const s = S([["2024-01-01", 10], ["2024-02-02", 20], ["2024-03-01", 25], ["2024-03-15", 30]]);

  it("₹1,000 monthly on the 1st: 100 + 50 + 40 units = 190, worth ₹4,750 at ₹25", () => {
    const r = ok(sipReturn(s, { amount: 1000, frequency: "monthly", sipDay: 1, startDate: "2024-01-01", endDate: "2024-03-01" }));
    expect(r.rows.map((x) => x.date)).toEqual(["2024-01-01", "2024-02-02", "2024-03-01"]);
    expect(r.rows.map((x) => x.units)).toEqual([100, 50, 40]);
    expect(r.rows.map((x) => x.cumulativeUnits)).toEqual([100, 150, 190]);
    expect(r.rows.map((x) => x.value)).toEqual([1000, 3000, 4750]);
    expect(r.invested).toBe(3000);
    expect(r.units).toBe(190);
    expect(r.currentValue).toBe(4750);
    expect(r.profit).toBe(1750);
    expect(r.absolutePct).toBeCloseTo(58.3333333, 6);
    // XIRR zeroes the dated NPV.
    const flows = [...r.rows.map((x) => ({ date: x.date, amount: -x.amount })), { date: r.valueDate, amount: r.currentValue }];
    expect(r.xirrPct).not.toBeNull();
    expect(Math.abs(xnpv((r.xirrPct as number) / 100, flows))).toBeLessThan(1e-4);
  });

  it("valued later than the end date (current value at ₹30)", () => {
    const r = ok(sipReturn(s, { amount: 1000, frequency: "monthly", sipDay: 1, startDate: "2024-01-01", endDate: "2024-03-01", valueOn: "2024-03-20" }));
    expect(r.valueDate).toBe("2024-03-15");
    expect(r.currentValue).toBe(5700);
  });

  it("one instalment: XIRR equals (V/I)^(365/days) − 1", () => {
    const t = S([["2021-01-01", 10], ["2023-01-01", 12.1]]);
    const r = ok(sipReturn(t, { amount: 5000, frequency: "monthly", sipDay: 1, startDate: "2021-01-01", endDate: "2021-01-01", valueOn: "2023-01-01" }));
    expect(r.currentValue).toBeCloseTo(6050, 9);
    expect(r.xirrPct as number).toBeCloseTo(10, 4);
  });

  it("10% yearly enhancement over 25 months at a flat NAV: 12×1,000 + 12×1,100 + 1×1,210", () => {
    const flat = daily("2020-01-01", "2022-03-01", () => 10);
    const r = ok(sipReturn(flat, { amount: 1000, frequency: "monthly", sipDay: 1, startDate: "2020-01-01", endDate: "2022-01-31", stepUpPct: 10 }));
    expect(r.instalments).toBe(25);
    expect(r.rows[11].amount).toBe(1000);
    expect(r.rows[12].amount).toBe(1100);
    expect(r.rows[24].amount).toBe(1210);
    expect(r.invested).toBe(26410);
    expect(r.units).toBeCloseTo(2641, 9);
    expect(r.currentValue).toBeCloseTo(26410, 6);
    expect(Math.abs(r.xirrPct as number)).toBeLessThan(1e-3);
  });

  it("weekly and quarterly frequencies", () => {
    const flat = daily("2024-01-01", "2024-12-31", () => 10);
    expect(ok(sipReturn(flat, { amount: 500, frequency: "weekly", sipDay: 1, startDate: "2024-01-01", endDate: "2024-01-29" })).instalments).toBe(5);
    expect(ok(sipReturn(flat, { amount: 500, frequency: "quarterly", sipDay: 10, startDate: "2024-01-01", endDate: "2024-12-31" })).invested).toBe(2000);
  });

  it("skips instalments before launch; refuses an empty schedule", () => {
    const r = ok(sipReturn(s, { amount: 1000, frequency: "monthly", sipDay: 1, startDate: "2023-11-01", endDate: "2024-01-31" }));
    expect(r.skippedBeforeLaunch).toBe(2);
    expect(r.instalments).toBe(1);
    expect(sipReturn(s, { amount: 1000, frequency: "monthly", sipDay: 1, startDate: "2023-01-01", endDate: "2023-03-01" }).ok).toBe(false);
    expect(sipReturn(s, { amount: 0, frequency: "monthly", sipDay: 1, startDate: "2024-01-01", endDate: "2024-03-01" }).ok).toBe(false);
  });
});

describe("Lumpsum return", () => {
  const s = S([["2021-01-01", 10], ["2022-01-03", 11], ["2023-01-01", 12.1], ["2023-01-05", 12.5]]);

  it("₹1,00,000 at ₹10 → ₹1,21,000 at ₹12.1 over 730 days: CAGR 10%, absolute 21%", () => {
    // Start 31 Dec 2020 has no NAV → bought 1 Jan 2021; end 3 Jan 2023 → valued at 1 Jan 2023.
    const r = ok(lumpsumReturn(s, { amount: 100000, startDate: "2021-01-01", endDate: "2023-01-03" }));
    expect(r.buyDate).toBe("2021-01-01");
    expect(r.units).toBe(10000);
    expect(r.valueDate).toBe("2023-01-01");
    expect(r.value).toBeCloseTo(121000, 6);
    expect(r.profit).toBeCloseTo(21000, 6);
    expect(r.days).toBe(730);
    expect(r.cagrPct as number).toBeCloseTo(10, 9);
    expect(r.absolutePct as number).toBeCloseTo(21, 9);
  });
  it("a holiday start buys at the next NAV; under a year has no CAGR", () => {
    const r = ok(lumpsumReturn(s, { amount: 1100, startDate: "2022-01-01", endDate: "2023-01-01" }));
    expect(r.buyDate).toBe("2022-01-03");
    expect(r.units).toBe(100);
    expect(r.days).toBe(363);
    expect(r.cagrPct).toBeNull();
    expect(r.absolutePct as number).toBeCloseTo(10, 9);
  });
  it("refuses a start before launch", () => {
    expect(lumpsumReturn(s, { amount: 1000, startDate: "2020-12-31", endDate: "2023-01-01" }).ok).toBe(false);
  });
});

describe("STP return", () => {
  const debt = S([["2024-01-01", 10], ["2024-02-01", 10], ["2024-03-01", 10]]);
  const equity = S([["2024-01-01", 10], ["2024-02-01", 20], ["2024-03-01", 25], ["2024-04-01", 30]]);

  it("₹10,000 in debt, ₹1,000 a month to equity: 700 debt units left, 190 equity units", () => {
    const r = ok(stpReturn(debt, equity, {
      initialAmount: 10000, investDate: "2024-01-01", mode: "fixed", stpAmount: 1000,
      frequency: "monthly", stpDay: 1, stpStart: "2024-01-01", stpEnd: "2024-03-01",
    }));
    expect(r.transfers).toBe(3);
    expect(r.transferred).toBe(3000);
    expect(r.from.units).toBeCloseTo(700, 9);
    expect(r.from.currentValue).toBeCloseTo(7000, 9);
    expect(r.to.units).toBeCloseTo(190, 9);
    expect(r.to.currentValue).toBeCloseTo(4750, 9);
    expect(r.to.profit).toBeCloseTo(1750, 9);
    expect(r.from.profit).toBeCloseTo(0, 9);
    expect(r.total.currentValue).toBeCloseTo(11750, 9);
    expect(r.total.profit).toBeCloseTo(1750, 9);
    expect(r.total.absolutePct as number).toBeCloseTo(17.5, 9);
    expect(r.from.xirrPct as number).toBeCloseTo(0, 3);
  });
  it("valued on a later date than the STP end", () => {
    const r = ok(stpReturn(debt, equity, {
      initialAmount: 10000, investDate: "2024-01-01", mode: "fixed", stpAmount: 1000,
      frequency: "monthly", stpDay: 1, stpStart: "2024-01-01", stpEnd: "2024-03-01", valueOn: "2024-04-10",
    }));
    expect(r.to.valueAtEnd).toBeCloseTo(4750, 9);
    expect(r.to.currentValue).toBeCloseTo(5700, 9);
    expect(r.to.currentValueDate).toBe("2024-04-01");
    expect(r.from.currentValueDate).toBe("2024-03-01");
  });
  it("the last transfer takes what is left: ₹2,500 → 1,000 + 1,000 + 500", () => {
    const r = ok(stpReturn(debt, equity, {
      initialAmount: 2500, investDate: "2024-01-01", mode: "fixed", stpAmount: 1000,
      frequency: "monthly", stpDay: 1, stpStart: "2024-01-01", stpEnd: "2024-03-01",
    }));
    expect(r.rows.map((x) => x.amount)).toEqual([1000, 1000, 500]);
    expect(r.exhausted).toBe(true);
    expect(r.from.units).toBe(0);
    expect(r.to.units).toBeCloseTo(100 + 50 + 20, 9);
  });
  it("profit transfer moves only the value above the initial ₹1,000", () => {
    // Debt 10 → 11 → 12. Jan: nothing above 1,000. Feb: 100 units × 11 = 1,100 → move 100.
    // Mar: 90.909 units × 12 = 1,090.91 → move 90.91. Equity flat at 10.
    const d = S([["2024-01-01", 10], ["2024-02-01", 11], ["2024-03-01", 12]]);
    const e = S([["2024-01-01", 10], ["2024-02-01", 10], ["2024-03-01", 10]]);
    const r = ok(stpReturn(d, e, {
      initialAmount: 1000, investDate: "2024-01-01", mode: "appreciation", stpAmount: 0,
      frequency: "monthly", stpDay: 1, stpStart: "2024-01-01", stpEnd: "2024-03-01",
    }));
    expect(r.periodsWithoutTransfer).toBe(1);
    expect(r.transfers).toBe(2);
    expect(r.rows[0].amount).toBeCloseTo(100, 9);
    expect(r.rows[1].amount).toBeCloseTo(1000 / 11, 9);
    expect(r.from.units).toBeCloseTo(1000 / 12, 9);
    expect(r.from.currentValue).toBeCloseTo(1000, 9);
    expect(r.to.units).toBeCloseTo(10 + 100 / 11, 9);
    expect(r.total.currentValue).toBeCloseTo(1000 + 100 + 1000 / 11, 9);
  });
  it("refuses an STP that starts before the investment", () => {
    expect(stpReturn(debt, equity, {
      initialAmount: 1000, investDate: "2024-02-01", mode: "fixed", stpAmount: 100,
      frequency: "monthly", stpDay: 1, stpStart: "2024-01-01", stpEnd: "2024-03-01",
    }).ok).toBe(false);
  });
});

describe("SWP return", () => {
  const s = S([["2024-01-01", 10], ["2024-02-01", 12.5], ["2024-03-01", 20]]);

  it("₹10,000 at ₹10, ₹1,000 out monthly: FIFO gains ₹200 and ₹500, 870 units worth ₹17,400 left", () => {
    const r = ok(swpReturn(s, {
      amount: 10000, investDate: "2024-01-01", withdrawal: 1000, frequency: "monthly", swpDay: 1,
      swpStart: "2024-02-01", swpEnd: "2024-03-01",
    }));
    expect(r.initialUnits).toBe(1000);
    expect(r.rows.map((x) => x.unitsRedeemed)).toEqual([80, 50]);
    expect(r.rows.map((x) => x.cost)).toEqual([800, 500]);
    expect(r.rows.map((x) => x.capitalGain)).toEqual([200, 500]);
    expect(r.rows.map((x) => x.daysInvested)).toEqual([31, 60]);
    expect(r.rows.map((x) => x.unitsLeft)).toEqual([920, 870]);
    expect(r.totalWithdrawn).toBe(2000);
    expect(r.totalCapitalGain).toBe(700);
    expect(r.remainingValue).toBe(17400);
    expect(r.profit).toBe(9400);
    const flows = [{ date: "2024-01-01", amount: -10000 }, { date: "2024-02-01", amount: 1000 }, { date: "2024-03-01", amount: 18400 }];
    expect(Math.abs(xnpv((r.xirrPct as number) / 100, flows))).toBeLessThan(1e-4);
  });
  it("runs out: the last withdrawal takes what is left", () => {
    const r = ok(swpReturn(s, {
      amount: 1500, investDate: "2024-01-01", withdrawal: 1000, frequency: "monthly", swpDay: 1,
      swpStart: "2024-02-01", swpEnd: "2024-03-01",
    }));
    // 150 units; Feb: 80 out (₹1,000) leaves 70; Mar: 70 × 20 = ₹1,400 > 1,000 → 50 out, 20 left.
    expect(r.unitsLeft).toBeCloseTo(20, 9);
    const r2 = ok(swpReturn(s, {
      amount: 1000, investDate: "2024-01-01", withdrawal: 1000, frequency: "monthly", swpDay: 1,
      swpStart: "2024-02-01", swpEnd: "2024-03-01",
    }));
    // 100 units × 12.5 = 1,250 → 80 out, 20 left; Mar: 20 × 20 = 400 < 1,000 → all, ends.
    expect(r2.rows.map((x) => x.amount)).toEqual([1000, 400]);
    expect(r2.exhausted).toBe(true);
    expect(r2.unitsLeft).toBe(0);
  });
  it("redeemFifo takes the oldest lot first", () => {
    const lots: Lot[] = [{ date: "2020-01-01", units: 10, nav: 5 }, { date: "2021-01-01", units: 10, nav: 8 }];
    const a = redeemFifo(lots, 15);
    expect(a.cost).toBe(10 * 5 + 5 * 8);
    expect(a.oldest).toBe("2020-01-01");
    expect(lots).toEqual([{ date: "2021-01-01", units: 5, nav: 8 }]);
  });
});

describe("Rolling returns", () => {
  // A NAV every day, constant within a calendar year: 2015 ₹10, 2016 ₹11.1 (+11%),
  // 2017 ₹9.99 (−10%), 2018 ₹12.4875 (+25%). A 1-year window from any day of
  // year Y ends in Y+1, so its return is that year-on-year step exactly.
  const yearNav: Record<string, number> = { "2015": 10, "2016": 11.1, "2017": 9.99, "2018": 12.4875 };
  const s = daily("2015-01-01", "2018-12-31", (d) => yearNav[d.slice(0, 4)]);

  it("1-year: 365 windows at +11%, 366 at −10%, 365 at +25%", () => {
    const r = ok(rollingReturns(s, { startDate: "2015-01-01", years: 1 }));
    expect(r.count).toBe(1096);
    expect(r.averagePct).toBeCloseTo((365 * 11 - 366 * 10 + 365 * 25) / 1096, 9);
    expect(r.medianPct).toBeCloseTo(11, 9);
    expect(r.max.returnPct).toBeCloseTo(25, 9);
    expect(r.max.start).toBe("2017-01-01");
    expect(r.min.returnPct).toBeCloseTo(-10, 9);
    expect(r.negativePct).toBeCloseTo((366 / 1096) * 100, 9);
    const band = Object.fromEntries(r.bands.map((b) => [b.key, b.count]));
    expect(band).toEqual({ neg: 366, b0_8: 0, b8_10: 0, b10_12: 365, b12_15: 0, b15_20: 0, b20: 365 });
    // 29 Feb 2016 + 1 year = 28 Feb 2017.
    expect(r.windows.find((w) => w.start === "2016-02-29")?.end).toBe("2017-02-28");
  });
  it("3-year: only windows starting in 2015 fit, each (12.4875/10)^(1/3) − 1", () => {
    const r = ok(rollingReturns(s, { startDate: "2015-01-01", years: 3 }));
    expect(r.count).toBe(365);
    expect(r.averagePct).toBeCloseTo((Math.pow(1.24875, 1 / 3) - 1) * 100, 9);
    expect(r.bands.find((b) => b.key === "b0_8")?.count).toBe(365);
  });
  it("start date narrows; too short a history is refused", () => {
    expect(ok(rollingReturns(s, { startDate: "2017-01-01", years: 1 })).count).toBe(365);
    expect(rollingReturns(s, { startDate: "2015-01-01", years: 5 }).ok).toBe(false);
  });
});

describe("Point-to-point comparison", () => {
  // Returns +2%, −2%, +2%, −2%: mean 0, sample variance 4 × 0.0004 / 3.
  const s = S([["2024-01-01", 100], ["2024-01-02", 102], ["2024-01-03", 99.96], ["2024-01-04", 101.9592], ["2024-01-05", 99.920016]]);

  it("growth, absolute, σ = √(0.0016/3) × √252, Sharpe = (0 − 6) / σ", () => {
    const r = ok(pointToPoint(s, { amount: 10000, startDate: "2024-01-01", endDate: "2024-01-05", riskFreePct: 6 }));
    expect(r.observations).toBe(4);
    expect(r.growthValue).toBeCloseTo(9992.0016, 6);
    expect(r.absolutePct as number).toBeCloseTo(-0.079984, 6);
    expect(r.cagrPct).toBeNull();
    expect(r.meanPct as number).toBeCloseTo(0, 9);
    const sd = Math.sqrt(0.0016 / 3) * Math.sqrt(252) * 100;
    expect(r.stdDevPct as number).toBeCloseTo(sd, 9);
    expect(r.sharpe as number).toBeCloseTo(-6 / sd, 9);
  });
  it("CAGR over two years; holidays resolve to next / previous NAV", () => {
    const t = S([["2021-01-01", 10], ["2022-01-01", 11], ["2023-01-01", 12.1]]);
    const r = ok(pointToPoint(t, { amount: 1000, startDate: "2021-01-01", endDate: "2023-01-02", riskFreePct: 0 }));
    expect(r.endDate).toBe("2023-01-01");
    expect(r.cagrPct as number).toBeCloseTo(10, 9);
    expect(r.growthValue).toBeCloseTo(1210, 9);
    // Two yearly returns of +10%: mean 10% × 252, σ 0.
    expect(r.meanPct as number).toBeCloseTo(0.1 * 252 * 100, 6);
    expect(r.sharpe).toBeNull();
  });
});

describe("Calendar-year, quarterly and monthly returns", () => {
  const s = S([
    ["2023-03-15", 10],      // launch
    ["2023-03-31", 11],      // Mar +10% (since launch)
    ["2023-04-28", 12.1],    // Apr +10% (30 Apr has no NAV)
    ["2023-06-30", 13.31],   // May: no NAV → none; Jun +10% from 28 Apr
    ["2023-12-29", 14.641],  // Dec +10% from 30 Jun
    ["2024-01-31", 16.1051], // Jan +10%
    ["2024-02-15", 17],      // Feb, to date
  ]);

  it("monthly", () => {
    const m = periodReturns(s, "month");
    expect(m.map((r) => `${r.year}-${r.period}`)).toEqual(["2023-3", "2023-4", "2023-6", "2023-12", "2024-1", "2024-2"]);
    for (const r of m.slice(0, 5)) expect(r.returnPct).toBeCloseTo(10, 9);
    expect(m[0].partial).toBe("since_launch");
    expect(m[2].fromDate).toBe("2023-04-28");
    expect(m[5].partial).toBe("to_date");
    expect(m[5].returnPct).toBeCloseTo((17 / 16.1051 - 1) * 100, 9);
  });
  it("quarterly", () => {
    const q = periodReturns(s, "quarter");
    expect(q.map((r) => [r.year, r.period])).toEqual([[2023, 1], [2023, 2], [2023, 4], [2024, 1]]);
    expect(q[1].returnPct).toBeCloseTo(21, 9);
    expect(q[3].partial).toBe("to_date");
  });
  it("calendar year", () => {
    const y = periodReturns(s, "year");
    expect(y).toHaveLength(2);
    expect(y[0]).toMatchObject({ year: 2023, partial: "since_launch", fromNav: 10, toNav: 14.641 });
    expect(y[0].returnPct).toBeCloseTo(46.41, 9);
    expect(y[1]).toMatchObject({ year: 2024, partial: "to_date", fromNav: 14.641, toNav: 17 });
  });
  it("grid: newest year first, null where no NAV, the year's return beside it", () => {
    const g = returnGrid(s, "month");
    expect(g.rows.map((r) => r.year)).toEqual([2024, 2023]);
    expect(g.rows[1].cells.map((c) => (c ? Math.round(c.returnPct) : null))).toEqual([null, null, 10, 10, null, 10, null, null, null, null, null, 10]);
    expect(g.rows[1].yearReturn?.returnPct).toBeCloseTo(46.41, 9);
    expect(returnGrid(s, "quarter").rows[0].cells).toHaveLength(4);
  });
});
