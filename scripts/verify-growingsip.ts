import { growingSipSchedule } from "../src/lib/goal-planning/calc";

const r = growingSipSchedule({ monthlySip: 100000, annualReturnPct: 14, annualGrowthPct: 10, years: 20 });
const f = (n: number) => Math.round(n).toLocaleString("en-IN");
const pct = (n: number) => (n * 100).toFixed(2) + "%";

function show(label: string, row: any) {
  console.log(`${label}: FV=${f(row.fv)}  invested=${f(row.invested)}  %corpus=${pct(row.profitPctOfCorpus)}`);
}
console.log("monthly rate:", r.monthlyRatePct.toFixed(4) + "%  (Excel expects 1.0979%)");
console.log("\n--- REGULAR ---");
show("Y1 ", r.regular[0]);   console.log("    Excel Y1 : FV=12,89,179  %corpus=7.43%");
show("Y20", r.regular[19]);  console.log("    Excel Y20: FV=11,73,47,413  invested=2,40,00,000  %corpus=388.95%");
console.log("\n--- GROWING ---");
show("Y1 ", r.growing[0]);   console.log("    Excel Y1 : FV=12,89,179  %corpus=7.43%");
show("Y2 ", r.growing[1]);   console.log("    Excel Y2 : FV=28,87,761  invested=25,20,000  %corpus=14.59%");
show("Y20", r.growing[19]);  console.log("    Excel Y20: FV=22,61,21,649  invested=6,87,29,999  %corpus=229.00%");
