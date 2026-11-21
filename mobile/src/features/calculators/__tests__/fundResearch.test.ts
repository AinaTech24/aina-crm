/**
 * Fund Research: each def against the web CRM on synthetic NAV histories —
 * the app's copy of src/lib/fund-research must answer exactly as the web
 * module does (webModule), and each def must print the web's figures with the
 * web component's formatting.
 */

import { webModule } from "../testing/webModules";
import { run, statOf, tables, defaults } from "../testing/helpers";
import { DEFS, todayIso, yearsBefore, dateText, pctText, navText, unitsText } from "../defs/fundResearch";
import * as appNav from "../web/fund-research/nav";
import * as appSip from "../web/fund-research/sip";
import * as appLump from "../web/fund-research/lumpsum";
import * as appStp from "../web/fund-research/stp";
import * as appSwp from "../web/fund-research/swp";
import * as appRoll from "../web/fund-research/rolling";
import * as appCmp from "../web/fund-research/compare";
import * as appPer from "../web/fund-research/periodic";
import { inr, count } from "../fmt";
import type { CalcContext, ResultBlock } from "../types";

const webNav = webModule<typeof appNav>("fund-research/nav");
const webSip = webModule<typeof appSip>("fund-research/sip");
const webLump = webModule<typeof appLump>("fund-research/lumpsum");
const webStp = webModule<typeof appStp>("fund-research/stp");
const webSwp = webModule<typeof appSwp>("fund-research/swp");
const webRoll = webModule<typeof appRoll>("fund-research/rolling");
const webCmp = webModule<typeof appCmp>("fund-research/compare");
const webPer = webModule<typeof appPer>("fund-research/periodic");
const webFormat = webModule<{ formatDate: (v: string) => string }>("format");

/* ───────────── synthetic NAV histories ───────────── */

/**
 * Business days (Mon–Fri) from `from` to `to`, every `holidayEvery`-th one
 * skipped (so the next-NAV rule is exercised), NAV moving by a seeded LCG walk
 * and rounded to 4 decimals as a published NAV is.
 */
function synth(o: { seed: number; from: string; to: string; start: number; drift: number; vol: number; holidayEvery: number }): appNav.NavPoint[] {
  const pts: appNav.NavPoint[] = [];
  let seed = o.seed >>> 0;
  let nav = o.start;
  let biz = 0;
  for (let d = appNav.dayNum(o.from); d <= appNav.dayNum(o.to); d++) {
    const dow = (d + 4) % 7; // 1970-01-01 was a Thursday; 0 = Sunday
    if (dow === 0 || dow === 6) continue;
    biz++;
    if (biz % o.holidayEvery === 0) continue;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const u = seed / 2 ** 32 - 0.5;
    nav = nav * (1 + o.drift / 252 + o.vol * u * 0.22);
    pts.push({ date: appNav.isoFromDay(d), nav: Math.round(nav * 10000) / 10000 });
  }
  return pts;
}

const PTS_A = synth({ seed: 7, from: "2012-01-02", to: "2024-06-28", start: 10, drift: 0.14, vol: 0.12, holidayEvery: 17 });
const PTS_B = synth({ seed: 11, from: "2016-03-15", to: "2024-06-28", start: 25, drift: 0.07, vol: 0.01, holidayEvery: 13 });
const PTS_C = synth({ seed: 3, from: "2013-06-03", to: "2024-06-28", start: 40, drift: -0.02, vol: 0.18, holidayEvery: 19 });

const A = appNav.navSeries(PTS_A);
const B = appNav.navSeries(PTS_B);
const C = appNav.navSeries(PTS_C);

const PICK_A = { code: "100001", name: "Alpha Flexi Cap Fund - Direct Growth" };
const PICK_B = { code: "100002", name: "Beta Short Duration Fund - Regular Growth" };
const PICK_C = { code: "100003", name: "Gamma Thematic Fund - Direct Growth" };
const CTX: CalcContext = { nav: { [PICK_A.code]: A, [PICK_B.code]: B, [PICK_C.code]: C } };

/* ───────────── helpers ───────────── */

const texts = (b: ResultBlock[], type: "insight" | "note" | "section") =>
  b.flatMap((x) => (x.type === type ? [x.text] : []));
const insights = (b: ResultBlock[]) => b.flatMap((x) => (x.type === "insight" ? [x] : []));
const en = (n: number, d: number) => n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct2 = (n: number | null) => (n === null ? "—" : `${n.toFixed(2)}%`);
const DISCLAIMER = /^Past performance may or may not be sustained in future and is not a guarantee of future returns\./;

const SCHEME_KEYS = (key: string) => DEFS[key].inputs.filter((i) => i.type === "scheme").map((i) => i.key);

it("the series the tests run on are the web's navSeries too", () => {
  expect(A).toEqual(webNav.navSeries(PTS_A));
  expect(B).toEqual(webNav.navSeries(PTS_B));
  expect(A.dates.length).toBeGreaterThan(3000);
});

describe("the web's formatting (fund-research-ui.tsx)", () => {
  it.each(["2026-09-07", "2024-02-29", "2013-01-01", "2024-12-31"])("dateText %s equals the web's formatDate", (iso) => {
    expect(dateText(iso)).toBe(webFormat.formatDate(iso));
  });
  it.each([0, -0, -0.00001, 0.00005, 0.000025, 1e-7, 0.1 + 0.2, 1.5, 9.99995, 12.34567, 999.99995, 1234.5678, 123456.12345, 98765432.1, -1234.56789])("navText / unitsText %s equal toLocaleString en-IN", (n) => {
    expect(navText(n)).toBe(en(n, 4));
    expect(unitsText(n)).toBe(en(n, 3));
  });
  it("pctText", () => {
    expect(pctText(12.345)).toBe("12.35%");
    expect(pctText(null)).toBe("—");
    expect(pctText(NaN)).toBe("—");
    expect(pctText(3.14159, 1)).toBe("3.1%");
  });
  it("default dates are the web's (relative to today in India)", () => {
    const today = todayIso();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(yearsBefore("2024-02-29", 1)).toBe("2023-02-28");
    const d = defaults(DEFS.frsip);
    expect(d.end).toBe(today);
    expect(d.start).toBe(yearsBefore(today, 5));
    expect(defaults(DEFS.frrolling).start).toBe(yearsBefore(today, 10));
    expect(defaults(DEFS.frp2p).start).toBe(yearsBefore(today, 3));
    expect(defaults(DEFS.frswp).swpStart).toBe(yearsBefore(today, 4));
    expect(defaults(DEFS.frstp).stpEnd).toBe(yearsBefore(today, 3));
    expect(defaults(DEFS.frstpprofit).stpEnd).toBe(today);
  });
});

/* ───────────── every def ───────────── */

describe("every Fund Research def", () => {
  const keys = Object.keys(DEFS);

  it("covers the nine catalog keys", () => {
    expect(keys.sort()).toEqual(["frcalendar", "frlumpsum", "frmonthly", "frp2p", "frrolling", "frsip", "frstp", "frstpprofit", "frswp"]);
  });

  it.each(keys)("%s survives blank and zero inputs", (key) => {
    const body = DEFS[key];
    const zeros: Record<string, any> = {};
    const blanks: Record<string, any> = {};
    for (const i of body.inputs) {
      if (typeof i.default === "number") {
        zeros[i.key] = 0;
        blanks[i.key] = undefined;
      }
    }
    expect(() => run(body, zeros)).not.toThrow();
    expect(() => run(body, blanks)).not.toThrow();
    // …and with every scheme picked and its history loaded, blank dates and selects too.
    const picked: Record<string, any> = {};
    for (const k of SCHEME_KEYS(key)) picked[k] = PICK_A;
    const blankAll: Record<string, any> = { ...picked };
    for (const i of body.inputs) if (i.type !== "scheme") blankAll[i.key] = i.type === "date" ? "" : undefined;
    expect(() => run(body, { ...zeros, ...picked }, CTX)).not.toThrow();
    expect(() => run(body, { ...blanks, ...picked }, CTX)).not.toThrow();
    expect(() => run(body, blankAll, CTX)).not.toThrow();
    expect(() => run(body, { ...picked, frequency: "daily", sipDay: "x", stpDay: "0", swpDay: "99", years: "4", kind: "?", show: "?" }, CTX)).not.toThrow();
  });

  it.each(keys)("%s with no scheme picked asks for one", (key) => {
    const b = run(DEFS[key]);
    const ins = insights(b);
    expect(ins).toHaveLength(1);
    expect(ins[0].text).toMatch(/^Pick /);
    expect(DEFS[key].navSchemes!(defaults(DEFS[key]))).toEqual([]);
  });

  it.each(keys)("%s with a scheme whose NAV did not load computes without it", (key) => {
    const picked: Record<string, any> = {};
    for (const k of SCHEME_KEYS(key)) picked[k] = { code: "999999", name: "Missing Fund" };
    let b: ResultBlock[] = [];
    expect(() => { b = run(DEFS[key], picked, { nav: {} }); }).not.toThrow();
    // Nothing is computed for it: no table, no stat (the screen shows the load error).
    expect(tables(b)).toHaveLength(0);
    expect(b.some((x) => x.type === "stat")).toBe(false);
    expect(DEFS[key].navSchemes!({ ...defaults(DEFS[key]), ...picked })).toContain("999999");
  });
});

/* ───────────── frsip ───────────── */

describe("frsip — SIP Return of a Scheme", () => {
  const cases: appSip.SipReturnInput[] = [
    { amount: 10000, frequency: "monthly", sipDay: 5, startDate: "2015-01-01", endDate: "2020-12-31", stepUpPct: 0 },
    { amount: 2500, frequency: "weekly", sipDay: 5, startDate: "2018-03-03", endDate: "2024-06-28", stepUpPct: 10 },
    { amount: 30000, frequency: "quarterly", sipDay: 28, startDate: "2012-01-01", endDate: "2023-09-30", stepUpPct: 5 },
  ];
  it.each(cases)("sipReturn equals the web module (%#)", (inp) => {
    expect(appSip.sipReturn(A, inp)).toEqual(webSip.sipReturn(A, inp));
    expect(appSip.sipReturn(B, inp)).toEqual(webSip.sipReturn(B, inp));
  });

  it("prints the web's figures", () => {
    const inp = cases[0];
    const w = webSip.sipReturn(A, inp);
    if (!w.ok) throw new Error(w.error);
    const b = run(DEFS.frsip, { scheme: PICK_A, start: inp.startDate, end: inp.endDate }, CTX);
    expect(statOf(b, "Invested")).toBe(inr(w.invested));
    expect(statOf(b, "Invested")).toBe("₹7,20,000"); // 72 monthly instalments of ₹10,000
    expect(statOf(b, `Value on ${dateText(w.valueDate)}`)).toBe(inr(w.currentValue));
    expect(statOf(b, "Profit")).toBe(inr(w.profit));
    expect(statOf(b, "XIRR")).toBe(pct2(w.xirrPct));
    expect(statOf(b, "Instalments")).toBe(String(w.instalments));
    expect(statOf(b, "Units held")).toBe(en(w.units, 3));
    expect(statOf(b, `NAV on ${dateText(w.valueDate)}`)).toBe(en(w.valueNav, 4));
    expect(statOf(b, "Absolute return")).toBe(pct2(w.absolutePct));
    expect(insights(b)[0].text).toBe(
      `${w.instalments} instalments totalling ${inr(w.invested)} in ${PICK_A.name} were worth ${inr(w.currentValue)} on ${dateText(w.valueDate)} — an XIRR of ${pct2(w.xirrPct)}.`,
    );
    expect(texts(b, "section")).toEqual(["2. Cash flow"]);
    const t = tables(b)[0];
    expect(t.head).toEqual(["NAV date", "NAV", "Amount", "Units", "Cumulative units", "Value"]);
    expect(t.rows).toHaveLength(w.rows.length);
    expect(t.rows[0]).toEqual([dateText(w.rows[0].date), en(w.rows[0].nav, 4), inr(w.rows[0].amount), en(w.rows[0].units, 3), en(w.rows[0].cumulativeUnits, 3), inr(w.rows[0].value)]);
    const notes = texts(b, "note");
    expect(notes[0]).toBe(`${PICK_A.name}: ${count(A.dates.length)} NAVs, ${dateText(A.dates[0])} to ${dateText(A.dates[A.dates.length - 1])}`);
    expect(notes.some((n) => DISCLAIMER.test(n))).toBe(true);
    expect(notes[notes.length - 1]).toBe(`NAVs used — ${PICK_A.name}: ${dateText(w.rows[0].date)} to ${dateText(w.valueDate)}`);
  });

  it("says how many instalments fell before the launch, and shows the maths' refusals", () => {
    const b = run(DEFS.frsip, { scheme: PICK_B, start: "2015-01-01", end: "2018-12-31" }, CTX);
    const w = webSip.sipReturn(B, { amount: 10000, frequency: "monthly", sipDay: 5, startDate: "2015-01-01", endDate: "2018-12-31", stepUpPct: 0 });
    if (!w.ok) throw new Error(w.error);
    expect(w.skippedBeforeLaunch).toBeGreaterThan(0);
    expect(insights(b)[0].text).toContain(` ${w.skippedBeforeLaunch} instalment(s) dated before the scheme's launch are left out.`);
    const bad = run(DEFS.frsip, { scheme: PICK_A, start: "2020-01-01", end: "2019-01-01" }, CTX);
    expect(insights(bad)).toEqual([{ type: "insight", text: "The start date must be on or before the end date.", tone: "danger" }]);
    expect(insights(run(DEFS.frsip, { scheme: PICK_A, amount: 0 }, CTX))[0].text).toBe("Enter an instalment amount.");
  });

  it("names the scheme it needs", () => {
    expect(DEFS.frsip.navSchemes!({ scheme: PICK_A })).toEqual([PICK_A.code]);
  });
});

/* ───────────── frlumpsum ───────────── */

describe("frlumpsum — Lumpsum Return of Schemes", () => {
  const cases: appLump.LumpsumReturnInput[] = [
    { amount: 100000, startDate: "2014-04-01", endDate: "2024-03-31" },
    { amount: 250000, startDate: "2019-06-15", endDate: "2019-12-15" },
    { amount: 100000, startDate: "2015-01-01", endDate: "2024-06-28" },
  ];
  it.each(cases)("lumpsumReturn equals the web module (%#)", (inp) => {
    for (const s of [A, B, C]) expect(appLump.lumpsumReturn(s, inp)).toEqual(webLump.lumpsumReturn(s, inp));
  });

  it("prints one row per loaded scheme, the web's refusal in place, and the best", () => {
    const inp = cases[2];
    const b = run(DEFS.frlumpsum, { scheme1: PICK_A, scheme2: PICK_B, scheme3: PICK_C, scheme4: { code: "404", name: "Not loaded" }, start: inp.startDate, end: inp.endDate }, CTX);
    const wa = webLump.lumpsumReturn(A, inp);
    const wb = webLump.lumpsumReturn(B, inp);
    const wc = webLump.lumpsumReturn(C, inp);
    if (!wa.ok || !wc.ok || wb.ok) throw new Error("unexpected outcome");
    const t = tables(b)[0];
    expect(t.head).toEqual(["Scheme", "Bought on", "NAV", "Units", "Valued on", "Value", "Profit", "CAGR", "Absolute"]);
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0]).toEqual([PICK_A.name, dateText(wa.buyDate), en(wa.buyNav, 4), en(wa.units, 3), dateText(wa.valueDate), inr(wa.value), inr(wa.profit), pct2(wa.cagrPct), pct2(wa.absolutePct)]);
    expect(t.rows[1]).toEqual([PICK_B.name, wb.error, "", "", "", "", "", "", ""]);
    expect(wb.error).toBe("Launched on 15-03-2016 — after the start date.");
    expect(insights(b).map((i) => i.text)).toContain(`${PICK_B.name}: ${wb.error}`);
    const best = wa.value >= wc.value ? { n: PICK_A.name, r: wa } : { n: PICK_C.name, r: wc };
    expect(insights(b).map((i) => i.text)).toContain(`${inr(100000)} grew most in ${best.n}: ${inr(best.r.value)} by ${dateText(best.r.valueDate)}.`);
    expect(texts(b, "note").filter((n) => n.startsWith("NAVs used"))).toEqual([
      `NAVs used — ${PICK_A.name}: ${dateText(wa.buyDate)} to ${dateText(wa.valueDate)}`,
      `NAVs used — ${PICK_C.name}: ${dateText(wc.buyDate)} to ${dateText(wc.valueDate)}`,
    ]);
    expect(DEFS.frlumpsum.navSchemes!({ scheme1: PICK_A, scheme3: PICK_C })).toEqual([PICK_A.code, PICK_C.code]);
  });

  it("a period under a year has no CAGR", () => {
    const b = run(DEFS.frlumpsum, { scheme1: PICK_A, start: cases[1].startDate, end: cases[1].endDate }, CTX);
    expect(tables(b)[0].rows[0][7]).toBe("Under 1 yr");
    expect(texts(b, "insight")).toEqual([]); // one scheme: no "grew most"
  });

  it("shows slot n only once slot n − 1 is picked", () => {
    const slot2 = DEFS.frlumpsum.inputs.find((i) => i.key === "scheme2")!;
    expect(slot2.visibleIf!({ scheme1: null, scheme2: null })).toBe(false);
    expect(slot2.visibleIf!({ scheme1: PICK_A, scheme2: null })).toBe(true);
    expect(slot2.visibleIf!({ scheme1: null, scheme2: PICK_B })).toBe(true);
  });
});

/* ───────────── frstp / frstpprofit ───────────── */

describe("frstp / frstpprofit — STP Return", () => {
  const today = todayIso();
  const cases: appStp.StpReturnInput[] = [
    { initialAmount: 500000, investDate: "2017-01-02", mode: "fixed", stpAmount: 20000, frequency: "monthly", stpDay: 10, stpStart: "2017-01-02", stpEnd: "2019-01-02", valueOn: today },
    { initialAmount: 300000, investDate: "2017-01-02", mode: "fixed", stpAmount: 25000, frequency: "fortnightly", stpDay: 10, stpStart: "2017-02-01", stpEnd: "2019-01-02", valueOn: today },
    { initialAmount: 1000000, investDate: "2014-01-01", mode: "appreciation", stpAmount: 20000, frequency: "quarterly", stpDay: 10, stpStart: "2014-01-01", stpEnd: "2024-06-28", valueOn: today },
  ];
  it.each(cases)("stpReturn equals the web module (%#)", (inp) => {
    expect(appStp.stpReturn(B, A, inp)).toEqual(webStp.stpReturn(B, A, inp));
    expect(appStp.stpReturn(A, C, inp)).toEqual(webStp.stpReturn(A, C, inp));
  });

  it("frstp prints the web's figures, legs and transfers", () => {
    const inp = cases[0];
    const w = webStp.stpReturn(B, A, inp);
    if (!w.ok) throw new Error(w.error);
    const b = run(DEFS.frstp, { fromScheme: PICK_B, toScheme: PICK_A, investDate: inp.investDate, stpStart: inp.stpStart, stpEnd: inp.stpEnd }, CTX);
    expect(statOf(b, "Invested")).toBe("₹5,00,000");
    expect(statOf(b, "Moved by STP")).toBe(inr(w.transferred));
    expect(statOf(b, `Total value on ${dateText(w.from.currentValueDate)}`)).toBe(inr(w.total.currentValue));
    expect(statOf(b, "Total XIRR")).toBe(pct2(w.total.xirrPct));
    expect(insights(b)[0].text).toBe(
      `${w.transfers} transfers moved ${inr(w.transferred)} from ${PICK_B.name} to ${PICK_A.name}. The ${inr(500000)} invested is now worth ${inr(w.total.currentValue)}, a profit of ${inr(w.total.profit)} (${pct2(w.total.absolutePct)}).`,
    );
    expect(texts(b, "section")).toEqual(["1. Each leg", "2. Transfers"]);
    const [from, to, transfers] = tables(b);
    expect(from.head).toEqual([`From: ${PICK_B.name}`, "Amount"]);
    expect(from.rows[2]).toEqual(["Units remaining", en(w.from.units, 3)]);
    expect(from.rows[7]).toEqual(["XIRR", pct2(w.from.xirrPct)]);
    expect(to.rows[0]).toEqual(["Transfers", String(w.transfers)]);
    expect(to.rows[4]).toEqual([`Value on ${dateText(w.to.currentValueDate)}`, inr(w.to.currentValue)]);
    expect(transfers.rows).toHaveLength(w.rows.length);
    expect(transfers.rows[0][3]).toBe(inr(w.rows[0].amount));
  });

  it("frstp says when the transfer-from scheme ran out", () => {
    const b = run(DEFS.frstp, { fromScheme: PICK_B, toScheme: PICK_A, initial: 100000, stpAmount: 25000, investDate: "2017-01-02", stpStart: "2017-01-02", stpEnd: "2019-01-02" }, CTX);
    expect(insights(b)[0].text).toContain(" The transfer-from scheme ran out before the STP end; the last transfer took what was left.");
  });

  it("frstpprofit moves only the gain, and has no STP amount field", () => {
    expect(DEFS.frstpprofit.inputs.some((i) => i.key === "stpAmount")).toBe(false);
    const inp = cases[2];
    const w = webStp.stpReturn(A, C, inp);
    if (!w.ok) throw new Error(w.error);
    const b = run(DEFS.frstpprofit, { fromScheme: PICK_A, toScheme: PICK_C, investDate: inp.investDate, frequency: "quarterly", stpStart: inp.stpStart, stpEnd: inp.stpEnd }, CTX);
    expect(statOf(b, "Invested")).toBe("₹10,00,000");
    expect(statOf(b, "Moved by STP")).toBe(inr(w.transferred));
    expect(statOf(b, "Total XIRR")).toBe(pct2(w.total.xirrPct));
    const disclaimer = texts(b, "note").find((n) => DISCLAIMER.test(n))!;
    expect(disclaimer.endsWith(" Each period moves only the value above the initial investment on that date.")).toBe(true);
  });

  it("asks for both schemes, and shows the maths' refusals", () => {
    expect(insights(run(DEFS.frstp, { fromScheme: PICK_A }, CTX))[0].text).toBe("Pick the scheme to transfer from and the one to transfer to.");
    const bad = run(DEFS.frstp, { fromScheme: PICK_B, toScheme: PICK_A, investDate: "2014-01-01", stpStart: "2014-01-01", stpEnd: "2016-01-01" }, CTX);
    expect(insights(bad)[0]).toEqual({ type: "insight", text: "The transfer-from scheme launched on 15-03-2016 — after the investment date.", tone: "danger" });
    expect(DEFS.frstp.navSchemes!({ fromScheme: PICK_B, toScheme: PICK_A })).toEqual([PICK_B.code, PICK_A.code]);
  });
});

/* ───────────── frswp ───────────── */

describe("frswp — SWP Return of a Scheme", () => {
  const today = todayIso();
  const cases: appSwp.SwpReturnInput[] = [
    { amount: 1000000, investDate: "2015-01-01", withdrawal: 8000, frequency: "monthly", swpDay: 10, swpStart: "2016-01-01", swpEnd: "2024-06-28", valueOn: today },
    { amount: 500000, investDate: "2016-06-01", withdrawal: 15000, frequency: "monthly", swpDay: 1, swpStart: "2016-07-01", swpEnd: "2024-06-28", valueOn: today },
    { amount: 750000, investDate: "2014-02-03", withdrawal: 4000, frequency: "weekly", swpDay: 10, swpStart: "2014-03-01", swpEnd: "2020-03-31", valueOn: today },
  ];
  it.each(cases)("swpReturn equals the web module (%#)", (inp) => {
    for (const s of [A, B, C]) expect(appSwp.swpReturn(s, inp)).toEqual(webSwp.swpReturn(s, inp));
  });

  it("prints the web's figures", () => {
    const inp = cases[0];
    const w = webSwp.swpReturn(A, inp);
    if (!w.ok) throw new Error(w.error);
    const b = run(DEFS.frswp, { scheme: PICK_A, investDate: inp.investDate, swpStart: inp.swpStart, swpEnd: inp.swpEnd }, CTX);
    expect(statOf(b, "Invested")).toBe("₹10,00,000");
    expect(statOf(b, `Withdrawn (${w.withdrawals})`)).toBe(inr(w.totalWithdrawn));
    expect(statOf(b, `Value left on ${dateText(w.valueDate)}`)).toBe(inr(w.remainingValue));
    expect(statOf(b, "XIRR")).toBe(pct2(w.xirrPct));
    expect(statOf(b, "Units bought")).toBe(en(w.initialUnits, 3));
    expect(statOf(b, "Units left")).toBe(en(w.unitsLeft, 3));
    expect(statOf(b, "Capital gain withdrawn")).toBe(inr(w.totalCapitalGain));
    expect(statOf(b, "Profit")).toBe(inr(w.profit));
    expect(insights(b)[0]).toEqual({
      type: "insight", tone: "brand",
      text: `${inr(1000000)} in ${PICK_A.name} paid out ${inr(w.totalWithdrawn)} over ${w.withdrawals} withdrawals and still held ${inr(w.remainingValue)} on ${dateText(w.valueDate)}. XIRR ${pct2(w.xirrPct)}.`,
    });
    const t = tables(b)[0];
    expect(t.rows).toHaveLength(w.rows.length);
    expect(t.rows[0][6]).toBe(inr(w.rows[0].capitalGain));
    expect(t.rows[0][7]).toBe(String(w.rows[0].daysInvested));
    expect(texts(b, "note").find((n) => DISCLAIMER.test(n))!.endsWith("oldest units first; tax is not worked out.")).toBe(true);
  });

  it("an SWP that runs out is amber and says when", () => {
    const inp = cases[1];
    const w = webSwp.swpReturn(C, inp);
    if (!w.ok) throw new Error(w.error);
    expect(w.exhausted).toBe(true);
    const b = run(DEFS.frswp, { scheme: PICK_C, amount: inp.amount, withdrawal: inp.withdrawal, swpDay: "1", investDate: inp.investDate, swpStart: inp.swpStart, swpEnd: inp.swpEnd }, CTX);
    const ins = insights(b)[0];
    expect(ins.tone).toBe("warning");
    expect(ins.text).toContain(` and ran out on ${dateText(w.rows[w.rows.length - 1].date)} — the last withdrawal took what was left. XIRR `);
    expect(statOf(b, "Profit")).toBe(inr(w.profit));
  });
});

/* ───────────── frrolling ───────────── */

describe("frrolling — Rolling Returns", () => {
  it.each([1, 3, 5, 10])("rollingReturns equals the web module (%i years)", (years) => {
    for (const s of [A, B, C]) expect(appRoll.rollingReturns(s, { startDate: "2013-01-01", years })).toEqual(webRoll.rollingReturns(s, { startDate: "2013-01-01", years }));
  });

  it("prints the statistics and bands tables, with the web's refusal in place", () => {
    const b = run(DEFS.frrolling, { scheme1: PICK_A, scheme2: PICK_B, start: "2013-01-01", years: "10" }, CTX);
    const wa = webRoll.rollingReturns(A, { startDate: "2013-01-01", years: 10 });
    const wb = webRoll.rollingReturns(B, { startDate: "2013-01-01", years: 10 });
    if (!wa.ok) throw new Error(wa.error);
    if (wb.ok) throw new Error("B should have no 10-year window");
    expect(texts(b, "section")).toEqual(["1. 10-year rolling return statistics (% a year)", "2. How often each return band occurred (% of windows)"]);
    const [stats, bands] = tables(b);
    expect(stats.rows[0]).toEqual([
      PICK_A.name, en(wa.count, 0), pct2(wa.averagePct), pct2(wa.medianPct),
      `${pct2(wa.max.returnPct)} (from ${dateText(wa.max.start)})`, `${pct2(wa.min.returnPct)} (from ${dateText(wa.min.start)})`, `${wa.negativePct.toFixed(1)}%`,
    ]);
    expect(stats.rows[1]).toEqual([PICK_B.name, wb.error, "", "", "", "", ""]);
    expect(bands.head).toEqual(["Scheme", "Below 0%", "0–8%", "8–10%", "10–12%", "12–15%", "15–20%", "20% and above"]);
    expect(bands.rows).toEqual([[PICK_A.name, ...wa.bands.map((x) => `${x.pct.toFixed(1)}%`)]]);
    expect(texts(b, "note").find((n) => DISCLAIMER.test(n))!.endsWith(" A window starts on every NAV date and ends 10 calendar years later; its return is annualised.")).toBe(true);
  });

  it("offers the web's windows", () => {
    expect(DEFS.frrolling.inputs.find((i) => i.key === "years")!.options!.map((o) => o.label)).toEqual(["1 year", "2 years", "3 years", "5 years", "7 years", "10 years"]);
  });
});

/* ───────────── frp2p ───────────── */

describe("frp2p — Point-to-Point Comparison", () => {
  const cases = [
    { amount: 100000, startDate: "2021-06-28", endDate: "2024-06-28", riskFreePct: 6.5 },
    { amount: 50000, startDate: "2016-04-01", endDate: "2016-10-01", riskFreePct: 7 },
    { amount: 100000, startDate: "2013-07-01", endDate: "2023-06-30", riskFreePct: 0 },
  ];
  it.each(cases)("pointToPoint equals the web module (%#)", (inp) => {
    for (const s of [A, B, C]) expect(appCmp.pointToPoint(s, inp)).toEqual(webCmp.pointToPoint(s, inp));
  });

  it("prints the comparison row", () => {
    const inp = cases[0];
    const w = webCmp.pointToPoint(A, inp);
    if (!w.ok) throw new Error(w.error);
    const b = run(DEFS.frp2p, { scheme1: PICK_A, scheme2: PICK_C, start: inp.startDate, end: inp.endDate }, CTX);
    const t = tables(b)[0];
    expect(t.head).toEqual(["Scheme", "Period", "Growth value", "Absolute", "CAGR", "Mean", "Std deviation", "Sharpe"]);
    expect(t.rows[0]).toEqual([
      PICK_A.name, `${dateText(w.startDate)} – ${dateText(w.endDate)}`, inr(w.growthValue), pct2(w.absolutePct),
      pct2(w.cagrPct), pct2(w.meanPct), pct2(w.stdDevPct), w.sharpe!.toFixed(2),
    ]);
    expect(t.rows).toHaveLength(2);
    expect(texts(b, "note").find((n) => DISCLAIMER.test(n))!).toContain("Alpha and beta are not shown");
  });
});

/* ───────────── frcalendar ───────────── */

describe("frcalendar — Calendar-Year Returns", () => {
  it("periodReturns (year) equals the web module", () => {
    for (const s of [A, B, C]) expect(appPer.periodReturns(s, "year")).toEqual(webPer.periodReturns(s, "year"));
  });

  it("prints the last ten years, newest first, with partial-period markers", () => {
    const b = run(DEFS.frcalendar, { scheme1: PICK_A, scheme2: PICK_B }, CTX);
    const wa = webPer.periodReturns(A, "year");
    const t = tables(b)[0];
    expect(t.head).toEqual(["Scheme", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "2017", "2016", "2015"]);
    const y2024 = wa.find((r) => r.year === 2024)!;
    expect(y2024.partial).toBe("to_date");
    expect(t.rows[0][1]).toBe(`${pct2(y2024.returnPct)} ²`);
    expect(t.rows[1][9]).toMatch(/ ¹$/); // B launched in 2016
    expect(t.rows[1][10]).toBe("—"); // …and has no 2015
    const all = run(DEFS.frcalendar, { scheme1: PICK_A, show: "all" }, CTX);
    expect(tables(all)[0].head).toHaveLength(1 + wa.length);
    expect(tables(all)[0].rows[0][wa.length]).toBe(`${pct2(wa[0].returnPct)} ¹`); // 2012, the launch year
  });
});

/* ───────────── frmonthly ───────────── */

describe("frmonthly — Monthly & Quarterly Returns", () => {
  it.each(["month", "quarter"] as const)("returnGrid (%s) equals the web module", (kind) => {
    for (const s of [A, B, C]) expect(appPer.returnGrid(s, kind)).toEqual(webPer.returnGrid(s, kind));
  });

  it("prints a row a year, newest first, months then the year", () => {
    const g = webPer.returnGrid(B, "month");
    const b = run(DEFS.frmonthly, { scheme: PICK_B }, CTX);
    const t = tables(b)[0];
    expect(t.head).toEqual(["Year", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Year"]);
    expect(t.rows).toHaveLength(g.rows.length);
    expect(t.rows[0][0]).toBe("2024");
    expect(t.rows[0][7]).toBe("—"); // Jul 2024: no NAV of its own
    const may2023 = g.rows.find((r) => r.year === 2023)!.cells[4]!;
    expect(t.rows[1][5]).toBe(pct2(may2023.returnPct));
    expect(texts(b, "section")).toEqual(["1. Return in each month"]);
    const q = run(DEFS.frmonthly, { scheme: PICK_B, kind: "quarter" }, CTX);
    expect(tables(q)[0].head).toEqual(["Year", "Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec", "Year"]);
    expect(texts(q, "section")).toEqual(["1. Return in each quarter"]);
    expect(texts(q, "note").find((n) => DISCLAIMER.test(n))!).toContain("a quarter with no NAV of its own shows —.");
  });
});
