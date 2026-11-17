/**
 * Reference case studies for the SIP & lumpsum suite (src/lib/calculators/sip-suite.ts)
 * and the Goal Planner (#15) — every published figure, to the rupee.
 */

import { describe, expect, it } from "vitest";
import {
  limitedSipFv, limitedSipNeed, lumpsumForTarget, lumpsumFv, lumpsumPlusSipFv,
  sipForTarget, sipFv, sipLumpsumForTarget, stepUpSipForTarget, stepUpSipFv,
} from "@/lib/calculators/sip-suite";
import { computeGoal } from "@/lib/calculators/goal-planner";

const R = Math.round;
/** "1,22,333" → 122333 */
const n = (s: string) => Number(s.replace(/,/g, ""));
const list = (s: string) => s.split("·").map((x) => n(x.trim()));
/** "a / b · c / d" → [[a, c], [b, d]] */
function pairs(s: string): [number[], number[]] {
  const a: number[] = [];
  const b: number[] = [];
  for (const part of s.split("·")) {
    const [x, y] = part.trim().replace(/^\d+\s+/, "").split("/");
    a.push(n(x.trim()));
    b.push(n(y.trim()));
  }
  return [a, b];
}

describe("#9 FV of lumpsum", () => {
  const res = lumpsumFv({ amount: 500000, years: 10, ratesPct: [15, 12] });
  it("final values", () => {
    expect(res.fv.map(R)).toEqual([2022779, 1552924]);
  });
  it("year-end table", () => {
    const [s1, s2] = pairs(
      "1 5,75,000 / 5,60,000 · 2 6,61,250 / 6,27,200 · 3 7,60,438 / 7,02,464 · 4 8,74,503 / 7,86,760 · 5 10,05,679 / 8,81,171 · 6 11,56,530 / 9,86,911 · 7 13,30,010 / 11,05,341 · 8 15,29,511 / 12,37,982 · 9 17,58,938 / 13,86,539 · 10 20,22,779 / 15,52,924",
    );
    expect(res.rows.map((r) => R(r.values[0]))).toEqual(s1);
    expect(res.rows.map((r) => R(r.values[1]))).toEqual(s2);
    expect(res.rows[0].investment).toBe(500000);
    expect(res.rows[1].investment).toBe(0);
  });
});

describe("#10 FV of lumpsum + SIP", () => {
  const res = lumpsumPlusSipFv({ monthlySip: 15000, sipPct: 15, lumpsum: 1000000, lumpsumPct: 12, years: 10 });
  it("legs and total", () => {
    expect(R(res.sipFv)).toBe(3945273);
    expect(R(res.lumpsumFv)).toBe(3105848);
    expect(R(res.total)).toBe(7051121);
  });
  it("year table", () => {
    const table = [
      [1180000, 1180000, 194313, 1120000, 1314313],
      [180000, 1360000, 417773, 1254400, 1672173],
      [180000, 1540000, 674751, 1404928, 2079679],
      [180000, 1720000, 970277, 1573519, 2543796],
      [180000, 1900000, 1310131, 1762342, 3072473],
      [180000, 2080000, 1700964, 1973823, 3674786],
      [180000, 2260000, 2150421, 2210681, 4361102],
      [180000, 2440000, 2667297, 2475963, 5143260],
      [180000, 2620000, 3261704, 2773079, 6034783],
      [180000, 2800000, 3945273, 3105848, 7051121],
    ];
    expect(res.rows.map((r) => [r.annual, r.cumulative, r.sipValue, r.lumpsumValue, r.total].map(R))).toEqual(table);
  });
});

describe("#11 FV of SIP with a ₹ step-up", () => {
  const res = sipFv({ monthly: 10000, years: 15, ratesPct: [12, 15], stepUp: { mode: "amount", amount: 2000 } });
  it("totals and FV", () => {
    expect(R(res.normal.invested)).toBe(1800000);
    expect(R(res.stepUp!.invested)).toBe(4320000);
    expect(res.normal.fv.map(R)).toEqual([4759314, 6163656]);
    expect(res.stepUp!.fv.map(R)).toEqual([9499880, 11791026]);
  });
  it("normal year-end table", () => {
    const [a, b] = pairs(
      "1 1,27,665/1,29,542 · 2 2,70,650/2,78,515 · 3 4,30,793/4,49,834 · 4 6,10,153/6,46,851 · 5 8,11,036/8,73,421 · 6 10,36,025/11,33,976 · 7 12,88,013/14,33,614 · 8 15,70,240/17,78,198 · 9 18,86,334/21,74,470 · 10 22,40,359/26,30,182 · 11 26,36,867/31,54,251 · 12 30,80,956/37,56,931 · 13 35,78,336/44,50,012 · 14 41,35,401/52,47,056 · 15 47,59,314/61,63,656",
    );
    expect(res.normal.rows.map((r) => R(r.values[0]))).toEqual(a);
    expect(res.normal.rows.map((r) => R(r.values[1]))).toEqual(b);
  });
  it("step-up year-end table and instalments", () => {
    const [a, b] = pairs(
      "1 1,27,665/1,29,542 · 2 2,96,183/3,04,423 · 3 5,10,456/5,31,446 · 4 7,75,974/8,18,429 · 5 10,98,888/11,74,369 · 6 14,86,085/16,09,608 · 7 19,45,278/21,36,042 · 8 24,85,107/27,67,349 · 9 31,15,249/35,19,260 · 10 38,46,541/44,09,866 · 11 46,91,121/54,59,971 · 12 56,62,583/66,93,501 · 13 67,76,154/81,37,969 · 14 80,48,886/98,25,015 · 15 94,99,880/1,17,91,026",
    );
    const rows = res.stepUp!.rows;
    expect(rows.map((r) => R(r.values[0]))).toEqual(a);
    expect(rows.map((r) => R(r.values[1]))).toEqual(b);
    expect(rows[0].monthly).toBe(10000);
    expect(rows[14].monthly).toBe(38000);
    expect(rows[0].annual).toBe(120000);
    expect(rows[14].annual).toBe(456000);
  });
});

describe("#13 FV of step-up SIP", () => {
  const res = stepUpSipFv({ monthly: 10000, stepUpPct: 10, years: 20, ratesPct: [12, 15] });
  const table = `1 | 10,000 | 1,20,000 | 1,27,665 | 1,29,542
2 | 11,000 | 1,32,000 | 2,83,416 | 2,91,469
3 | 12,100 | 1,45,200 | 4,71,901 | 4,91,935
4 | 13,310 | 1,59,720 | 6,98,451 | 7,38,146
5 | 14,641 | 1,75,692 | 9,69,179 | 10,38,530
6 | 16,105 | 1,93,261 | 12,91,087 | 14,02,938
7 | 17,716 | 2,12,587 | 16,72,183 | 18,42,870
8 | 19,487 | 2,33,846 | 21,21,628 | 23,71,741
9 | 21,436 | 2,57,231 | 26,49,885 | 30,05,187
10 | 23,579 | 2,82,954 | 32,68,898 | 37,61,418
11 | 25,937 | 3,11,249 | 39,92,296 | 46,61,629
12 | 28,531 | 3,42,374 | 48,35,615 | 57,30,471
13 | 31,384 | 3,76,611 | 58,16,556 | 69,96,600
14 | 34,523 | 4,14,273 | 69,55,277 | 84,93,303
15 | 37,975 | 4,55,700 | 82,74,718 | 1,02,59,234
16 | 41,772 | 5,01,270 | 98,00,972 | 1,23,39,247
17 | 45,950 | 5,51,397 | 1,15,63,706 | 1,47,85,376
18 | 50,545 | 6,06,536 | 1,35,96,630 | 1,76,57,948
19 | 55,599 | 6,67,190 | 1,59,38,032 | 2,10,26,882
20 | 61,159 | 7,33,909 | 1,86,31,383 | 2,49,73,181`;
  it("total and FV", () => {
    expect(R(res.invested)).toBe(6873000);
    expect(res.fv.map(R)).toEqual([18631383, 24973181]);
  });
  it("every row", () => {
    const want = table.split("\n").map((l) => l.split("|").map((c) => n(c.trim())));
    const got = res.rows.map((r) => [r.year, R(r.monthly), R(r.annual), R(r.values[0]), R(r.values[1])]);
    expect(got).toEqual(want);
  });
});

describe("#8 FV of limited-period SIP", () => {
  const res = limitedSipFv({ monthly: 5000, sipYears: 5, deferYears: 10, ratesPct: [12, 15] });
  it("total and FV", () => {
    expect(res.invested).toBe(300000);
    expect(res.fv.map(R)).toEqual([1259478, 1766737]);
  });
  it("year table", () => {
    const [a, b] = pairs(
      "1 63,832 / 64,771 · 2 1,35,325 / 1,39,258 · 3 2,15,396 / 2,24,917 · 4 3,05,076 / 3,23,426 · 5 4,05,518 / 4,36,710 · 6 4,54,180 / 5,02,217 · 7 5,08,682 / 5,77,549 · 8 5,69,724 / 6,64,182 · 9 6,38,091 / 7,63,809 · 10 7,14,661 / 8,78,381 · 11 8,00,421 / 10,10,138 · 12 8,96,471 / 11,61,658 · 13 10,04,048 / 13,35,907 · 14 11,24,534 / 15,36,293 · 15 12,59,478 / 17,66,737",
    );
    expect(res.rows.map((r) => R(r.values[0]))).toEqual(a);
    expect(res.rows.map((r) => R(r.values[1]))).toEqual(b);
    expect(res.rows[4].annual).toBe(60000);
    expect(res.rows[5].annual).toBe(0);
  });
});

describe("#20 Limited-period SIP need", () => {
  const [s1] = limitedSipNeed({ target: 2500000, sipYears: 5, deferYears: 10, ratesPct: [12] });
  it("SIP and total investment (from the unrounded SIP)", () => {
    expect(R(s1.monthlySip)).toBe(9925);
    expect(R(s1.totalInvestment)).toBe(595485);
  });
  it("the corpus reaches the target", () => {
    expect(R(s1.rows[s1.rows.length - 1].value)).toBe(2500000);
    expect(s1.rows).toHaveLength(15);
  });
});

describe("#43 Step-up SIP required for a target", () => {
  const [a, b] = stepUpSipForTarget({ target: 5000000, years: 15, stepUpPct: 5, ratesPct: [10, 13] });
  it("starting SIP and total", () => {
    expect(R(a.startSip)).toBe(9425);
    expect(R(a.total)).toBe(2440656);
    expect(R(b.startSip)).toBe(7467);
    expect(R(b.total)).toBe(1933620);
  });
  const triples = (s: string) => s.split("·").map((t) => t.trim().split("/").map(n));
  it("year-wise @10%", () => {
    const want = triples(
      "9,425/1,13,106/1,19,143 · 9,897/1,18,761/2,56,157 · 10,392/1,24,699/4,13,128 · 10,911/1,30,934/5,92,364 · 11,457/1,37,481/7,96,419 · 12,030/1,44,355/10,28,121 · 12,631/1,51,572/12,90,596 · 13,263/1,59,151/15,87,302 · 13,926/1,67,108/19,22,060 · 14,622/1,75,464/22,99,096 · 15,353/1,84,237/27,23,077 · 16,121/1,93,449/31,99,159 · 16,927/2,03,121/37,33,039 · 17,773/2,13,277/43,31,005 · 18,662/2,23,941/50,00,000",
    );
    expect(a.rows.map((r) => [R(r.monthly), R(r.annual), R(r.value)])).toEqual(want);
  });
  it("year-wise @13%", () => {
    const want = triples(
      "7,467/89,608/95,801 · 7,841/94,089/2,08,845 · 8,233/98,793/3,41,615 · 8,644/1,03,733/4,96,926 · 9,077/1,08,920/6,77,973 · 9,530/1,14,366/8,88,378 · 10,007/1,20,084/11,32,249 · 10,507/1,26,088/14,14,242 · 11,033/1,32,392/17,39,634 · 11,584/1,39,012/21,14,405 · 12,164/1,45,963/25,45,326 · 12,772/1,53,261/30,40,070 · 13,410/1,60,924/36,07,323 · 14,081/1,68,970/42,56,922 · 14,785/1,77,418/50,00,000",
    );
    expect(b.rows.map((r) => [R(r.monthly), R(r.annual), R(r.value)])).toEqual(want);
  });
});

describe("#39 SIP required for a target (cost of delay)", () => {
  const [a, b] = sipForTarget({ target: 5000000, years: 15, ratesPct: [12, 15], stepUpPct: 10, costOfDelay: true });
  it("monthly SIP and total investment", () => {
    expect([a.sip, b.sip, a.stepUp!.startSip, b.stepUp!.startSip].map(R)).toEqual([10506, 8112, 6043, 4874]);
    expect([a.total, b.total, a.stepUp!.total, b.stepUp!.total].map(R)).toEqual([1891029, 1460172, 2303823, 1858179]);
  });
  it("normal year-wise", () => {
    expect(a.rows.every((r) => R(r.annual) === 126069)).toBe(true);
    expect(b.rows.every((r) => R(r.annual) === 97345)).toBe(true);
    expect(a.rows.map((r) => R(r.value))).toEqual(list(
      "1,34,121 · 2,84,337 · 4,52,579 · 6,41,009 · 8,52,052 · 10,88,419 · 13,53,150 · 16,49,650 · 19,81,729 · 23,53,657 · 27,70,217 · 32,36,765 · 37,59,298 · 43,44,535 · 50,00,000",
    ));
    expect(b.rows.map((r) => R(r.value))).toEqual(list(
      "1,05,085 · 2,25,933 · 3,64,909 · 5,24,730 · 7,08,525 · 9,19,889 · 11,62,958 · 14,42,486 · 17,63,945 · 21,33,622 · 25,58,750 · 30,47,648 · 36,09,880 · 42,56,448 · 50,00,000",
    ));
  });
  it("step-up year-wise", () => {
    expect(a.stepUp!.rows.map((r) => R(r.annual))).toEqual(list(
      "72,510 · 79,761 · 87,737 · 96,511 · 1,06,162 · 1,16,778 · 1,28,456 · 1,41,302 · 1,55,432 · 1,70,975 · 1,88,072 · 2,06,880 · 2,27,568 · 2,50,324 · 2,75,357",
    ));
    expect(a.stepUp!.rows.map((r) => R(r.value))).toEqual(list(
      "77,142 · 1,71,254 · 2,85,146 · 4,22,039 · 5,85,627 · 7,80,139 · 10,10,417 · 12,81,994 · 16,01,194 · 19,75,233 · 24,12,346 · 29,21,921 · 35,14,655 · 42,02,728 · 50,00,000",
    ));
    expect(b.stepUp!.rows.map((r) => R(r.annual))).toEqual(list(
      "58,484 · 64,332 · 70,766 · 77,842 · 85,626 · 94,189 · 1,03,608 · 1,13,969 · 1,25,365 · 1,37,902 · 1,51,692 · 1,66,861 · 1,83,548 · 2,01,902 · 2,22,093",
    ));
    expect(b.stepUp!.rows.map((r) => R(r.value))).toEqual(list(
      "63,134 · 1,42,052 · 2,39,752 · 3,59,747 · 5,06,144 · 6,83,744 · 8,98,152 · 11,55,906 · 14,64,625 · 18,33,186 · 22,71,918 · 27,92,836 · 34,09,904 · 41,39,346 · 50,00,000",
    ));
  });
  it("cost of delay 1…14 years", () => {
    const parse = (s: string) => s.split("·").map((t) => t.trim().replace(/^\d+y\s+/, "").split("/").map(n));
    const w12 = parse(
      "1y 12,091/20,31,242 · 2y 13,973/21,79,784 · 3y 16,229/23,36,937 · 4y 18,962/25,02,970 · 5y 22,318/26,78,142 · 6y 26,506/28,62,696 · 7y 31,842/30,56,857 · 8y 38,819/32,60,835 · 9y 48,261/34,74,818 · 10y 61,650/36,98,972 · 11y 81,947/39,33,441 · 12y 1,16,065/41,78,344 · 13y 1,84,741/44,33,775 · 14y 3,91,650/46,99,801",
    );
    const w15 = parse(
      "9,529/16,00,898 · 11,236/17,52,804 · 13,309/19,16,458 · 15,852/20,92,414 · 19,010/22,81,211 · 22,994/24,83,364 · 28,118/26,99,362 · 34,877/29,29,659 · 44,093/31,74,671 · 57,246/34,34,771 · 77,298/37,10,281 · 1,11,152/40,01,474 · 1,79,524/43,08,564 · 3,85,976/46,31,707",
    );
    expect(a.delay!.map((d) => d.delayYears)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    expect(a.delay!.map((d) => [R(d.sip), R(d.total)])).toEqual(w12);
    expect(b.delay!.map((d) => [R(d.sip), R(d.total)])).toEqual(w15);
  });
});

describe("#41 SIP / lumpsum required for a target", () => {
  const res = sipLumpsumForTarget({
    target: 10000000, years: 15, solve: "sip", lumpsum: 1000000, monthlySip: 0, sipPct: 12, lumpsumPct: 12,
  });
  it("monthly SIP", () => {
    expect(R(res.sip)).toBe(9511);
    expect(res.covered).toBe(false);
  });
  it("year table", () => {
    const rows = res.rows;
    expect(R(rows[0].annual)).toBe(1114128);
    expect(rows.slice(1).every((r) => R(r.annual) === 114128)).toBe(true);
    expect(rows.map((r) => R(r.cumulative))).toEqual(list(
      "11,14,128 · 12,28,256 · 13,42,385 · 14,56,513 · 15,70,641 · 16,84,769 · 17,98,898 · 19,13,026 · 20,27,154 · 21,41,282 · 22,55,411 · 23,69,539 · 24,83,667 · 25,97,795 · 27,11,924",
    ));
    expect(rows.map((r) => R(r.sipValue))).toEqual(list(
      "1,21,418 · 2,57,406 · 4,09,713 · 5,80,297 · 7,71,351 · 9,85,331 · 12,24,989 · 14,93,406 · 17,94,033 · 21,30,735 · 25,07,841 · 29,30,201 · 34,03,243 · 39,33,050 · 45,26,434",
    ));
    expect(rows.map((r) => R(r.lumpsumValue))).toEqual(list(
      "11,20,000 · 12,54,400 · 14,04,928 · 15,73,519 · 17,62,342 · 19,73,823 · 22,10,681 · 24,75,963 · 27,73,079 · 31,05,848 · 34,78,550 · 38,95,976 · 43,63,493 · 48,87,112 · 54,73,566",
    ));
    expect(rows.map((r) => R(r.total))).toEqual(list(
      "12,41,418 · 15,11,806 · 18,14,641 · 21,53,817 · 25,33,693 · 29,59,154 · 34,35,671 · 39,69,369 · 45,67,112 · 52,36,583 · 59,86,391 · 68,26,177 · 77,66,736 · 88,20,162 · 1,00,00,000",
    ));
  });
  it("lumpsum mode is the inverse", () => {
    const inv = sipLumpsumForTarget({
      target: 10000000, years: 15, solve: "lumpsum", lumpsum: 0, monthlySip: res.sip, sipPct: 12, lumpsumPct: 12,
    });
    expect(R(inv.lumpsum)).toBe(1000000);
  });
  it("a lumpsum that already covers the target needs no SIP", () => {
    const big = sipLumpsumForTarget({
      target: 1000000, years: 15, solve: "sip", lumpsum: 1000000, monthlySip: 0, sipPct: 12, lumpsumPct: 12,
    });
    expect(big.covered).toBe(true);
    expect(big.sip).toBe(0);
  });
});

describe("#24 Lumpsum required for a target", () => {
  const [a, b] = lumpsumForTarget({ target: 30000000, years: 25, ratesPct: [12, 15] });
  it("lumpsum per scenario", () => {
    expect(R(a.lumpsum)).toBe(1764699);
    expect(R(b.lumpsum)).toBe(911329);
  });
  it("year-end values from the unrounded lumpsum", () => {
    expect(a.rows.map((r) => R(r.value))).toEqual(list(
      "19,76,463 · 22,13,639 · 24,79,275 · 27,76,788 · 31,10,003 · 34,83,203 · 39,01,188 · 43,69,330 · 48,93,650 · 54,80,888 · 61,38,594 · 68,75,226 · 77,00,253 · 86,24,283 · 96,59,197 · 1,08,18,301 · 1,21,16,497 · 1,35,70,476 · 1,51,98,934 · 1,70,22,806 · 1,90,65,542 · 2,13,53,407 · 2,39,15,816 · 2,67,85,714 · 3,00,00,000",
    ));
    expect(b.rows.map((r) => R(r.value))).toEqual(list(
      "10,48,028 · 12,05,233 · 13,86,018 · 15,93,920 · 18,33,008 · 21,07,960 · 24,24,154 · 27,87,777 · 32,05,943 · 36,86,835 · 42,39,860 · 48,75,839 · 56,07,215 · 64,48,297 · 74,15,541 · 85,27,872 · 98,07,053 · 1,12,78,111 · 1,29,69,828 · 1,49,15,302 · 1,71,52,597 · 1,97,25,487 · 2,26,84,310 · 2,60,86,957 · 3,00,00,000",
    ));
  });
});

describe("#15 Goal Calculator — the existing Goal Planner (month-END SIP)", () => {
  const rates = { debt: 6, hybrid: 9, equity: 12 };
  const alloc = { debt: 0, hybrid: 0, equity: 100 };
  const goal = (costBasis: "future" | "current", cost: number, inflationPct: number, periodYears: number, limitedYears: number, comboLumpsum: number) =>
    computeGoal({ costBasis, cost, inflationPct, periodYears, alloc, rates, limitedYears, comboLumpsum });
  const row = (g: ReturnType<typeof goal>) => [g.lumpsum, g.monthlySip, g.limitedSip, g.comboSip].map(R);
  it("case A — future cost", () => {
    expect(row(goal("future", 5000000, 0, 15, 10, 500000))).toEqual([913481, 10605, 12784, 4800]);
    expect(row(goal("future", 10000000, 0, 20, 15, 500000))).toEqual([1036668, 10974, 12036, 5681]);
    expect(row(goal("future", 100000000, 0, 25, 15, 2500000))).toEqual([5882331, 59305, 68293, 34100]);
  });
  it("case B — current cost + inflation", () => {
    const edu = goal("current", 1500000, 8, 15, 10, 500000);
    const house = goal("current", 5000000, 7, 20, 15, 500000);
    const ret = goal("current", 20000000, 6, 25, 20, 1000000);
    expect([edu, house, ret].map((g) => R(g.futureCost))).toEqual([4758254, 19348422, 85837414]);
    expect(row(edu)).toEqual([869315, 10093, 12166, 4288]);
    expect(row(house)).toEqual([2005788, 21234, 23287, 15941]);
    expect(row(ret)).toEqual([5049241, 50906, 53452, 40824]);
  });
});
