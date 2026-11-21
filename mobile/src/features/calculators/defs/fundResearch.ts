/**
 * Fund Research — mirrors the web group of the same name: the tools that run
 * on a scheme's REAL NAV history (src/components/calculators/Fund*.tsx, shared
 * pieces in fund-research-ui.tsx). The maths is the web's src/lib/fund-research,
 * copied verbatim into ./web/fund-research — this file only maps inputs onto it
 * and lays the answer out. Labels, figures and the order of results follow the
 * web component named on each def.
 *
 * Live data: each def names the scheme codes it needs (`navSchemes`); the
 * screen loads their histories from GET /api/mf/schemes/:code/nav (the
 * endpoint the web tools use) and passes them as `ctx.nav`. A scheme whose
 * history failed to load is skipped here — the screen shows its error.
 *
 * Phone layout, where the web's differs:
 *   • the web's "+ Add a scheme" list (1–5) is five scheme slots, each shown
 *     once the one before it is picked;
 *   • the line the web prints under each picker once its history has loaded
 *     ("3,210 NAVs, 2 Jan 2013 to 20 Nov 2026") is a note at the top of the
 *     result, named by scheme (the app's picker cannot carry it; the web's
 *     " · category" suffix is not in ctx.nav, so it is left off);
 *   • a scheme whose own maths refuses (launched after the start date …) keeps
 *     its row in the comparison table as on the web, and its full message is
 *     repeated under the table — a phone's table cell is too narrow to read it;
 *   • charts are not drawn (SIP Return's section 1 is a chart only, so its
 *     table keeps the web's number, 2).
 * The past-performance note (fund-research-ui.tsx ResearchNote) is kept word
 * for word on every tool: it is the compliance disclaimer.
 */

import type { CalcBody, CalcContext, InputSpec, ResultBlock, SchemePick } from "../types";
import { inr, count, groupIndian } from "../fmt";
import { FREQUENCY_LABEL, type Frequency, type NavSeries } from "../web/fund-research/nav";
import { sipReturn } from "../web/fund-research/sip";
import { lumpsumReturn } from "../web/fund-research/lumpsum";
import { stpReturn, type StpLeg, type StpMode } from "../web/fund-research/stp";
import { swpReturn } from "../web/fund-research/swp";
import { ROLLING_BANDS, ROLLING_WINDOWS, rollingReturns } from "../web/fund-research/rolling";
import { pointToPoint } from "../web/fund-research/compare";
import { type PeriodReturn, periodReturns, returnGrid } from "../web/fund-research/periodic";
import { TONE, stat, section, table, insight, note, opts } from "./shared";

/* ───────────────────────── shared pieces (fund-research-ui.tsx) ───────────────────────── */

/** The web's clampNum (NumberField): a non-negative finite number, 0 on garbage. */
const nn = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** An ISO date input's value ("" when blank). */
const str = (x: unknown): string => (typeof x === "string" ? x : "");

/** A `scheme` input's value, or null. */
const pickOf = (x: unknown): SchemePick => {
  const p = x as { code?: unknown; name?: unknown } | null | undefined;
  return p && typeof p === "object" && typeof p.code === "string" && p.code
    ? { code: p.code, name: typeof p.name === "string" && p.name ? p.name : p.code }
    : null;
};

/**
 * fund-research-ui.tsx todayIso — today in India as yyyy-mm-dd. Worked out by
 * hand (India is UTC+5:30 all year) because Hermes' Intl time-zone support
 * differs by platform.
 */
export function todayIso(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

/** fund-research-ui.tsx yearsBefore, verbatim — ISO date `years` before `iso` (default start dates). */
export function yearsBefore(iso: string, years: number): string {
  const y = Number(iso.slice(0, 4)) - years;
  return `${y}${iso.slice(4)}`.replace(/-02-29$/, "-02-28");
}

const TODAY = todayIso();

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** fund-research-ui.tsx dateText = @/lib/format formatDate on a bare ISO date: "7 Sep 2026". */
export function dateText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTH_SHORT[Number(m[2]) - 1]} ${m[1]}` : "—";
}

/**
 * n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }),
 * by hand (Hermes' Intl differs by platform). Like ICU it rounds the number's
 * SHORTEST decimal form half away from zero — 123456.12345 → "1,23,456.1235",
 * where toFixed, working on the binary value, gives …1234.
 */
function fixedIndian(n: number, d: number): string {
  if (!Number.isFinite(n)) return "—";
  const x = Math.abs(n);
  const s = String(x);
  let int: string;
  let frac: string;
  if (/e/i.test(s)) {
    [int, frac = ""] = x.toFixed(d).split(".");
  } else {
    const [i, f = ""] = s.split(".");
    if (f.length <= d) {
      int = i;
      frac = f.padEnd(d, "0");
    } else {
      // Round the digit string i + f[0..d) up by one unit in the last place when the next digit is 5 or more.
      const digits = (i + f.slice(0, d)).split("").map(Number);
      if (Number(f[d]) >= 5) {
        let k = digits.length - 1;
        while (k >= 0 && digits[k] === 9) { digits[k] = 0; k--; }
        if (k >= 0) digits[k] += 1; else digits.unshift(1);
      }
      const all = digits.join("");
      int = all.slice(0, all.length - d) || "0";
      frac = all.slice(all.length - d);
    }
  }
  return `${n < 0 || Object.is(n, -0) ? "-" : ""}${groupIndian(int)}${d > 0 ? `.${frac}` : ""}`;
}

/** fund-research-ui.tsx pctText. */
export function pctText(n: number | null | undefined, digits = 2): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n.toFixed(digits)}%`;
}

/** fund-research-ui.tsx navText: 1,234.5678. */
export const navText = (n: number): string => fixedIndian(n, 4);

/** fund-research-ui.tsx unitsText: 1,234.567. */
export const unitsText = (n: number): string => fixedIndian(n, 3);

/** fund-research-ui.tsx PickFirst's default sentence. */
const PICK_FIRST = "Pick a scheme to see its returns.";

type Loaded = { name: string; series: NavSeries };

/** fund-research-ui.tsx NavStatusLine (ready) for each loaded scheme, named, since it sits in the result here. */
function statusNotes(loaded: Loaded[]): ResultBlock[] {
  return loaded.flatMap(({ name, series }) => {
    const n = series.dates.length;
    return n ? [note(`${name}: ${count(n)} NAVs, ${dateText(series.dates[0])} to ${dateText(series.dates[n - 1])}`)] : [];
  });
}

/** A picked scheme with its loaded history, or nothing. */
const loadedOf = (p: SchemePick, ctx: CalcContext): Loaded[] => {
  const series = p ? ctx.nav[p.code] : undefined;
  return p && series ? [{ name: p.name, series }] : [];
};

/** fund-research-ui.tsx ResearchNote — the past-performance disclaimer and the NAV dates each scheme used. */
function researchNote(ranges: Array<{ name: string; from: string; to: string }>, extra?: string): ResultBlock[] {
  return [
    note(
      "Past performance may or may not be sustained in future and is not a guarantee of future returns. Figures use "
      + "the schemes' published NAVs (AMFI, via mfapi.in), before stamp duty, exit loads and taxes; a transaction on a "
      + "day with no NAV is taken at the next available NAV, and a value “as on” a date uses the latest NAV on or before "
      + `it. Mutual fund investments are subject to market risks.${extra ? ` ${extra}` : ""}`,
    ),
    ...ranges.map((r) => note(`NAVs used — ${r.name}: ${dateText(r.from)} to ${dateText(r.to)}`)),
  ];
}

/** fund-research-ui.tsx FundList: up to five schemes. Slot n shows once slot n − 1 is picked. */
const MAX_FUNDS = 5;
const schemeSlots = (): InputSpec[] =>
  Array.from({ length: MAX_FUNDS }, (_, i): InputSpec => ({
    key: `scheme${i + 1}`,
    label: `Scheme ${i + 1}`,
    type: "scheme", source: "universe",
    default: null,
    ...(i > 0 ? { visibleIf: (v: Record<string, any>) => !!pickOf(v[`scheme${i}`]) || !!pickOf(v[`scheme${i + 1}`]) } : {}),
  }));

const slotPicks = (v: Record<string, any>): SchemePick[] =>
  Array.from({ length: MAX_FUNDS }, (_, i) => pickOf(v[`scheme${i + 1}`]));

const slotCodes = (v: Record<string, any>): string[] => slotPicks(v).flatMap((p) => (p ? [p.code] : []));

/** The picked slots whose history loaded, in slot order (the web's "ready" states). */
const readySlots = (v: Record<string, any>, ctx: CalcContext): Loaded[] => slotPicks(v).flatMap((p) => loadedOf(p, ctx));

const singleCode = (key: string) => (v: Record<string, any>): string[] => {
  const p = pickOf(v[key]);
  return p ? [p.code] : [];
};

/** fund-research-ui.tsx FrequencyField options. */
const freqOptions = (fs: Frequency[]) => fs.map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }));
const freqOf = (x: unknown, allowed: Frequency[]): Frequency => (allowed.includes(x as Frequency) ? (x as Frequency) : "monthly");

/** fund-research-ui.tsx DayField: day 1–28 of the month. */
const DAY_OPTIONS = Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
const dayOf = (x: unknown, fallback: number): number => {
  const d = Math.round(Number(x));
  return Number.isFinite(d) && d >= 1 ? Math.min(d, 28) : fallback;
};

/** A comparison table's failed rows, repeated in full (a phone cell cuts the web's message). */
const failures = (rows: Array<{ name: string; error: string | null }>): ResultBlock[] =>
  rows.flatMap((r) => (r.error ? [insight(`${r.name}: ${r.error}`, "danger")] : []));

/* ───────────────────────── frsip ───────────────────────── */

const SIP_FREQS: Frequency[] = ["weekly", "monthly", "quarterly"];

/** FundSipReturn.tsx — SIP Return of a Scheme (sipReturn). The "Invested vs
 *  value" chart (web section 1) is not drawn. */
const frsip: CalcBody = {
  inputs: [
    { key: "scheme", label: "Scheme", type: "scheme", source: "universe", default: null },
    { key: "amount", label: "Instalment (₹)", type: "money", default: 10000 },
    { key: "frequency", label: "Frequency", type: "segmented", default: "monthly", options: freqOptions(SIP_FREQS) },
    { key: "sipDay", label: "SIP day", type: "select", default: "5", options: DAY_OPTIONS, visibleIf: (v) => v.frequency !== "weekly" },
    { key: "start", label: "Start date", type: "date", maxToday: true, default: yearsBefore(TODAY, 5) },
    { key: "end", label: "End date", type: "date", maxToday: true, default: TODAY },
    { key: "stepUp", label: "Yearly top-up (%)", type: "percent", default: 0 },
  ],
  navSchemes: singleCode("scheme"),
  compute: (v, ctx) => {
    const fund = pickOf(v.scheme);
    if (!fund) return [insight(PICK_FIRST, "neutral")];
    const s = ctx.nav[fund.code];
    if (!s) return [];
    const out = statusNotes([{ name: fund.name, series: s }]);
    const res = sipReturn(s, {
      amount: nn(v.amount), frequency: freqOf(v.frequency, SIP_FREQS), sipDay: dayOf(v.sipDay, 5),
      startDate: str(v.start), endDate: str(v.end), stepUpPct: nn(v.stepUp),
    });
    if (!res.ok) return [...out, insight(res.error, "danger")];
    out.push(
      stat("Invested", inr(res.invested)),
      stat(`Value on ${dateText(res.valueDate)}`, inr(res.currentValue), TONE.cyan),
      stat("Profit", inr(res.profit), res.profit >= 0 ? TONE.emerald : TONE.rose),
      stat("XIRR", pctText(res.xirrPct), TONE.emerald),
      stat("Instalments", `${res.instalments}`),
      stat("Units held", unitsText(res.units)),
      stat(`NAV on ${dateText(res.valueDate)}`, navText(res.valueNav)),
      stat("Absolute return", pctText(res.absolutePct)),
      insight(
        `${res.instalments} instalments totalling ${inr(res.invested)} in ${fund.name} were worth ${inr(res.currentValue)} on `
        + `${dateText(res.valueDate)} — an XIRR of ${pctText(res.xirrPct)}.`
        + (res.skippedBeforeLaunch > 0 ? ` ${res.skippedBeforeLaunch} instalment(s) dated before the scheme's launch are left out.` : ""),
        TONE.cyan,
      ),
      section("2. Cash flow"),
      table(
        ["NAV date", "NAV", "Amount", "Units", "Cumulative units", "Value"],
        res.rows.map((r) => [dateText(r.date), navText(r.nav), inr(r.amount), unitsText(r.units), unitsText(r.cumulativeUnits), inr(r.value)]),
      ),
      ...researchNote([{ name: fund.name, from: res.rows[0].date, to: res.valueDate }]),
    );
    return out;
  },
};

/* ───────────────────────── frlumpsum ───────────────────────── */

/** FundLumpsumReturn.tsx — Lumpsum Return of Schemes (lumpsumReturn, once per scheme). */
const frlumpsum: CalcBody = {
  inputs: [
    ...schemeSlots(),
    { key: "amount", label: "Amount (₹)", type: "money", default: 100000 },
    { key: "start", label: "Invested on", type: "date", maxToday: true, default: yearsBefore(TODAY, 5) },
    { key: "end", label: "Value as on", type: "date", maxToday: true, default: TODAY },
  ],
  navSchemes: slotCodes,
  compute: (v, ctx) => {
    const amount = nn(v.amount);
    const loaded = readySlots(v, ctx);
    const out = statusNotes(loaded);
    if (loaded.length === 0) return [...out, insight("Pick up to five schemes to compare a lumpsum.", "neutral")];
    const ready = loaded.map((r) => ({ name: r.name, res: lumpsumReturn(r.series, { amount, startDate: str(v.start), endDate: str(v.end) }) }));
    const done = ready.flatMap((r) => (r.res.ok ? [{ name: r.name, res: r.res }] : []));
    const best = done.length > 1 ? done.reduce((a, b) => (b.res.value > a.res.value ? b : a)) : null;
    out.push(
      section("1. Returns"),
      table(
        ["Scheme", "Bought on", "NAV", "Units", "Valued on", "Value", "Profit", "CAGR", "Absolute"],
        ready.map((r) => r.res.ok
          ? [r.name, dateText(r.res.buyDate), navText(r.res.buyNav), unitsText(r.res.units), dateText(r.res.valueDate),
            inr(r.res.value), inr(r.res.profit), r.res.cagrPct === null ? "Under 1 yr" : pctText(r.res.cagrPct), pctText(r.res.absolutePct)]
          : [r.name, r.res.error, "", "", "", "", "", "", ""]),
      ),
      ...failures(ready.map((r) => ({ name: r.name, error: r.res.ok ? null : r.res.error }))),
    );
    if (best) {
      out.push(insight(`${inr(amount)} grew most in ${best.name}: ${inr(best.res.value)} by ${dateText(best.res.valueDate)}.`, TONE.cyan));
    }
    if (done.length > 0) out.push(...researchNote(done.map((d) => ({ name: d.name, from: d.res.buyDate, to: d.res.valueDate }))));
    return out;
  },
};

/* ───────────────────────── frstp / frstpprofit ───────────────────────── */

const STP_FREQS: Frequency[] = ["weekly", "fortnightly", "monthly", "quarterly"];

/** FundStpReturn.tsx legRows. */
function legRows(leg: StpLeg, unitsLabel: string): string[][] {
  return [
    [unitsLabel, unitsText(leg.units)],
    [`Value on ${dateText(leg.valueAtEndDate)} (STP end)`, inr(leg.valueAtEnd)],
    [`Value on ${dateText(leg.currentValueDate)}`, inr(leg.currentValue)],
    ["Profit", inr(leg.profit)],
    ["Absolute return", pctText(leg.absolutePct)],
    ["XIRR", pctText(leg.xirrPct)],
  ];
}

/** FundStpReturn.tsx StpTool — both STP cards (stpReturn), valued today as on
 *  the web. The web's "From: …" / "To: …" caption above each leg's table heads
 *  that table's first column here. */
function stpTool(mode: StpMode): CalcBody {
  const fixed = mode === "fixed";
  const STP_AMOUNT_DEFAULT = 20000;
  return {
    inputs: [
      { key: "fromScheme", label: "Transfer from", type: "scheme", source: "universe", default: null },
      { key: "toScheme", label: "Transfer to", type: "scheme", source: "universe", default: null },
      { key: "initial", label: "Initial investment (₹)", type: "money", default: fixed ? 500000 : 1000000 },
      { key: "investDate", label: "Invested on", type: "date", maxToday: true, default: yearsBefore(TODAY, 5) },
      ...(fixed ? [{ key: "stpAmount", label: "STP amount (₹)", type: "money", default: STP_AMOUNT_DEFAULT } as InputSpec] : []),
      { key: "frequency", label: "Frequency", type: "select", default: "monthly", options: freqOptions(STP_FREQS) },
      { key: "stpDay", label: "STP day", type: "select", default: "10", options: DAY_OPTIONS, visibleIf: (v) => v.frequency === "monthly" || v.frequency === "quarterly" },
      { key: "stpStart", label: "STP start", type: "date", maxToday: true, default: yearsBefore(TODAY, 5) },
      { key: "stpEnd", label: "STP end", type: "date", maxToday: true, default: yearsBefore(TODAY, fixed ? 3 : 0) },
    ],
    navSchemes: (v) => [pickOf(v.fromScheme), pickOf(v.toScheme)].flatMap((p) => (p ? [p.code] : [])),
    compute: (v, ctx) => {
      const fromFund = pickOf(v.fromScheme);
      const toFund = pickOf(v.toScheme);
      const out = statusNotes([...loadedOf(fromFund, ctx), ...loadedOf(toFund, ctx)]);
      if (!fromFund || !toFund) return [...out, insight("Pick the scheme to transfer from and the one to transfer to.", "neutral")];
      const fromS = ctx.nav[fromFund.code];
      const toS = ctx.nav[toFund.code];
      if (!fromS || !toS) return out;
      const res = stpReturn(fromS, toS, {
        initialAmount: nn(v.initial), investDate: str(v.investDate), mode,
        // The profit-transfer card has no STP amount field; the web passes its untouched default, which the maths ignores.
        stpAmount: fixed ? nn(v.stpAmount) : STP_AMOUNT_DEFAULT,
        frequency: freqOf(v.frequency, STP_FREQS), stpDay: dayOf(v.stpDay, 10),
        stpStart: str(v.stpStart), stpEnd: str(v.stpEnd), valueOn: todayIso(),
      });
      if (!res.ok) return [...out, insight(res.error, "danger")];
      const fromName = fromFund.name;
      const toName = toFund.name;
      out.push(
        stat("Invested", inr(res.total.invested)),
        stat("Moved by STP", inr(res.transferred)),
        stat(`Total value on ${dateText(res.from.currentValueDate)}`, inr(res.total.currentValue), TONE.cyan),
        stat("Total XIRR", pctText(res.total.xirrPct), TONE.emerald),
        insight(
          `${res.transfers} transfer${res.transfers === 1 ? "" : "s"} moved ${inr(res.transferred)} from ${fromName} to ${toName}. `
          + `The ${inr(res.total.invested)} invested is now worth ${inr(res.total.currentValue)}, a profit of ${inr(res.total.profit)} `
          + `(${pctText(res.total.absolutePct)}).`
          + (res.exhausted ? " The transfer-from scheme ran out before the STP end; the last transfer took what was left." : "")
          + (mode === "appreciation" && res.periodsWithoutTransfer > 0
            ? ` ${res.periodsWithoutTransfer} period(s) had no gain above the initial investment, so nothing moved.`
            : ""),
          TONE.cyan,
        ),
        section("1. Each leg"),
        table(
          [`From: ${fromName}`, "Amount"],
          [["Initial investment", inr(res.total.invested)], ["Moved out", inr(res.transferred)], ...legRows(res.from, "Units remaining")],
        ),
        table(
          [`To: ${toName}`, "Amount"],
          [["Transfers", `${res.transfers}`], ["Moved in", inr(res.transferred)], ...legRows(res.to, "Units accumulated")],
        ),
      );
      if (res.rows.length > 0) {
        out.push(
          section("2. Transfers"),
          table(
            ["Date", "From NAV", "Units out", "Amount", "From units left", "To NAV", "Units in", "To units", "To value"],
            res.rows.map((r) => [
              dateText(r.date), navText(r.fromNav), unitsText(r.unitsOut), inr(r.amount), unitsText(r.fromUnitsLeft),
              navText(r.toNav), unitsText(r.unitsIn), unitsText(r.toUnits), inr(r.toValue),
            ]),
          ),
        );
      }
      out.push(...researchNote(
        [
          { name: fromName, from: res.buyDate, to: res.from.currentValueDate },
          ...(res.rows.length ? [{ name: toName, from: res.rows[0].toDate, to: res.to.currentValueDate }] : []),
        ],
        mode === "appreciation" ? "Each period moves only the value above the initial investment on that date." : undefined,
      ));
      return out;
    },
  };
}

/** FundStpReturn.tsx FundStpReturn — a fixed amount each time. */
const frstp = stpTool("fixed");
/** FundStpReturn.tsx FundStpProfitTransfer — only the value above the initial investment. */
const frstpprofit = stpTool("appreciation");

/* ───────────────────────── frswp ───────────────────────── */

const SWP_FREQS: Frequency[] = ["weekly", "fortnightly", "monthly", "quarterly"];

/** FundSwpReturn.tsx — SWP Return of a Scheme (swpReturn), valued today as on the web. */
const frswp: CalcBody = {
  inputs: [
    { key: "scheme", label: "Scheme", type: "scheme", source: "universe", default: null },
    { key: "amount", label: "Lumpsum (₹)", type: "money", default: 1000000 },
    { key: "investDate", label: "Invested on", type: "date", maxToday: true, default: yearsBefore(TODAY, 5) },
    { key: "withdrawal", label: "Withdrawal (₹)", type: "money", default: 8000 },
    { key: "frequency", label: "Frequency", type: "select", default: "monthly", options: freqOptions(SWP_FREQS) },
    { key: "swpDay", label: "SWP day", type: "select", default: "10", options: DAY_OPTIONS, visibleIf: (v) => v.frequency === "monthly" || v.frequency === "quarterly" },
    { key: "swpStart", label: "SWP start", type: "date", maxToday: true, default: yearsBefore(TODAY, 4) },
    { key: "swpEnd", label: "SWP end", type: "date", maxToday: true, default: TODAY },
  ],
  navSchemes: singleCode("scheme"),
  compute: (v, ctx) => {
    const fund = pickOf(v.scheme);
    if (!fund) return [insight(PICK_FIRST, "neutral")];
    const s = ctx.nav[fund.code];
    if (!s) return [];
    const out = statusNotes([{ name: fund.name, series: s }]);
    const amount = nn(v.amount);
    const res = swpReturn(s, {
      amount, investDate: str(v.investDate), withdrawal: nn(v.withdrawal), frequency: freqOf(v.frequency, SWP_FREQS),
      swpDay: dayOf(v.swpDay, 10), swpStart: str(v.swpStart), swpEnd: str(v.swpEnd), valueOn: todayIso(),
    });
    if (!res.ok) return [...out, insight(res.error, "danger")];
    out.push(
      stat("Invested", inr(amount)),
      stat(`Withdrawn (${res.withdrawals})`, inr(res.totalWithdrawn)),
      stat(`Value left on ${dateText(res.valueDate)}`, inr(res.remainingValue), TONE.cyan),
      stat("XIRR", pctText(res.xirrPct), TONE.emerald),
      stat("Units bought", unitsText(res.initialUnits)),
      stat("Units left", unitsText(res.unitsLeft)),
      stat("Capital gain withdrawn", inr(res.totalCapitalGain)),
      stat("Profit", inr(res.profit), res.profit >= 0 ? TONE.emerald : TONE.rose),
      insight(
        `${inr(amount)} in ${fund.name} paid out ${inr(res.totalWithdrawn)} over ${res.withdrawals} withdrawals`
        + (res.exhausted
          ? ` and ran out on ${dateText(res.rows[res.rows.length - 1].date)} — the last withdrawal took what was left.`
          : ` and still held ${inr(res.remainingValue)} on ${dateText(res.valueDate)}.`)
        + ` XIRR ${pctText(res.xirrPct)}.`,
        res.exhausted ? TONE.amber : TONE.cyan,
      ),
    );
    if (res.rows.length > 0) {
      out.push(
        section("1. Withdrawals"),
        table(
          ["NAV date", "NAV", "Withdrawal", "Units out", "Units left", "Cost (FIFO)", "Gain / loss", "Days invested", "Value left"],
          res.rows.map((r) => [
            dateText(r.date), navText(r.nav), inr(r.amount), unitsText(r.unitsRedeemed), unitsText(r.unitsLeft),
            inr(r.cost), inr(r.capitalGain), `${r.daysInvested}`, inr(r.value),
          ]),
        ),
      );
    }
    out.push(...researchNote(
      [{ name: fund.name, from: res.buyDate, to: res.valueDate }],
      "Gain or loss is each withdrawal less the purchase cost of the units sold, oldest units first; tax is not worked out.",
    ));
    return out;
  },
};

/* ───────────────────────── frrolling ───────────────────────── */

/** FundRollingReturns.tsx — Rolling Returns (rollingReturns, once per scheme). */
const frrolling: CalcBody = {
  inputs: [
    ...schemeSlots(),
    { key: "start", label: "Windows starting from", type: "date", maxToday: true, default: yearsBefore(TODAY, 10) },
    {
      key: "years", label: "Rolling period", type: "select", default: "3",
      options: ROLLING_WINDOWS.map((y) => ({ value: String(y), label: `${y} year${y === 1 ? "" : "s"}` })),
    },
  ],
  navSchemes: slotCodes,
  compute: (v, ctx) => {
    const y = Number(v.years);
    const years: number = (ROLLING_WINDOWS as readonly number[]).includes(y) ? y : 3;
    const loaded = readySlots(v, ctx);
    const out = statusNotes(loaded);
    if (loaded.length === 0) return [...out, insight("Pick up to five schemes to see their rolling returns.", "neutral")];
    const rows = loaded.map((r) => ({ name: r.name, res: rollingReturns(r.series, { startDate: str(v.start), years }) }));
    const done = rows.flatMap((r) => (r.res.ok ? [{ name: r.name, res: r.res }] : []));
    out.push(
      section(`1. ${years}-year rolling return statistics (% a year)`),
      table(
        ["Scheme", "Windows", "Average", "Median", "Best", "Worst", "Negative"],
        rows.map((r) => r.res.ok
          ? [r.name, count(r.res.count), pctText(r.res.averagePct), pctText(r.res.medianPct),
            `${pctText(r.res.max.returnPct)} (from ${dateText(r.res.max.start)})`,
            `${pctText(r.res.min.returnPct)} (from ${dateText(r.res.min.start)})`, pctText(r.res.negativePct, 1)]
          : [r.name, r.res.error, "", "", "", "", ""]),
      ),
      ...failures(rows.map((r) => ({ name: r.name, error: r.res.ok ? null : r.res.error }))),
    );
    if (done.length > 0) {
      out.push(
        section("2. How often each return band occurred (% of windows)"),
        table(
          ["Scheme", ...ROLLING_BANDS.map((b) => b.label)],
          done.map((d) => [d.name, ...d.res.bands.map((b) => pctText(b.pct, 1))]),
        ),
        ...researchNote(
          done.map((d) => ({ name: d.name, from: d.res.windows[0].start, to: d.res.windows[d.res.windows.length - 1].end })),
          `A window starts on every NAV date and ends ${years} calendar year${years === 1 ? "" : "s"} later; its return is annualised.`,
        ),
      );
    }
    return out;
  },
};

/* ───────────────────────── frp2p ───────────────────────── */

/** FundPointToPoint.tsx — Point-to-Point Comparison (pointToPoint, once per scheme). */
const frp2p: CalcBody = {
  inputs: [
    ...schemeSlots(),
    { key: "amount", label: "Amount (₹)", type: "money", default: 100000 },
    { key: "start", label: "From", type: "date", maxToday: true, default: yearsBefore(TODAY, 3) },
    { key: "end", label: "To", type: "date", maxToday: true, default: TODAY },
    { key: "rf", label: "Risk-free rate (% a year)", type: "percent", default: 6.5 },
  ],
  navSchemes: slotCodes,
  compute: (v, ctx) => {
    const amount = nn(v.amount);
    const rf = nn(v.rf);
    const loaded = readySlots(v, ctx);
    const out = statusNotes(loaded);
    if (loaded.length === 0) return [...out, insight("Pick up to five schemes to compare over one period.", "neutral")];
    const rows = loaded.map((r) => ({
      name: r.name, res: pointToPoint(r.series, { amount, startDate: str(v.start), endDate: str(v.end), riskFreePct: rf }),
    }));
    const done = rows.flatMap((r) => (r.res.ok ? [{ name: r.name, res: r.res }] : []));
    out.push(
      section("1. Comparison"),
      table(
        ["Scheme", "Period", "Growth value", "Absolute", "CAGR", "Mean", "Std deviation", "Sharpe"],
        rows.map((r) => r.res.ok
          ? [r.name, `${dateText(r.res.startDate)} – ${dateText(r.res.endDate)}`, inr(r.res.growthValue), pctText(r.res.absolutePct),
            r.res.cagrPct === null ? "Under 1 yr" : pctText(r.res.cagrPct), pctText(r.res.meanPct), pctText(r.res.stdDevPct),
            r.res.sharpe === null ? "—" : r.res.sharpe.toFixed(2)]
          : [r.name, r.res.error, "", "", "", "", "", ""]),
      ),
      ...failures(rows.map((r) => ({ name: r.name, error: r.res.ok ? null : r.res.error }))),
    );
    if (done.length > 0) {
      out.push(...researchNote(
        done.map((d) => ({ name: d.name, from: d.res.startDate, to: d.res.endDate })),
        "Mean and standard deviation are of the NAV-to-NAV returns in the period, annualised over 252 trading days; Sharpe is "
        + "(mean − risk-free rate) ÷ standard deviation. Alpha and beta are not shown: they need a benchmark index history, "
        + "which this data does not include.",
      ));
    }
    return out;
  },
};

/* ───────────────────────── frcalendar / frmonthly ───────────────────────── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const QUARTERS = ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"];

/** FundPeriodReturns.tsx cell — "12.34%", with a marker for a partial period. */
function cell(r: PeriodReturn | null | undefined): string {
  if (!r) return "—";
  return `${pctText(r.returnPct)}${r.partial === "since_launch" ? " ¹" : r.partial === "to_date" ? " ²" : ""}`;
}

const PARTIAL_NOTE = "¹ since the scheme's launch in that period. ² to the latest NAV — the period has not ended.";

/** FundPeriodReturns.tsx FundCalendarReturns — Calendar-Year Returns (periodReturns "year", once per scheme). */
const frcalendar: CalcBody = {
  inputs: [
    ...schemeSlots(),
    { key: "show", label: "Years", type: "segmented", default: "10", options: opts([["10", "Last 10"], ["all", "Since launch"]]) },
  ],
  navSchemes: slotCodes,
  compute: (v, ctx) => {
    const loaded = readySlots(v, ctx);
    const out = statusNotes(loaded);
    if (loaded.length === 0) return [...out, insight("Pick up to five schemes to see their year-by-year returns.", "neutral")];
    const data = loaded.map((r) => ({ name: r.name, years: periodReturns(r.series, "year") }));
    const allYears = [...new Set(data.flatMap((d) => d.years.map((y) => y.year)))].sort((a, b) => b - a);
    const years = v.show === "all" ? allYears : allYears.slice(0, 10);
    if (years.length === 0) return out;
    out.push(
      section("1. Return in each calendar year"),
      table(
        ["Scheme", ...years.map(String)],
        data.map((d) => [d.name, ...years.map((y) => cell(d.years.find((r) => r.year === y)))]),
      ),
      ...researchNote(
        data.flatMap((d) => (d.years.length ? [{ name: d.name, from: d.years[0].fromDate, to: d.years[d.years.length - 1].toDate }] : [])),
        `A year's return runs from the last NAV of the year before to the last NAV of the year. ${PARTIAL_NOTE}`,
      ),
    );
    return out;
  },
};

/** FundPeriodReturns.tsx FundMonthlyReturns — Monthly & Quarterly Returns (returnGrid). */
const frmonthly: CalcBody = {
  inputs: [
    { key: "scheme", label: "Scheme", type: "scheme", source: "universe", default: null },
    { key: "kind", label: "Period", type: "segmented", default: "month", options: opts([["month", "Monthly"], ["quarter", "Quarterly"]]) },
  ],
  navSchemes: singleCode("scheme"),
  compute: (v, ctx) => {
    const fund = pickOf(v.scheme);
    if (!fund) return [insight(PICK_FIRST, "neutral")];
    const s = ctx.nav[fund.code];
    if (!s) return [];
    const out = statusNotes([{ name: fund.name, series: s }]);
    const kind: "month" | "quarter" = v.kind === "quarter" ? "quarter" : "month";
    const grid = returnGrid(s, kind);
    if (grid.rows.length === 0) return out;
    const heads = kind === "month" ? MONTHS : QUARTERS;
    const first = grid.rows[grid.rows.length - 1]?.cells.find((c) => c !== null);
    const last = grid.rows[0] ? [...grid.rows[0].cells].reverse().find((c) => c !== null) : null;
    out.push(
      section(kind === "month" ? "1. Return in each month" : "1. Return in each quarter"),
      table(
        ["Year", ...heads, "Year"],
        grid.rows.map((r) => [String(r.year), ...r.cells.map(cell), cell(r.yearReturn)]),
      ),
    );
    if (first && last) {
      out.push(...researchNote(
        [{ name: fund.name, from: first.fromDate, to: last.toDate }],
        `Each return runs from the last NAV of the previous ${kind} to the last NAV of the ${kind}; a ${kind} with no NAV of its own shows —. ${PARTIAL_NOTE}`,
      ));
    }
    return out;
  },
};

export const DEFS: Record<string, CalcBody> = {
  frsip, frlumpsum, frstp, frstpprofit, frswp, frrolling, frp2p, frcalendar, frmonthly,
};
