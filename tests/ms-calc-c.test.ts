/**
 * Reference-case parity for the SWP family (package c): every figure of each
 * case study, to the rupee (Math.round, or floor where the report truncates).
 *   #23 Lumpsum required for a target monthly SWP   → swp-target.lumpsumForSwp
 *   #25 Monthly SWP for a lumpsum (+ tax table)      → swp-target.swpFromLumpsum
 *   #40 SIP required for a target monthly SWP        → swp-target.sipForSwp
 *   #26 Monthly SWP for SIP                          → income-bridge
 *   #35 SIP–SWP ready reckoner                       → income-bridge
 *   #27 Multipurpose                                 → multipurpose
 *   #48 SWP comprehensive                            → swp-comprehensive
 *   #49 SWP end period                               → swp-end-period
 *   #51 SWP rebalance                                → swp-rebalance
 */

import { describe, expect, it } from "vitest";
import { lumpsumForSwp, swpFromLumpsum, sipForSwp } from "@/lib/calculators/swp-target";
import { computeSwpRebalance } from "@/lib/calculators/swp-rebalance";
import { computeSwpEndPeriod } from "@/lib/calculators/swp-end-period";
import { computeIncomeBridge, type IncomeBridgeInput } from "@/lib/calculators/income-bridge";
import { computeMultipurpose } from "@/lib/calculators/multipurpose";
import { computeSwpComprehensive } from "@/lib/calculators/swp-comprehensive";

const r = Math.round;

describe("#23 lumpsum investment required for a target monthly SWP", () => {
  const res = lumpsumForSwp({
    firstMonthlySwp: 200000, deferYears: 0, swpYears: 25, ratePct: 9, inflationPct: 5,
    endBalance: 10000000, currentAge: 60, tax: null,
  });
  it("headline figures", () => {
    expect(r(res.lumpsumToday)).toBe(39924637);
    expect(r(res.totalWithdrawal)).toBe(117146904);
  });
  it("year table: average monthly SWP and year-end balance by age", () => {
    const want: [number, number, number][] = [
      [61, 204543, 40964554], [62, 214770, 41970398], [63, 225509, 42932720], [64, 236784, 43840900],
      [65, 248623, 44683028], [66, 261054, 45445770], [67, 274107, 46114223], [68, 287812, 46671753],
      [69, 302203, 47099823], [70, 317313, 47377800], [71, 333179, 47482744], [72, 349838, 47389181],
      [73, 367330, 47068846], [74, 385696, 46490413], [75, 404981, 45619190], [76, 425230, 44416789],
      [77, 446492, 42840765], [78, 468816, 40844222], [79, 492257, 38375380], [80, 516870, 35377101],
      [81, 542713, 31786374], [82, 569849, 27533747], [83, 598341, 22542715], [84, 628259, 16729036],
      [85, 659671, 10000000],
    ];
    expect(res.rows).toHaveLength(25);
    res.rows.forEach((row, i) => {
      expect(row.age).toBe(want[i][0]);
      expect(r(row.avgMonthlySwp)).toBe(want[i][1]);
      expect(r(row.yearEndBalance)).toBe(want[i][2]);
    });
  });
  it("is the exact inverse of #25", () => {
    const back = swpFromLumpsum({
      lumpsum: res.lumpsumToday, deferYears: 0, swpYears: 25, ratePct: 9, inflationPct: 5,
      endBalance: 10000000, currentAge: 60, tax: null,
    });
    expect(back.firstMonthSwp).toBeCloseTo(200000, 6);
  });
});

describe("#25 monthly SWP for a lumpsum investment (with tax)", () => {
  const res = swpFromLumpsum({
    lumpsum: 10000000, deferYears: 0, swpYears: 25, ratePct: 9, inflationPct: 5, endBalance: 10000000,
    currentAge: 60, tax: { stPct: 20, stUptoYears: 1, ltPct: 12.5, ltFromYear: 2, indexationPct: 0 },
  });
  it("headline figures", () => {
    expect(r(res.firstMonthSwp)).toBe(45610);
    expect(r(res.firstYearAvgSwp)).toBe(46646);
    expect(r(res.totalWithdrawal)).toBe(26715270);
    expect(res.feasible).toBe(true);
  });
  it("every cell of both year tables", () => {
    const bal: [number, number][] = [
      [46646, 10317722], [48978, 10634924], [51427, 10950105], [53998, 11261555], [56698, 11567332],
      [59533, 11865241], [62510, 12152803], [65635, 12427232], [68917, 12685392], [72363, 12923772],
      [75981, 13138442], [79780, 13325008], [83769, 13478570], [87958, 13593669], [92356, 13664228],
      [96973, 13683493], [101822, 13643967], [106913, 13537331], [112259, 13354368], [117872, 13084873],
      [123765, 12717554], [129954, 12239928], [136451, 11638205], [143274, 10897161], [150438, 10000000],
    ];
    const tax: [number, number, number][] = [
      [559751, 5110, 554641], [587738, 9143, 578595], [617125, 15177, 601948], [647981, 21308, 626674],
      [680380, 27548, 652832], [714399, 33910, 680489], [750119, 40408, 709711], [787625, 47054, 740571],
      [827006, 53863, 773143], [868357, 60849, 807508], [911775, 68026, 843748], [957363, 75411, 881952],
      [1005232, 83019, 922213], [1055493, 90866, 964627], [1108268, 98970, 1009298], [1163681, 107349, 1056333],
      [1221865, 116020, 1105845], [1282959, 125004, 1157954], [1347106, 134320, 1212786], [1414462, 143990, 1270472],
      [1485185, 154035, 1331150], [1559444, 164477, 1394967], [1637416, 175341, 1462075], [1719287, 186652, 1532635],
      [1805251, 198434, 1606817],
    ];
    expect(res.rows).toHaveLength(25);
    res.rows.forEach((row, i) => {
      expect(row.age).toBe(61 + i);
      expect(r(row.avgMonthlySwp)).toBe(bal[i][0]);
      expect(r(row.yearEndBalance)).toBe(bal[i][1]);
      expect(r(row.annualWithdrawal)).toBe(tax[i][0]);
      expect(r(row.tax)).toBe(tax[i][1]);
      expect(r(row.postTax)).toBe(tax[i][2]);
    });
  });
  it("flags a balance the lumpsum cannot reach", () => {
    const bad = swpFromLumpsum({
      lumpsum: 1000000, deferYears: 0, swpYears: 10, ratePct: 9, inflationPct: 0, endBalance: 10000000,
      currentAge: null, tax: null,
    });
    expect(bad.feasible).toBe(false);
    expect(bad.firstMonthSwp).toBeLessThan(0);
  });
});

describe("#40 SIP required for a target monthly SWP", () => {
  const res = sipForSwp({
    firstMonthlySwp: 100000, sipYears: 20, deferYears: 0, swpYears: 30, accPct: 12, distPct: 7,
    inflationPct: 0, endBalance: 5000000, currentAge: 40,
  });
  it("headline figures", () => {
    expect(r(res.corpus)).toBe(16019597);
    expect(r(res.monthlySip)).toBe(17415);
    expect(r(res.annualInvestment)).toBe(208984);
    expect(r(res.totalWithdrawal)).toBe(36000000);
  });
  it("accumulation table", () => {
    const want = [222332, 471345, 750239, 1062600, 1412444, 1804270, 2243115, 2734621, 3285108, 3901654,
      4592184, 5365579, 6231781, 7201927, 8288491, 9505442, 10868428, 12394972, 14104701, 16019597];
    expect(res.accRows).toHaveLength(20);
    res.accRows.forEach((row, i) => {
      expect(row.age).toBe(41 + i);
      expect(r(row.annualInvestment)).toBe(208984);
      expect(r(row.yearEndValue)).toBe(want[i]);
    });
  });
  it("distribution table", () => {
    const want = [15902939, 15778115, 15644554, 15501643, 15348728, 15185109, 15010037, 14822710, 14622270, 14407799,
      14178316, 13932768, 13670032, 13388905, 13088098, 12766235, 12421842, 12053341, 11659046, 11237149,
      10785720, 10302691, 9785849, 9232829, 8641097, 8007944, 7330471, 6605574, 5829934, 5000000];
    expect(res.swpRows).toHaveLength(30);
    res.swpRows.forEach((row, i) => {
      expect(row.age).toBe(61 + i);
      expect(r(row.avgMonthlySwp)).toBe(100000);
      expect(r(row.yearEndBalance)).toBe(want[i]);
    });
  });
});

const bridgeBase: IncomeBridgeInput = {
  calcType: "monthly_swp", investMode: "sip", planningType: "retirement",
  startAge: 35, sipTillAge: 60, retirementAge: 60, swpTillAge: 85,
  monthlySip: 10000, topUpPct: 0, lumpsum: 0, monthlySalary: 0, savingsPct: 0, salaryGrowthPct: 0,
  accumReturnPct: 12, distReturnPct: 9, distInflationPct: 0, endBalance: 10000000, desiredMonthlySwp: 0,
};

describe("#26 monthly SWP for SIP (income bridge)", () => {
  const res = computeIncomeBridge(bridgeBase);
  it("headline figures", () => {
    expect(r(res.corpus)).toBe(17022066);
    expect(r(res.monthlySwp)).toBe(129323);
    expect(r(res.totalWithdrawn)).toBe(38796786);
  });
  it("accumulation table", () => {
    const want = [127665, 270650, 430793, 610153, 811036, 1036025, 1288013, 1570240, 1886334, 2240359,
      2636867, 3080956, 3578336, 4135401, 4759314, 5458097, 6240733, 7117286, 8099026, 9198574,
      10430067, 11809340, 13354126, 15084286, 17022066];
    expect(res.accSchedule).toHaveLength(25);
    res.accSchedule.forEach((row, i) => {
      expect(row.age).toBe(36 + i);
      expect(r(row.invested)).toBe(120000);
      expect(r(row.value)).toBe(want[i]);
    });
  });
  it("year table carries the year's average monthly SWP", () => {
    const infl = computeIncomeBridge({ ...bridgeBase, distInflationPct: 5 });
    const y1 = infl.schedule[0];
    expect(y1.avgMonthlyWithdrawal).toBeCloseTo(y1.withdrawnThisYear / 12, 6);
    expect(y1.avgMonthlyWithdrawal).toBeGreaterThan(y1.monthlyWithdrawalThatYear);
  });
});

describe("#35 SIP–SWP ready reckoner (income bridge)", () => {
  it("salary-linked case", () => {
    const res = computeIncomeBridge({
      ...bridgeBase, investMode: "salary", startAge: 35, sipTillAge: 50, retirementAge: 60, swpTillAge: 80,
      monthlySalary: 100000, savingsPct: 25, salaryGrowthPct: 8, accumReturnPct: 12,
      distReturnPct: 8, distInflationPct: 5, endBalance: 10000000,
    });
    expect(r(res.corpus)).toBe(57032643);
    expect(r(res.monthlySwp)).toBe(300712);
    expect(r(res.totalInvested)).toBe(8145634);
    expect(r(res.totalWithdrawn)).toBe(122030233);
    expect(r(res.endBalanceActual)).toBe(10000000);
  });
  it("top-up SIP sample with the Max end-balance hint", () => {
    const res = computeIncomeBridge({
      ...bridgeBase, investMode: "sip", startAge: 35, sipTillAge: 40, retirementAge: 50, swpTillAge: 90,
      monthlySip: 25000, topUpPct: 5, accumReturnPct: 12, distReturnPct: 7, distInflationPct: 5, endBalance: 6883098,
    });
    expect(r(res.corpus)).toBe(6883098);
    expect(r(res.maxEndBalance)).toBe(103070663);
    expect(r(res.monthlySwp)).toBe(19154);
  });
});

describe("#27 multipurpose", () => {
  const res = computeMultipurpose({
    currentAge: 40, reportTillAge: 90, ratePct: 12, calcType: "lumpsum", amount: 10000000,
    withdrawal: "both", reportType: "fund_value",
  });
  it("fund-value table beside the SWP table starts at +5", () => {
    const want = [17623417, 31058482, 54735658, 96462931, 170000644, 299599221, 527996196, 930509704, 1639876039, 2890021898];
    expect(res.fundProjection?.map((x) => x.age)).toEqual([45, 50, 55, 60, 65, 70, 75, 80, 85, 90]);
    res.fundProjection?.forEach((row, i) => expect(r(row.fundValue)).toBe(want[i]));
  });
  it("periodic alone starts at +1", () => {
    const p = computeMultipurpose({
      currentAge: 40, reportTillAge: 90, ratePct: 12, calcType: "lumpsum", amount: 10000000,
      withdrawal: "periodic", reportType: "fund_value",
    });
    expect(p.fundProjection?.[0].age).toBe(41);
    expect(r(p.fundProjection?.[0].fundValue ?? 0)).toBe(11200000);
    expect(p.fundProjection).toHaveLength(11);
  });
  it("max monthly SWP by start age, truncated", () => {
    const want = [95217, 168250, 297909, 529401, 946923, 1713919, 3171627, 6129968, 13022220, 35971822];
    expect(res.swpTable?.map((x) => x.startAge)).toEqual([40, 45, 50, 55, 60, 65, 70, 75, 80, 85]);
    res.swpTable?.forEach((row, i) => expect(row.maxSwpShown).toBe(want[i]));
  });
});

describe("#48 SWP comprehensive (engine unchanged)", () => {
  const res = computeSwpComprehensive({
    investMode: "lumpsum", lumpsum: 5000000, monthlySip: 0, accumulationYears: 0, accumulationReturnPct: 0,
    defermentYears: 0, distReturnPct: 9, swpYears: 15, frequency: "monthly", withdrawalMode: "percentage",
    withdrawalAmount: 0, withdrawalAnnualPct: 7, increment: "none", incrementPct: 0, incrementAmount: 0,
  });
  it("case figures", () => {
    expect(r(res.basePerPeriodWithdrawal)).toBe(29167);
    expect(r(res.totalWithdrawn)).toBe(5250000);
    expect(r(res.finalValue)).toBe(7518788);
    const want = [5085787, 5179295, 5281219, 5392316, 5513411, 5645405, 5789279, 5946101, 6117037, 6303358,
      6506447, 6727814, 6969105, 7232111, 7518788];
    res.yearRows.forEach((row, i) => expect(r(row.endBalance)).toBe(want[i]));
  });
});

describe("#49 SWP end period", () => {
  const res = computeSwpEndPeriod({
    investmentType: "sip", initialInvestment: 25000, defermentRequired: true, defermentYears: 20,
    accumulationRatePct: 12, swpRatePct: 9, includeInflation: false, inflationPct: 0,
    swpMode: "amount", swpAmount: 200000, swpPercentage: 0,
  });
  it("lasts 20 years 5 months", () => {
    expect(res.accumulatedValue).toBe(22996434);
    expect(res.monthsLasted).toBe(245);
    expect(Math.floor((res.monthsLasted ?? 0) / 12)).toBe(20);
    expect((res.monthsLasted ?? 0) % 12).toBe(5);
    expect(r(res.leftover)).toBe(137225);
  });
  it("accumulation table", () => {
    const want = [319162, 676624, 1076982, 1525382, 2027590, 2590064, 3220034, 3925600, 4715835, 5600897,
      6592167, 7702390, 8945839, 10338502, 11898285, 13645242, 15601833, 17793215, 20247564, 22996434];
    expect(res.accRows).toHaveLength(20);
    res.accRows.forEach((row, i) => {
      expect(row.annualInvestment).toBe(300000);
      expect(r(row.yearEndValue)).toBe(want[i]);
    });
  });
  it("distribution table", () => {
    const want = [22568653, 22102372, 21594126, 21040138, 20436290, 19778097, 19060666, 18278666, 17426286, 16497192,
      15484479, 14380623, 13177419, 11865927, 10436401, 8878217, 7179797, 5328518, 3310625, 1111122];
    expect(res.yearRows).toHaveLength(20);
    res.yearRows.forEach((row, i) => {
      expect(row.planYear).toBe(21 + i);
      expect(r(row.endBalance)).toBe(want[i]);
    });
  });
});

describe("#51 SWP rebalance", () => {
  const res = computeSwpRebalance({
    initial: 7500000, debtAllocPct: 50, debtReturnPct: 6, balancedReturnPct: 9, annualWithdrawalPct: 7,
    frequency: "monthly", years: 22, rebalanceYears: 5, currentAge: 58,
  });
  it("headline figures", () => {
    expect(res.portfolioReturnPct).toBeCloseTo(7.5, 9);
    expect(r(res.perPeriodSwp)).toBe(42406);
    expect(r(res.annualWithdrawal)).toBe(508873);
    expect(r(res.totalWithdrawal)).toBe(11195208);
    expect(r(res.closingValue)).toBe(10096496);
    expect(res.debtShortfallYear).toBeNull();
  });
  it("every cell of the year table", () => {
    const want: number[][] = [
      [59, 3750000, 3452280, 3750000, 4087500, 7539780, 0], [60, 3452280, 3136697, 4087500, 4455375, 7592072, 0],
      [61, 3136697, 2802179, 4455375, 4856359, 7658538, 0], [62, 2802179, 2447590, 4856359, 5293431, 7741021, 0],
      [63, 2447590, 4091565, 5293431, 3750000, 7841565, 2019840], [64, 4091565, 3814339, 3750000, 4087500, 7901839, 0],
      [65, 3814339, 3520480, 4087500, 4455375, 7975855, 0], [66, 3520480, 3208989, 4455375, 4856359, 8065347, 0],
      [67, 3208989, 2878808, 4856359, 5293431, 8172239, 0], [68, 2878808, 4548657, 5293431, 3750000, 8298657, 2019840],
      [69, 4548657, 4298856, 3750000, 4087500, 8386356, 0], [70, 4298856, 4034068, 4087500, 4455375, 8489443, 0],
      [71, 4034068, 3753392, 4455375, 4856359, 8609750, 0], [72, 3753392, 3455875, 4856359, 5293431, 8749306, 0],
      [73, 3455875, 5160348, 5293431, 3750000, 8910348, 2019840], [74, 5160348, 4947249, 3750000, 4087500, 9034749, 0],
      [75, 4947249, 4721364, 4087500, 4455375, 9176739, 0], [76, 4721364, 4481926, 4455375, 4856359, 9338285, 0],
      [77, 4481926, 4228121, 4856359, 5293431, 9521553, 0], [78, 4228121, 5978929, 5293431, 3750000, 9728929, 2019840],
      [79, 5978929, 5814945, 3750000, 4087500, 9902445, 0], [80, 5814945, 5641121, 4087500, 4455375, 10096496, 0],
    ];
    expect(res.rows).toHaveLength(22);
    res.rows.forEach((row, i) => {
      const w = want[i];
      expect(row.age).toBe(w[0]);
      expect(r(row.debtStart)).toBe(w[1]);
      expect(r(row.debtEnd)).toBe(w[2]);
      expect(r(row.balancedStart)).toBe(w[3]);
      expect(r(row.balancedEnd)).toBe(w[4]);
      expect(r(row.fundValue)).toBe(w[5]);
      expect(r(row.transfer)).toBe(w[6]);
      expect(r(row.annualWithdrawal)).toBe(508873);
    });
  });
});
