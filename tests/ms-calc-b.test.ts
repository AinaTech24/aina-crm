/**
 * STP calculators — every figure of the reference case studies, to the rupee
 * (MasterStroke #1 STP block, #12, #14, #42, #44, #45, #46, #47).
 * All run on src/lib/calculators/stp-comprehensive.ts.
 */

import { describe, expect, it } from "vitest";
import {
  computeMonthlyStp,
  computeSipStpForTarget,
  computeSipStpFv,
  computeStpComprehensive,
  monthlyStpValue,
  stpReckonerGrid,
  stpRequiredForTarget,
  type StpComprehensiveResult,
} from "@/lib/calculators/stp-comprehensive";

const R = Math.round;
const pct2 = (n: number) => Number(n.toFixed(2));
const lakh2 = (n: number) => Number((n / 1e5).toFixed(2));

/** [debtStart, transferred, equityStart, equityEnd, totalEnd, annualised %] */
function yearRows(r: StpComprehensiveResult) {
  return r.schedule.map((y) => [
    R(y.debtBeginning), R(y.transferredToEquity), R(y.equityBeginning), R(y.equityEnd), R(y.totalEnd),
    pct2(y.annualisedReturnPct),
  ]);
}

describe("#44 STP Comprehensive — ₹25L, weekly ₹50,000 × 50, 10 yrs, 5% / 12%", () => {
  const r = computeStpComprehensive({
    initialInvestment: 2_500_000, debtReturnPct: 5, equityReturnPct: 12, transferMode: "fixed",
    frequency: "weekly", numInstallments: 50, fixedTransferAmount: 50_000, totalMonths: 120,
  });
  it("headline", () => {
    expect(R(r.debtFinalValue)).toBe(95_911);
    expect(R(r.equityFinalValue)).toBe(7_348_509);
    expect(R(r.totalFinalValue)).toBe(7_444_420);
    expect(pct2(r.annualisedReturnPct)).toBe(11.53);
  });
  it("year table", () => {
    expect(yearRows(r)).toEqual([
      [2_500_000, 2_500_000, 0, 2_649_946, 2_711_771, 8.47],
      [61_825, 0, 2_649_946, 2_967_940, 3_032_856, 10.14],
      [64_917, 0, 2_967_940, 3_324_092, 3_392_255, 10.71],
      [68_162, 0, 3_324_092, 3_722_983, 3_794_554, 11.0],
      [71_570, 0, 3_722_983, 4_169_741, 4_244_890, 11.17],
      [75_149, 0, 4_169_741, 4_670_110, 4_749_017, 11.29],
      [78_906, 0, 4_670_110, 5_230_524, 5_313_375, 11.37],
      [82_852, 0, 5_230_524, 5_858_187, 5_945_181, 11.44],
      [86_994, 0, 5_858_187, 6_561_169, 6_652_513, 11.49],
      [91_344, 0, 6_561_169, 7_348_509, 7_444_420, 11.53],
    ]);
  });
  it("fixed % of initial = the same ₹ transfer (2% of ₹25L = ₹50,000)", () => {
    const p = computeStpComprehensive({
      initialInvestment: 2_500_000, debtReturnPct: 5, equityReturnPct: 12, transferMode: "fixed",
      fixedBasis: "pctOfInitial", fixedTransferPct: 2, fixedTransferAmount: 0,
      frequency: "weekly", numInstallments: 50, totalMonths: 120,
    });
    expect(R(p.totalFinalValue)).toBe(7_444_420);
  });
  it("exhaustion: an instalment the debt fund cannot cover is skipped, never swept", () => {
    // Asking for 120 monthly ₹50,000 transfers from ₹25L: only 56 fit. The
    // old engine swept the remainder (₹67,24,147, debt 0); the reference
    // leaves it in debt (₹67,23,507, debt ₹1,586).
    const p = computeStpComprehensive({
      initialInvestment: 2_500_000, debtReturnPct: 5, equityReturnPct: 12, transferMode: "fixed",
      frequency: "monthly", numInstallments: 120, fixedTransferAmount: 50_000, totalMonths: 120,
    });
    expect(p.transfersMade).toBe(56);
    expect(R(p.debtFinalValue)).toBe(1_586);
    expect(R(p.totalFinalValue)).toBe(6_723_507);
  });
});

describe("#14 Future Value of STP — ₹25L, fixed ₹50,000/month, 10 yrs, 5% / 12%", () => {
  const r = computeMonthlyStp({ initial: 2_500_000, years: 10, debtPct: 5, equityPct: 12, mode: "fixedAmount", fixedAmount: 50_000 });
  it("headline", () => {
    expect(R(r.debtFinalValue)).toBe(1_586);
    expect(R(r.equityFinalValue)).toBe(6_721_922);
    expect(R(r.totalFinalValue)).toBe(6_723_507);
    expect(pct2(r.annualisedReturnPct)).toBe(10.4);
  });
  it("year table", () => {
    expect(yearRows(r)).toEqual([
      [2_500_000, 600_000, 0, 632_325, 2_643_696, 5.75],
      [2_011_371, 600_000, 632_325, 1_340_529, 2_838_840, 6.56],
      [1_498_311, 600_000, 1_340_529, 2_133_717, 3_093_315, 7.36],
      [959_597, 600_000, 2_133_717, 3_022_088, 3_416_037, 8.12],
      [393_948, 400_000, 3_022_088, 3_814_199, 3_815_441, 8.82],
      [1_243, 0, 3_814_199, 4_271_903, 4_273_207, 9.35],
      [1_305, 0, 4_271_903, 4_784_531, 4_785_901, 9.72],
      [1_370, 0, 4_784_531, 5_358_675, 5_360_113, 10.0],
      [1_438, 0, 5_358_675, 6_001_716, 6_003_226, 10.22],
      [1_510, 0, 6_001_716, 6_721_922, 6_723_507, 10.4],
    ]);
  });
});

describe("#1 proposal STP block — ₹10L, 7% → 10%, ₹10,000 × 144, 15 yrs", () => {
  it("expected FV ₹36,15,346", () => {
    const r = computeStpComprehensive({
      initialInvestment: 1_000_000, debtReturnPct: 7, equityReturnPct: 10, transferMode: "fixed",
      frequency: "monthly", numInstallments: 144, fixedTransferAmount: 10_000, totalMonths: 180,
    });
    expect(R(r.totalFinalValue)).toBe(3_615_346);
  });
});

describe("#12 Future Value of SIP + STP — SIP ₹10,000 @12%, STP ₹10L 5% → 12%, 15 yrs", () => {
  const r = computeSipStpFv({ monthlySip: 10_000, sipRatePct: 12, stpLumpsum: 1_000_000, debtPct: 5, equityPct: 12, years: 15 });
  it("headline", () => {
    expect(R(r.sipValue)).toBe(4_759_314);
    expect(R(r.stpDebtValue)).toBe(1_000_000);
    expect(R(r.stpEquityValue)).toBe(1_920_778);
    expect(R(r.total)).toBe(7_680_092);
  });
  it("year table", () => {
    expect(r.rows.map((x) => [x.year, R(x.annualInvestment), R(x.cumulativeInvestment), R(x.sipValue), R(x.stpValue), R(x.total)])).toEqual([
      [1, 1_120_000, 1_120_000, 127_665, 1_051_523, 1_179_188],
      [2, 120_000, 1_240_000, 270_650, 1_109_230, 1_379_879],
      [3, 120_000, 1_360_000, 430_793, 1_173_861, 1_604_653],
      [4, 120_000, 1_480_000, 610_153, 1_246_247, 1_856_400],
      [5, 120_000, 1_600_000, 811_036, 1_327_320, 2_138_356],
      [6, 120_000, 1_720_000, 1_036_025, 1_418_122, 2_454_148],
      [7, 120_000, 1_840_000, 1_288_013, 1_519_820, 2_807_834],
      [8, 120_000, 1_960_000, 1_570_240, 1_633_722, 3_203_962],
      [9, 120_000, 2_080_000, 1_886_334, 1_761_292, 3_647_626],
      [10, 120_000, 2_200_000, 2_240_359, 1_904_170, 4_144_529],
      [11, 120_000, 2_320_000, 2_636_867, 2_064_194, 4_701_061],
      [12, 120_000, 2_440_000, 3_080_956, 2_243_421, 5_324_377],
      [13, 120_000, 2_560_000, 3_578_336, 2_444_155, 6_022_491],
      [14, 120_000, 2_680_000, 4_135_401, 2_668_977, 6_804_378],
      [15, 120_000, 2_800_000, 4_759_314, 2_920_778, 7_680_092],
    ]);
  });
});

describe("#42 SIP/STP Required for Target — ₹25L, 10 yrs, STP ₹5L 6% → 12%, SIP @12%", () => {
  const r = computeSipStpForTarget({
    target: 2_500_000, years: 10, solve: "sip", stpLumpsum: 500_000, monthlySip: 0, debtPct: 6, equityPct: 12, sipRatePct: 12,
  });
  it("monthly SIP ₹6,516", () => {
    expect(R(r.monthlySip)).toBe(6_516);
    expect(r.overshoots).toBe(false);
  });
  it("year table", () => {
    expect(r.projection.rows.map((x) => [x.year, R(x.annualInvestment), R(x.cumulativeInvestment), R(x.sipValue), R(x.stpValue), R(x.total)])).toEqual([
      [1, 578_195, 578_195, 83_190, 530_779, 613_968],
      [2, 78_195, 656_390, 176_362, 565_251, 741_613],
      [3, 78_195, 734_585, 280_715, 603_860, 884_575],
      [4, 78_195, 812_780, 397_590, 647_102, 1_044_692],
      [5, 78_195, 890_975, 528_491, 695_533, 1_224_023],
      [6, 78_195, 969_169, 675_099, 749_775, 1_424_875],
      [7, 78_195, 1_047_364, 839_301, 810_527, 1_649_828],
      [8, 78_195, 1_125_559, 1_023_206, 878_569, 1_901_775],
      [9, 78_195, 1_203_754, 1_229_181, 954_776, 2_183_957],
      [10, 78_195, 1_281_949, 1_459_872, 1_040_128, 2_500_000],
    ]);
  });
  it("STP-required inverse: the SIP above needs exactly the ₹5L lumpsum; STP alone needs ₹12,01,775", () => {
    const inv = computeSipStpForTarget({
      target: 2_500_000, years: 10, solve: "stp", stpLumpsum: 0, monthlySip: r.monthlySip, debtPct: 6, equityPct: 12, sipRatePct: 12,
    });
    expect(R(inv.stpLumpsum)).toBe(500_000);
    const alone = computeSipStpForTarget({
      target: 2_500_000, years: 10, solve: "stp", stpLumpsum: 0, monthlySip: 0, debtPct: 6, equityPct: 12, sipRatePct: 12,
    });
    expect(R(alone.stpLumpsum)).toBe(1_201_775);
  });
  it("a lumpsum that overshoots on its own needs no SIP (0, flagged)", () => {
    const o = computeSipStpForTarget({
      target: 1_000_000, years: 10, solve: "sip", stpLumpsum: 1_000_000, monthlySip: 0, debtPct: 6, equityPct: 12, sipRatePct: 12,
    });
    expect(o.monthlySip).toBe(0);
    expect(o.overshoots).toBe(true);
  });
});

const SCEN = [{ debtPct: 5, equityPct: 10 }, { debtPct: 6, equityPct: 12 }, { debtPct: 7, equityPct: 15 }];
const YEARS = [5, 10, 15, 20, 25];

describe("#45 STP Future Value Ready Reckoner — ₹50L, capital appreciation", () => {
  it("grid (₹ lakh, 2 dp)", () => {
    const g = stpReckonerGrid({ kind: "fv", amount: 5_000_000, scenarios: SCEN, years: YEARS, mode: "appreciation" });
    expect(g.map((row) => row.map(lakh2))).toEqual([
      [65.6, 90.71, 131.17, 196.31, 301.24],
      [69.55, 104.01, 164.74, 271.77, 460.38],
      [74.41, 123.5, 222.23, 420.83, 820.28],
    ]);
  });
});

describe("#46 STP Need-Based Ready Reckoner — target ₹50L, capital appreciation", () => {
  it("grid (₹ lakh, 2 dp)", () => {
    const g = stpReckonerGrid({ kind: "need", amount: 5_000_000, scenarios: SCEN, years: YEARS, mode: "appreciation" });
    expect(g.map((row) => row.map(lakh2))).toEqual([
      [38.11, 27.56, 19.06, 12.73, 8.3],
      [35.94, 24.04, 15.18, 9.2, 5.43],
      [33.6, 20.24, 11.25, 5.94, 3.05],
    ]);
  });
  it("fixed % mode: need × FV per rupee = target", () => {
    const need = stpReckonerGrid({ kind: "need", amount: 5_000_000, scenarios: SCEN, years: YEARS, mode: "fixedPct", fixedPct: 1 });
    const back = monthlyStpValue({ initial: need[1][2], years: 15, debtPct: 6, equityPct: 12, mode: "fixedPct", fixedPct: 1 });
    expect(R(back)).toBe(5_000_000);
  });
});

describe("#47 STP Required for Target FV — ₹1 Cr, 12 yrs, 6% / 12%, 1% of initial / month", () => {
  const r = stpRequiredForTarget({ target: 10_000_000, years: 12, debtPct: 6, equityPct: 12, mode: "fixedPct", fixedPct: 1 });
  const p = r.projection!;
  it("initial investment required ₹33,51,520 and headline", () => {
    expect(R(r.initialRequired)).toBe(3_351_520);
    expect(R(p.debtFinalValue)).toBe(12_565);
    expect(R(p.equityFinalValue)).toBe(9_987_435);
    expect(R(p.totalFinalValue)).toBe(10_000_000);
    expect(pct2(p.annualisedReturnPct)).toBe(9.54);
  });
  it("year table", () => {
    expect(yearRows(p)).toEqual([
      [3_351_520, 402_182, 0, 423_850, 3_563_335, 6.32],
      [3_139_485, 402_182, 423_850, 898_562, 3_813_290, 6.67],
      [2_914_728, 402_182, 898_562, 1_430_239, 4_106_725, 7.01],
      [2_676_486, 402_182, 1_430_239, 2_025_718, 4_449_667, 7.34],
      [2_423_949, 402_182, 2_025_718, 2_692_654, 4_848_914, 7.67],
      [2_156_260, 402_182, 2_692_654, 3_439_622, 5_312_132, 7.98],
      [1_872_509, 402_182, 3_439_622, 4_276_227, 5_847_961, 8.28],
      [1_571_734, 402_182, 4_276_227, 5_213_224, 6_466_136, 8.56],
      [1_252_912, 402_182, 5_213_224, 6_262_661, 7_177_621, 8.83],
      [914_960, 402_182, 6_262_661, 7_438_030, 7_994_762, 9.08],
      [556_732, 402_182, 7_438_030, 8_754_444, 8_931_454, 9.32],
      [177_010, 167_576, 8_754_444, 9_987_435, 10_000_000, 9.54],
    ]);
  });
  it("fixed ₹ amount mode (bisection) reaches the target with the case's transfer", () => {
    const f = stpRequiredForTarget({ target: 10_000_000, years: 12, debtPct: 6, equityPct: 12, mode: "fixedAmount", fixedAmount: 33_515.2 });
    expect(R(f.initialRequired)).toBe(3_351_520);
    expect(R(f.projection!.totalFinalValue)).toBe(10_000_000);
  });
  it("capital appreciation mode is the closed-form inverse", () => {
    const a = stpRequiredForTarget({ target: 5_000_000, years: 5, debtPct: 5, equityPct: 10, mode: "appreciation" });
    expect(lakh2(a.initialRequired)).toBe(38.11);
  });
});
