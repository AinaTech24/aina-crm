/**
 * Dreams & Milestones, Essentials & Behaviour, Engagement & Fun — mirrors the
 * web groups of the same names (src/components/calculators/*, maths in ./web).
 * Labels, figures and the order of results follow the web component named on
 * each def. Where the web component keeps its maths inline (no lib module), it
 * is copied here verbatim, with the source file named above it.
 *
 * A web "hero" box (the big centred figure) is the first stat, its small line
 * under the figure the stat's hint. Charts are not drawn; a stacked bar whose
 * legend prints figures is that legend, as a table.
 */

import type { CalcBody, InputSpec, ResultBlock, Tone } from "../types";
import { inr, inrCompact as inrShort } from "../fmt";
import { fvSip } from "../web/goal-planning-calc";
import {
  passiveIncome, inflatedGoalSip, dreamCar, emergencyFund, retirementBuckets, sipPauseCost, timeMachine, doublingTimeline,
} from "../web/advisory";
import { youthBucketStrategy } from "../web/bucket-strategy";
import { journeyToFreedom } from "../web/journey-to-freedom";
import { familyWealthPlan, type AssetClassInput } from "../web/family-wealth";
import { TONE, stat, section, table, insight, note, opts, chart } from "./shared";

/** The web's clampNum: a non-negative finite number, 0 on garbage. */
const nn = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** The web's `Number(e.target.value) || 0` (sign kept). */
const num = (x: unknown): number => Number(x) || 0;

const thisYear = () => new Date().getFullYear();

/* ───────────────────────── Dreams & Milestones ───────────────────────── */

const PAYOUT = [
  { value: "0", label: "Forever (never touch principal)" },
  { value: "30", label: "For 30 years" },
  { value: "25", label: "For 25 years" },
];

/** PassiveIncomeBuilder.tsx — Financial-Freedom Builder (passiveIncome), with
 *  the one-time lumpsum beside the SIP. */
const passiveincome: CalcBody = {
  inputs: [
    { key: "targetMonthly", label: "Income wanted today (₹/mo)", type: "money", default: 100000 },
    { key: "yearsToFreedom", label: "Years to freedom", type: "years", default: 15 },
    { key: "existing", label: "Already invested (₹)", type: "money", default: 0 },
    { key: "buildReturn", label: "Build return (% p.a.)", type: "percent", default: 12 },
    { key: "postReturn", label: "Post-freedom return (% p.a.)", type: "percent", default: 9 },
    { key: "inflation", label: "Inflation (% p.a.)", type: "percent", default: 6 },
    { key: "payout", label: "Income should last", type: "select", default: "0", options: PAYOUT },
  ],
  compute: (v) => {
    const targetMonthly = nn(v.targetMonthly);
    const yearsToFreedom = nn(v.yearsToFreedom);
    const inflation = nn(v.inflation);
    const postReturn = nn(v.postReturn);
    const payout = PAYOUT.some((p) => p.value === v.payout) ? String(v.payout) : "0";
    const res = passiveIncome({
      targetMonthlyToday: targetMonthly,
      inflationPct: inflation,
      postReturnPct: postReturn,
      yearsToFreedom,
      existingCorpus: nn(v.existing),
      buildReturnPct: nn(v.buildReturn),
      payoutYears: Number(payout),
    });
    const freedomYear = thisYear() + yearsToFreedom;
    // Income forever needs a return above inflation; otherwise no corpus is enough.
    const noPerpetuity = Number(payout) === 0 && postReturn <= inflation;
    return [
      stat("Invest this much every month", noPerpetuity ? "—" : `${inr(Math.round(res.requiredSip))}/mo`, "success", `You're financially free in ${freedomYear}`),
      stat(`Income in ${yearsToFreedom} yrs`, `${inr(Math.round(res.futureMonthly))}/mo`, "brand"),
      stat("Corpus needed", noPerpetuity ? "—" : inrShort(res.corpusNeeded), "success"),
      stat("Monthly SIP", noPerpetuity ? "—" : inr(Math.round(res.requiredSip)), "success"),
      stat("Or one-time lumpsum today", noPerpetuity ? "—" : inr(Math.round(res.lumpsumToday)), "success"),
      noPerpetuity
        ? insight("Income forever needs a post-freedom return above inflation — raise it or pick a fixed period.", "warning")
        : insight(`To draw ${inr(targetMonthly)}/month (≈ ${inr(Math.round(res.futureMonthly))}/mo after ${inflation}% inflation) ${Number(payout) === 0 ? "forever, without ever touching the principal" : `for ${payout} years`}, your client needs a corpus of ${inrShort(res.corpusNeeded)} — built with about ${inr(Math.round(res.requiredSip))}/month for ${yearsToFreedom} years, or a one-time lumpsum of about ${inr(Math.round(res.lumpsumToday))} invested today.`, "success"),
    ];
  },
};

/** WeddingPlanner.tsx PRESETS (the cost chips). */
const WEDDING_PRESETS = [
  { label: "💍 Simple / Court", cost: 1500000 },
  { label: "🎉 Tier-2 city", cost: 3000000 },
  { label: "🏛️ Metro grand", cost: 6000000 },
  { label: "✈️ Destination", cost: 12000000 },
];
/** The preset picked ("p0"…"p3"), or undefined for "Custom amount". */
const weddingPreset = (v: Record<string, any>) => {
  const m = /^p(\d)$/.exec(String(v.preset ?? ""));
  return m ? WEDDING_PRESETS[Number(m[1])] : undefined;
};

/** WeddingPlanner.tsx — Dream Wedding Planner (inflatedGoalSip), with the
 *  one-time lumpsum beside the SIP. The web's cost chips are a "Cost preset"
 *  list; "Custom amount" shows the cost field. */
const wedding: CalcBody = {
  inputs: [
    {
      key: "preset", label: "Cost preset", type: "select", default: "custom",
      options: [{ value: "custom", label: "Custom amount" }, ...WEDDING_PRESETS.map((p, i) => ({ value: `p${i}`, label: `${p.label} · ${inrShort(p.cost)}` }))],
    },
    { key: "cost", label: "Wedding cost today (₹)", type: "money", default: 3000000, visibleIf: (v) => !weddingPreset(v) },
    { key: "years", label: "Years to wedding", type: "years", default: 15 },
    { key: "inflation", label: "Cost inflation (% p.a.)", type: "percent", default: 7 },
    { key: "existing", label: "Already saved (₹)", type: "money", default: 0 },
    { key: "returnPct", label: "Expected return (% p.a.)", type: "percent", default: 12 },
  ],
  compute: (v) => {
    const preset = weddingPreset(v);
    const cost = preset ? preset.cost : nn(v.cost);
    const years = nn(v.years);
    const inflation = nn(v.inflation);
    const res = inflatedGoalSip({ costToday: cost, years, inflationPct: inflation, existingSavings: nn(v.existing), returnPct: nn(v.returnPct) });
    return [
      stat("Start a SIP of", `${inr(Math.round(res.requiredSip))}/mo`, "success", `for ${years} years to fund the big day, stress-free`),
      stat(`Cost in ${years} yrs`, inrShort(res.futureCost), "warning"),
      stat("Monthly SIP needed", inr(Math.round(res.requiredSip)), "success"),
      stat("Or one-time lumpsum today", inr(Math.round(res.lumpsumToday)), "success"),
      insight(`A ${inrShort(cost)} wedding today becomes ${inrShort(res.futureCost)} in ${years} years at ${inflation}% inflation. A SIP of ${inr(Math.round(res.requiredSip))}/month — or a one-time lumpsum of ${inr(Math.round(res.lumpsumToday))} invested today — funds it calmly, instead of breaking an FD or taking a loan at the last minute.`, "success"),
    ];
  },
};

/** DreamCarPlanner.tsx — Dream Car, Invest First (dreamCar), with the one-time
 *  lumpsum beside the SIP. The invest-vs-loan bar chart is not drawn. */
const dreamcar: CalcBody = {
  inputs: [
    { key: "price", label: "Car price today (₹)", type: "money", default: 1500000 },
    { key: "yearsToBuy", label: "Buy in (years)", type: "years", default: 4 },
    { key: "carInflation", label: "Car price inflation (% p.a.)", type: "percent", default: 6 },
    { key: "investReturn", label: "Invest return (% p.a.)", type: "percent", default: 11 },
    { key: "downPct", label: "Loan down-payment (%)", type: "percent", default: 20 },
    { key: "loanRate", label: "Auto-loan rate (% p.a.)", type: "percent", default: 9.5 },
    { key: "loanYears", label: "Auto-loan tenure (yrs)", type: "years", default: 5 },
  ],
  compute: (v) => {
    const yearsToBuy = nn(v.yearsToBuy);
    const res = dreamCar({
      carPriceToday: nn(v.price),
      yearsToBuy,
      carInflationPct: nn(v.carInflation),
      investReturnPct: nn(v.investReturn),
      downPaymentPct: nn(v.downPct),
      loanRatePct: nn(v.loanRate),
      loanYears: nn(v.loanYears),
    });
    return [
      stat(`Car price in ${yearsToBuy} yrs`, inrShort(res.futurePrice), "warning"),
      stat("Invest-first SIP", `${inr(Math.round(res.sipToBuyCash))}/mo`, "success"),
      stat("Or invest-first lumpsum today", inr(Math.round(res.lumpsumToBuyCash)), "success"),
      stat("Auto-loan EMI", `${inr(Math.round(res.emi))}/mo`, "brand"),
      stat("Loan interest paid", inrShort(res.loanInterest), "danger"),
      yearsToBuy <= 0
        ? insight("Set “Buy in” to at least 1 year to compare investing first with the loan.", "warning")
        : insight(`Buying on loan today costs ${inrShort(res.loanTotal)} (${inrShort(res.loanInterest)} of it pure interest on a depreciating asset). Investing ${inr(Math.round(res.sipToBuyCash))}/month for ${yearsToBuy} years lets your client buy the ${inrShort(res.futurePrice)} car in cash for just ${inrShort(res.investedCash)} invested — and arrive debt-free. A one-time lumpsum of ${inr(Math.round(res.lumpsumToBuyCash))} invested today does the same with no monthly SIP.`, "success"),
    ];
  },
};

/** YouthBucketStrategy.tsx — 4-Bucket Strategy, Financial Freedom
 *  (youthBucketStrategy), with the one-time lumpsums beside the SIPs. The
 *  corpus-split bar is not drawn (the table carries each bucket's corpus). */
const youthbucket: CalcBody = {
  inputs: [
    { key: "expense", label: "Monthly expense today (₹)", type: "money", default: 80000 },
    { key: "ageNow", label: "Age now", type: "years", default: 25 },
    { key: "freedomAge", label: "Freedom age", type: "years", default: 41 },
    { key: "longevity", label: "Live until (age)", type: "years", default: 90 },
    { key: "inflation", label: "Inflation (% p.a.)", type: "percent", default: 6 },
    { key: "debt", label: "Bucket 1 · Debt (% p.a.)", type: "percent", default: 8 },
    { key: "hybrid", label: "Bucket 2 · Hybrid (% p.a.)", type: "percent", default: 10 },
    { key: "largeCap", label: "Bucket 3 · Large Cap (% p.a.)", type: "percent", default: 12 },
    { key: "midCap", label: "Bucket 4 · Mid Cap (% p.a.)", type: "percent", default: 15 },
  ],
  compute: (v) => {
    const freedomAge = nn(v.freedomAge);
    const largeCap = nn(v.largeCap);
    const res = youthBucketStrategy({
      monthlyExpenseToday: nn(v.expense),
      inflationPct: nn(v.inflation),
      ageNow: nn(v.ageNow),
      freedomAge,
      longevity: nn(v.longevity),
      debtReturnPct: nn(v.debt),
      hybridReturnPct: nn(v.hybrid),
      largeCapReturnPct: largeCap,
      midCapReturnPct: nn(v.midCap),
    });
    const activeBuckets = res.buckets.filter((b) => b.pvAtFreedom > 0);
    const noRunway = res.yearsToFreedom <= 0; // freedom age not after age now → no SIP period
    return [
      stat(
        "SIP with the 4-bucket strategy",
        noRunway ? "—" : `${inr(Math.round(res.sipBucket))}/mo`,
        "success",
        noRunway
          ? `Freedom age must be after age now — ${inrShort(res.corpusBucket)} is needed today.`
          : `${(res.savingsPct * 100).toFixed(0)}% lower than the ${inr(Math.round(res.sipWithout))}/mo a single debt fund would need — freedom at ${freedomAge} for your client`,
      ),
      stat("Corpus — bucket strategy", inrShort(res.corpusBucket), "success"),
      stat("Corpus — single fund", inrShort(res.corpusWithout), "warning"),
      stat("SIP — bucket strategy", noRunway ? "—" : `${inr(Math.round(res.sipBucket))}/mo`, "success"),
      stat("SIP — single fund", noRunway ? "—" : `${inr(Math.round(res.sipWithout))}/mo`, "danger"),
      stat("Or lumpsum today — bucket strategy", inrShort(res.lumpsumBucket)),
      stat("Or lumpsum today — single fund", inrShort(res.lumpsumWithout)),
      table(
        ["Bucket", "Return", "Funds ages", "Expense then / mo", "Corpus at freedom"],
        activeBuckets.map((b) => [
          b.name,
          `${b.returnPct}%`,
          `${b.startAge}–${b.endAge}`,
          inr(Math.round(b.expenseAtStart)),
          inrShort(b.pvAtFreedom),
        ]),
      ),
      insight(`Funding ${res.totalFreedomYears} years of freedom from one debt fund needs ${inrShort(res.corpusWithout)}; the 4-bucket strategy needs only ${inrShort(res.corpusBucket)} (${(res.corpusSavedPct * 100).toFixed(0)}% less)${noRunway ? "." : ` — so the SIP drops from ${inr(Math.round(res.sipWithout))} to ${inr(Math.round(res.sipBucket))}/month, or a one-time lumpsum today from ${inrShort(res.lumpsumWithout)} to ${inrShort(res.lumpsumBucket)} at ${largeCap}%.`} That gap is the advisor’s alpha: each bucket sits in a higher-return fund until it’s needed.`, "success"),
      insight("Illustration only — returns are market-linked and not guaranteed. The plan assumes each bucket stays invested at its assumed return until drawn and is reviewed/rebalanced periodically.", "warning"),
    ];
  },
};

/** JourneyToFreedom.tsx — The Journey to Freedom (journeyToFreedom). The
 *  corpus chart is the growth chart (no freedom line); its table follows. */
const journey: CalcBody = {
  inputs: [
    { key: "salary", label: "Monthly income (₹)", type: "money", default: 50000 },
    { key: "expenses", label: "Monthly expenses (₹)", type: "money", default: 30000 },
    { key: "returnPct", label: "Expected return (% p.a.)", type: "percent", default: 12 },
    { key: "inflation", label: "Inflation (% p.a.)", type: "percent", default: 5 },
  ],
  compute: (v) => {
    const returnPct = nn(v.returnPct);
    const inflation = nn(v.inflation);
    const res = journeyToFreedom({ salaryMonthly: nn(v.salary), expensesMonthly: nn(v.expenses), inflationPct: inflation, returnPct, maxYears: 30 });
    const reached = res.freedomYear !== null;
    const freedomFinite = Number.isFinite(res.freedomCorpus);
    // Table window: up to the freedom year + 1 (or first 12 rows if not reached).
    const tableRows = (reached ? res.rows.slice(0, Math.min(res.rows.length, (res.freedomYear ?? 0) + 1)) : res.rows.slice(0, 12)).map(
      (r) => [
        `${r.year}`,
        inrShort(r.corpus),
        r.freedom ? "Forever ✓" : `${r.yearsOfFreedom.toFixed(1)} yrs`,
      ],
    );
    const out: ResultBlock[] = [];
    if (res.investmentMonthly <= 0) {
      out.push(insight("Expenses meet or exceed income, so there’s nothing to invest yet. Trim spending or grow income to begin the journey.", "danger"));
    } else if (reached) {
      out.push(stat("You reach Financial Freedom in", `${res.freedomYear} years`, "success", `investing ${inr(res.investmentMonthly)}/month — the corpus then funds expenses for life`));
    } else {
      out.push(insight(`At ${inr(res.investmentMonthly)}/month, freedom isn’t reached within 30 years. Invest more, cut expenses, or target a higher return to bring it forward.`, "warning"));
    }
    out.push(
      stat("Investable surplus", `${inr(res.investmentMonthly)}/mo`, "brand"),
      stat("Freedom corpus needed", reached && freedomFinite ? inrShort(res.freedomCorpus) : "—", "success"),
      stat("Corpus at freedom", res.corpusAtFreedom != null ? inrShort(res.corpusAtFreedom) : "—", "success"),
    );
    if (res.investmentMonthly > 0) {
      out.push(
        ...chart("Year", res.rows.map((r) => r.year), [{ label: "Corpus", values: res.rows.map((r) => r.corpus) }]),
        table(["Year", "Corpus", "Years of freedom"], tableRows, reached),
      );
    }
    out.push(insight(`Freedom isn’t about a magic number — it’s the point where your money out-earns your lifestyle. At a real return of ${res.realRatePct.toFixed(1)}% (return ${returnPct}% minus inflation ${inflation}%), your client gets there by investing the ${inr(res.investmentMonthly)}/month gap consistently. Raising the savings rate is the single biggest lever.`, "success"));
    return out;
  },
};

/** FamilyWealthPlan.tsx DEFAULT_CLASSES. */
const DEFAULT_CLASSES: AssetClassInput[] = [
  { name: "Equity", allocationPct: 70, returnPct: 12 },
  { name: "Hybrid", allocationPct: 10, returnPct: 10 },
  { name: "Debt", allocationPct: 10, returnPct: 7 },
  { name: "Others", allocationPct: 10, returnPct: 8 },
];

/** FamilyWealthPlan.tsx — Family Wealth Plan (familyWealthPlan). The web's
 *  "Use as SIP" button is a switch here: on, the SIP is the surplus. The
 *  growth chart is not drawn; the corpus-by-class bar is its legend, as a
 *  table. */
const familywealth: CalcBody = {
  inputs: [
    { key: "income", label: "Combined income (₹/mo)", type: "money", default: 225000, section: "Investable surplus (optional)" },
    { key: "expenses", label: "Living expenses (₹/mo)", type: "money", default: 78000 },
    { key: "emis", label: "Existing EMIs (₹/mo)", type: "money", default: 15000 },
    { key: "useSurplus", label: "Use as SIP", type: "toggle", default: false },
    { key: "lumpsum", label: "Lumpsum today (₹)", type: "money", default: 500000, section: "Plan" },
    { key: "sip", label: "Monthly SIP (₹)", type: "money", default: 100000, visibleIf: (v) => !v.useSurplus },
    { key: "currentAge", label: "Current age", type: "years", default: 30 },
    { key: "targetAge", label: "Target age", type: "years", default: 60 },
    ...DEFAULT_CLASSES.map((c, i): InputSpec[] => [
      { key: `alloc${i}`, label: `${c.name} · Alloc (%)`, type: "percent", default: c.allocationPct, ...(i === 0 ? { section: "Asset allocation" } : {}) },
      { key: `ret${i}`, label: `${c.name} · Return (% p.a.)`, type: "percent", default: c.returnPct },
    ]).flat(),
  ],
  compute: (v) => {
    const surplus = Math.max(0, nn(v.income) - nn(v.expenses) - nn(v.emis));
    const lumpsum = nn(v.lumpsum);
    const sip = v.useSurplus ? surplus : nn(v.sip);
    const targetAge = nn(v.targetAge);
    const classes: AssetClassInput[] = DEFAULT_CLASSES.map((c, i) => ({ name: c.name, allocationPct: num(v[`alloc${i}`]), returnPct: num(v[`ret${i}`]) }));
    const res = familyWealthPlan({ lumpsum, monthlySip: sip, currentAge: nn(v.currentAge), targetAge, classes });
    const allocOff = Math.abs(res.allocationSumPct - 100) > 0.01;
    const multiple = res.totalInvested > 0 ? res.finalTotal / res.totalInvested : 0;
    const out: ResultBlock[] = [stat("Surplus", `${inr(surplus)}/mo`, "success")];
    if (allocOff) {
      out.push(insight(`Asset allocation: Total ${res.allocationSumPct.toFixed(0)}%${res.allocationSumPct > 0 ? " — normalised to 100%" : " — split equally"}`, "warning"));
    }
    out.push(
      stat(`Total wealth at age ${targetAge}`, inrShort(res.finalTotal), "success", `over ${res.years} years, from ${inr(res.totalInvested)} invested`),
      stat("Total invested", inrShort(res.totalInvested)),
      stat(`Corpus at ${targetAge}`, inrShort(res.finalTotal), "success"),
      stat("Wealth multiple", `${multiple.toFixed(1)}×`, "brand"),
      stat("Blended return", `${res.blendedReturnPct.toFixed(1)}%`, "warning"),
      section(`Corpus by asset class at age ${targetAge}`),
      table(
        ["Asset class", "Corpus", "Share"],
        res.finalByClass.map((x, i) => [classes[i].name, inrShort(x), `${(res.finalTotal > 0 ? (x / res.finalTotal) * 100 : 0).toFixed(0)}%`]),
      ),
      table(
        ["Age", "Year", "Total fund value"],
        res.series
          .filter((s) => s.year === res.years || s.year % 5 === 0)
          .map((s) => [`${s.age}`, `${s.year}`, inrShort(s.total)]),
        true,
      ),
      insight(`Investing ${inr(lumpsum)} today plus ${inr(sip)}/month across this mix (blended ~${res.blendedReturnPct.toFixed(1)}%) grows to ${inrShort(res.finalTotal)} by age ${targetAge} — a ${multiple.toFixed(1)}× return on the ${inr(res.totalInvested)} actually invested. The equity-heavy allocation does the heavy lifting; debt & hybrid steady the ride.`, "success"),
      insight("Illustration only — returns are market-linked and not guaranteed. Rebalance the allocation periodically and review as income, goals and risk appetite change.", "warning"),
    );
    return out;
  },
};

/* ───────────────────────── Essentials & Behaviour ───────────────────────── */

/** EmergencyFundPlanner.tsx — Emergency Fund Planner (emergencyFund), with
 *  the one-time lumpsum beside the SIP. */
const emergency: CalcBody = {
  inputs: [
    { key: "expense", label: "Monthly expenses (₹)", type: "money", default: 60000 },
    { key: "existing", label: "Already set aside (₹)", type: "money", default: 50000 },
    { key: "buildMonths", label: "Build over (months)", type: "int", default: 12 },
    { key: "parkReturn", label: "Parking return (% p.a.)", type: "percent", default: 6 },
    { key: "buffer", label: "Buffer size", type: "segmented", default: "6", options: opts([["3", "3 months"], ["6", "6 months"], ["12", "12 months"]]) },
  ],
  compute: (v) => {
    const buffer = ["3", "6", "12"].includes(String(v.buffer)) ? String(v.buffer) : "6";
    const buildMonths = nn(v.buildMonths);
    const res = emergencyFund({ monthlyExpense: nn(v.expense), monthsBuffer: Number(buffer), existing: nn(v.existing), buildMonths, parkReturnPct: nn(v.parkReturn) });
    const funded = res.gap <= 0;
    const noPeriod = !funded && buildMonths <= 0; // gap but no build period → no SIP to show
    return [
      stat("Target fund", inrShort(res.target), "brand"),
      stat("Still needed", funded ? "Fully funded ✓" : inrShort(res.gap), funded ? "success" : "warning"),
      stat("Monthly SIP", funded || noPeriod ? "—" : `${inr(Math.round(res.requiredSip))}/mo`, "success"),
      stat("Or one-time lumpsum today", funded ? "—" : inr(Math.round(res.lumpsumToday)), "success"),
      insight(
        funded
          ? `Your client already has the ${buffer}-month buffer of ${inrShort(res.target)} covered — now goal-investing can begin with confidence.`
          : noPeriod
            ? `Set a build period to spread the ${inrShort(res.gap)} gap — or set it aside today in one go.`
            : `A ${buffer}-month safety net is ${inrShort(res.target)}. Your client can build the ${inrShort(res.gap)} gap with about ${inr(Math.round(res.requiredSip))}/month over ${buildMonths} months — or a one-time ${inr(Math.round(res.lumpsumToday))} parked today.`,
        funded ? "success" : "brand",
      ),
      insight("Park it where it’s safe and instantly accessible — a liquid or arbitrage fund / sweep-in FD, not equity. The emergency fund’s job is availability, not growth.", "warning"),
    ];
  },
};

/** RetirementBucketStrategy.tsx — Retirement Bucket Strategy
 *  (retirementBuckets). The stacked bar is not drawn; the three bucket cards
 *  are stats (their sub-line the hint). */
const buckets: CalcBody = {
  inputs: [
    { key: "corpus", label: "Retirement corpus (₹)", type: "money", default: 50000000 },
    { key: "expense", label: "Monthly expense (₹)", type: "money", default: 150000 },
    { key: "b1Years", label: "Bucket 1 — cash (yrs)", type: "years", default: 3 },
    { key: "b2Years", label: "Bucket 2 — debt (yrs)", type: "years", default: 7 },
  ],
  compute: (v) => {
    const corpus = nn(v.corpus);
    const expense = nn(v.expense);
    const b1Years = nn(v.b1Years);
    const res = retirementBuckets({ corpus, monthlyExpense: expense, bucket1Years: b1Years, bucket2Years: nn(v.b2Years) });
    // Years Bucket 1 actually funds — less than asked when the corpus is short.
    const b1Covered = res.annual > 0 ? Math.round(Math.min(b1Years, res.b1 / res.annual) * 10) / 10 : b1Years;
    const list = [
      { name: "Bucket 1 · Cash", sub: `${b1Years} yrs of spending — liquid/arbitrage`, amt: res.b1 },
      { name: "Bucket 2 · Debt", sub: `Years ${b1Years + 1}–${res.yearsCovered} — short-term debt`, amt: res.b2 },
      { name: "Bucket 3 · Equity", sub: `Year ${res.yearsCovered + 1}+ — long-term growth`, amt: res.b3 },
    ];
    return [
      ...list.map((b) => stat(b.name, inrShort(b.amt), undefined, b.sub)),
      insight(`On ${inrShort(corpus)} with ${inr(expense)}/month spending: keep ${inrShort(res.b1)} in cash (the next ${b1Covered} years are crash-proof), ${inrShort(res.b2)} in debt, and let ${inrShort(res.b3)} compound in equity. Refill Bucket 1 from Bucket 2, and Bucket 2 from equity in good years — so the retiree never sells equity in a downturn.`, "success"),
      insight("A planning framework, not a guarantee. Review and refill the buckets annually; actual longevity depends on returns, inflation and spending.", "warning"),
    ];
  },
};

/** SipPauseCostCalculator.tsx — The Cost of Pausing Your SIP (sipPauseCost). */
const sippause: CalcBody = {
  inputs: [
    { key: "sip", label: "Monthly SIP (₹)", type: "money", default: 25000 },
    { key: "monthsSkipped", label: "SIPs skipped (months)", type: "int", default: 6 },
    { key: "yearsRemaining", label: "Years to goal", type: "years", default: 20 },
    { key: "returnPct", label: "Expected return (% p.a.)", type: "percent", default: 12 },
  ],
  compute: (v) => {
    const sip = nn(v.sip);
    const monthsSkipped = nn(v.monthsSkipped);
    const yearsRemaining = nn(v.yearsRemaining);
    const res = sipPauseCost({ monthlySip: sip, returnPct: nn(v.returnPct), yearsRemaining, monthsSkipped });
    const multiple = res.contributed > 0 ? res.costAtHorizon / res.contributed : 0;
    const s = monthsSkipped === 1 ? "" : "s";
    return [
      stat(`Skipping ${monthsSkipped} SIP${s} costs the goal`, inrShort(res.costAtHorizon), "danger", `on just ${inr(res.contributed)} of skipped contributions — a ${multiple.toFixed(1)}× loss`),
      stat("Contributions skipped", inr(res.contributed)),
      stat("Lost at goal date", inrShort(res.costAtHorizon), "danger"),
      insight(`Pausing ${monthsSkipped} SIP${s} of ${inr(sip)} saves ${inr(res.contributed)} today, but costs your client ${inrShort(res.costAtHorizon)} at the goal ${yearsRemaining} years out — because early rupees compound the longest. When money is tight, reduce the SIP rather than stopping it.`, "warning"),
    ];
  },
};

// Copied verbatim from src/components/calculators/MonthlyBudgetPlanner.tsx (the
// field lists, sum and the component's `m` useMemo, `rows`, `score`, `bars`
// and the surplus projection).
type Group = Record<string, number>;
const sum = (g: Group) => Object.values(g).reduce((a, b) => a + (b || 0), 0);
type Fields = { key: string; label: string }[];

const INFLOW_FIELDS: Fields = [
  { key: "income", label: "Monthly income" },
  { key: "additional", label: "Additional income" },
  { key: "rental", label: "Rental income" },
  { key: "spouse", label: "Spouse's income" },
];
const ESSENTIAL_FIELDS: Fields = [
  { key: "rent", label: "Rent & maintenance" },
  { key: "propertyTax", label: "Property tax" },
  { key: "utilities", label: "Utilities" },
  { key: "groceries", label: "Groceries" },
  { key: "transport", label: "Transportation" },
  { key: "medical", label: "Medical" },
  { key: "schoolFees", label: "School fees" },
  { key: "insurance", label: "Insurance premiums" },
];
const LIFESTYLE_FIELDS: Fields = [
  { key: "maid", label: "Maid / help" },
  { key: "shopping", label: "Shopping" },
  { key: "travel", label: "Travel" },
  { key: "dine", label: "Dine & entertainment" },
];
const EMI_FIELDS: Fields = [
  { key: "home", label: "Home loan EMI" },
  { key: "car", label: "Car loan EMI" },
  { key: "personal", label: "Personal loan EMI" },
  { key: "other", label: "Other EMIs" },
];
const INVEST_FIELDS: Fields = [
  { key: "mf", label: "Mutual funds" },
  { key: "stocks", label: "Stocks" },
  { key: "fd", label: "Fixed deposits" },
  { key: "others", label: "Others" },
];

export type BudgetGroups = { inflows: Group; essential: Group; lifestyle: Group; emis: Group; invest: Group };

export function monthlyBudget({ inflows, essential, lifestyle, emis, invest }: BudgetGroups, projectReturn: number, projectYears: number) {
  const m = (() => {
    const totalIn = sum(inflows);
    const e = sum(essential), l = sum(lifestyle), em = sum(emis), iv = sum(invest);
    const out = e + l + em + iv;
    const leftout = totalIn - out;
    // No income → no meaningful share (was ÷1, printing e.g. "8300000%").
    const pct = (x: number) => (totalIn > 0 ? x / totalIn : 0);
    return {
      totalIn: sum(inflows), e, l, em, iv, out, leftout,
      ePct: pct(e), lPct: pct(l), emPct: pct(em), ivPct: pct(iv), leftoutPct: pct(leftout),
      savingsRate: pct(iv + Math.max(0, leftout)),
    };
  })();

  const rows = [
    { name: "Essential expenses", val: m.e, pct: m.ePct, ok: m.ePct < 0.4, good: "In line with income", bad: "Trim unnecessary expenses" },
    { name: "Lifestyle expenses", val: m.l, pct: m.lPct, ok: m.lPct < 0.2, good: "Healthy lifestyle spend", bad: "Cut discretionary spends" },
    { name: "EMIs (leverage)", val: m.em, pct: m.emPct, ok: m.emPct < 0.3, good: "Leverage is comfortable", bad: "Close high-rate loans ASAP" },
    { name: "Investments", val: m.iv, pct: m.ivPct, ok: m.ivPct >= 0.2, good: "Strong savings discipline", bad: "Increase your investments" },
    { name: "Leftover / month", val: m.leftout, pct: m.leftoutPct, ok: m.leftout >= 0 && m.leftoutPct <= 0.1, good: "Well-allocated budget", bad: m.leftout < 0 ? "Spending exceeds income" : "Move idle surplus to investments" },
  ];
  const score = rows.filter((r) => r.ok).length;

  const bars = [
    { label: "Essential", value: m.e },
    { label: "Lifestyle", value: m.l },
    { label: "EMIs", value: m.em },
    { label: "Investments", value: m.iv },
    { label: "Leftover", value: Math.max(0, m.leftout) },
  ];

  const surplusToInvest = Math.max(0, m.leftout);
  const surplusCorpus = surplusToInvest > 0 ? fvSip(surplusToInvest, projectReturn, projectYears * 12) : 0;
  return { m, rows, score, bars, surplusToInvest, surplusCorpus };
}

/** MonthlyBudgetPlanner.tsx useState seeds. */
const BUDGET_DEFAULTS: BudgetGroups = {
  inflows: { income: 150000, additional: 0, rental: 0, spouse: 50000 },
  essential: { rent: 35000, propertyTax: 1000, utilities: 6000, groceries: 15000, transport: 6000, medical: 3000, schoolFees: 12000, insurance: 5000 },
  lifestyle: { maid: 4000, shopping: 6000, travel: 5000, dine: 6000 },
  emis: { home: 30000, car: 10000, personal: 0, other: 0 },
  invest: { mf: 20000, stocks: 5000, fd: 5000, others: 0 },
};
const BUDGET_GROUPS: Array<[keyof BudgetGroups, string | null, Fields]> = [
  ["inflows", null, INFLOW_FIELDS],
  ["essential", "Essential expenses", ESSENTIAL_FIELDS],
  ["lifestyle", "Lifestyle expenses", LIFESTYLE_FIELDS],
  ["emis", "EMIs / Loans", EMI_FIELDS],
  ["invest", "Investments", INVEST_FIELDS],
];

/** MonthlyBudgetPlanner.tsx — Monthly Budget Planner (inline maths above).
 *  The where-the-money-goes bar is its legend, as a table. */
const budget: CalcBody = {
  inputs: [
    ...BUDGET_GROUPS.flatMap(([g, title, fields]) =>
      fields.map((f, i): InputSpec => ({
        key: `${g}_${f.key}`,
        label: g === "inflows" ? `${f.label} (₹)` : f.label,
        type: "money",
        default: BUDGET_DEFAULTS[g][f.key] ?? 0,
        ...(i === 0 && title ? { section: title } : {}),
      })),
    ),
    { key: "projectReturn", label: "Return (% p.a.)", type: "percent", default: 12, section: "Grow the leftover surplus" },
    { key: "projectYears", label: "For (yrs)", type: "years", default: 20 },
  ],
  compute: (v) => {
    const groups = Object.fromEntries(
      BUDGET_GROUPS.map(([g, , fields]) => [g, Object.fromEntries(fields.map((f) => [f.key, Math.max(0, Number(v[`${g}_${f.key}`]) || 0)]))]),
    ) as BudgetGroups;
    const projectReturn = num(v.projectReturn);
    const projectYears = Number(v.projectYears) || 1;
    const { m, rows, score, bars, surplusToInvest, surplusCorpus } = monthlyBudget(groups, projectReturn, projectYears);
    const scoreTone: Tone = score >= 4 ? "success" : score >= 3 ? "warning" : "danger";
    return [
      stat("Total inflow", `${inr(m.totalIn)}/mo`, "brand"),
      stat("Total outflow", `${inr(m.out)}/mo`),
      stat("Leftover", `${inr(m.leftout)}/mo`, m.leftout >= 0 ? "success" : "danger"),
      stat("Savings rate", `${(m.savingsRate * 100).toFixed(0)}%`, m.savingsRate >= 0.2 ? "success" : "warning"),
      section("Where your money goes"),
      table(["Category", "Amount"], bars.map((b) => [b.label, inrShort(b.value)])),
      section("Budget health check"),
      stat("Score", `${score}/5`, scoreTone),
      table(
        ["Category", "Amount", "% of income", "Verdict"],
        rows.map((r) => [r.name, inr(r.val), m.totalIn > 0 ? `${(r.pct * 100).toFixed(0)}%` : "—", r.ok ? `✓ ${r.good}` : `⚠ ${r.bad}`]),
      ),
      section("Grow the leftover surplus"),
      insight(`Investing the ${inr(surplusToInvest)}/month leftover becomes ${inrShort(surplusCorpus)} in ${projectYears} years.`),
      insight(`${score >= 4
        ? `A healthy budget — ${score}/5 checks pass and the savings rate is ${(m.savingsRate * 100).toFixed(0)}%.`
        : `${5 - score} area(s) need attention.`} The benchmarks: Essentials under 40%, Lifestyle under 20%, EMIs under 30%, Investments at least 20%, and idle leftover under 10% of income. Redirecting the surplus into a SIP turns budgeting discipline into real wealth.`, score >= 4 ? "success" : "warning"),
    ];
  },
};

/* ───────────────────────── Engagement & Fun ───────────────────────── */

// Copied verbatim from src/components/calculators/MoneyPersonalityQuiz.tsx
// (QUESTIONS, profileFor and the component's score).
type Q = { q: string; options: { label: string; score: number }[] };

export const QUESTIONS: Q[] = [
  {
    q: "Your investment horizon for this money is…",
    options: [
      { label: "Under 3 years", score: 1 },
      { label: "3–7 years", score: 2 },
      { label: "7–15 years", score: 3 },
      { label: "15+ years", score: 4 },
    ],
  },
  {
    q: "Your portfolio drops 25% in a month. You…",
    options: [
      { label: "Sell everything — can't sleep", score: 1 },
      { label: "Sell some to feel safer", score: 2 },
      { label: "Hold and wait it out", score: 3 },
      { label: "Invest more — it's on sale", score: 4 },
    ],
  },
  {
    q: "What matters most to you?",
    options: [
      { label: "Never losing capital", score: 1 },
      { label: "Steady, predictable returns", score: 2 },
      { label: "Beating inflation comfortably", score: 3 },
      { label: "Maximum long-term growth", score: 4 },
    ],
  },
  {
    q: "Your monthly income is…",
    options: [
      { label: "Irregular / uncertain", score: 1 },
      { label: "Stable but tight", score: 2 },
      { label: "Stable with surplus", score: 3 },
      { label: "High and growing", score: 4 },
    ],
  },
  {
    q: "Your investing experience is…",
    options: [
      { label: "FDs & savings only", score: 1 },
      { label: "Some mutual funds", score: 2 },
      { label: "Regular equity investor", score: 3 },
      { label: "Confident across asset classes", score: 4 },
    ],
  },
  {
    q: "An emergency fund (6 months expenses) is…",
    options: [
      { label: "Not yet built", score: 1 },
      { label: "Partly built", score: 2 },
      { label: "Fully built", score: 3 },
      { label: "Built + extra buffer", score: 4 },
    ],
  },
  {
    q: "Which return would you pick?",
    options: [
      { label: "Guaranteed 6%", score: 1 },
      { label: "Likely 9%, small risk", score: 2 },
      { label: "Likely 12%, moderate swings", score: 3 },
      { label: "Maybe 15%, big swings", score: 4 },
    ],
  },
  {
    q: "Your age bracket is…",
    options: [
      { label: "55+", score: 1 },
      { label: "45–55", score: 2 },
      { label: "30–45", score: 3 },
      { label: "Under 30", score: 4 },
    ],
  },
];

type Profile = { name: string; tagline: string; equity: number; debt: number; gold: number; tone: "rose" | "amber" | "cyan" | "emerald" };

export function profileFor(score: number): Profile {
  if (score <= 14) return { name: "The Cautious Preserver", tagline: "Safety first — protect capital, beat inflation slowly.", equity: 25, debt: 65, gold: 10, tone: "cyan" };
  if (score <= 20) return { name: "The Balanced Builder", tagline: "Steady growth with a comfort cushion.", equity: 50, debt: 40, gold: 10, tone: "emerald" };
  if (score <= 26) return { name: "The Confident Grower", tagline: "Growth-tilted; rides volatility for higher returns.", equity: 70, debt: 22, gold: 8, tone: "amber" };
  return { name: "The Aggressive Wealth-Creator", tagline: "Maximum long-term growth; unfazed by big swings.", equity: 85, debt: 10, gold: 5, tone: "rose" };
}

/** MoneyPersonalityQuiz.tsx — Money Personality Quiz (inline scoring above).
 *  Each question is a list; the profile shows once all eight are answered.
 *  The mix bar is not drawn — the web's own table of it is. */
const quiz: CalcBody = {
  inputs: QUESTIONS.map((q, qi): InputSpec => ({
    key: `q${qi + 1}`,
    label: `${qi + 1}. ${q.q}`,
    type: "select",
    default: null,
    options: q.options.map((o, oi) => ({ value: String(oi), label: o.label })),
  })),
  compute: (v) => {
    const answers: (number | null)[] = QUESTIONS.map((q, qi) => {
      const raw = v[`q${qi + 1}`];
      if (raw == null || raw === "") return null;
      const oi = Number(raw);
      return Number.isInteger(oi) && oi >= 0 && oi < q.options.length ? oi : null;
    });
    const answeredCount = answers.filter((a) => a != null).length;
    const done = answeredCount === QUESTIONS.length;
    const score = answers.reduce<number>((s, a, i) => (a != null ? s + QUESTIONS[i].options[a].score : s), 0);
    const profile = done ? profileFor(score) : null;
    if (!profile) return [note(`${answeredCount}/${QUESTIONS.length} answered — finish all to reveal the profile.`)];
    const tone = TONE[profile.tone];
    const alloc = [
      { label: "Equity", pct: profile.equity },
      { label: "Debt", pct: profile.debt },
      { label: "Gold", pct: profile.gold },
    ];
    return [
      section("★ Your money personality"),
      stat("You are", profile.name, tone, profile.tagline),
      stat("Profile", profile.name, tone),
      stat("Risk score", `${score} / ${QUESTIONS.length * 4}`),
      section("Suggested starting mix"),
      table(["Asset", "Suggested allocation"], alloc.map((a) => [a.label, `${a.pct}%`])),
      insight("A starting point, not a prescription. The final allocation should reflect the client’s goals, timelines and tax position — exactly the conversation this quiz is designed to start.", tone),
    ];
  },
};

/** InflationTimeMachine.tsx — Inflation Time Machine (timeMachine). The
 *  everyday-things cards are stats. */
const TIME_ITEMS = [
  { label: "🎬 Movie ticket", base: 250 },
  { label: "⛽ Petrol (1 litre)", base: 105 },
  { label: "🥛 Litre of milk", base: 66 },
  { label: "🏠 ₹1 Cr today", base: 10000000 },
];
const timemachine: CalcBody = {
  inputs: [
    { key: "amount", label: "Amount (₹)", type: "money", default: 5000000 },
    { key: "fromYear", label: "From year", type: "int", default: thisYear() },
    { key: "toYear", label: "To year", type: "int", default: thisYear() + 20 },
    { key: "inflation", label: "Inflation (% p.a.)", type: "percent", default: 6 },
  ],
  compute: (v) => {
    const amount = nn(v.amount);
    const fromYear = Number(v.fromYear) || thisYear();
    const toYear = Number(v.toYear) || thisYear();
    const inflation = nn(v.inflation);
    const res = timeMachine({ amount, fromYear, toYear, inflationPct: inflation });
    const forward = toYear >= fromYear;
    const out: ResultBlock[] = [
      stat(
        `${inr(amount)} in ${fromYear} ${forward ? "will need to be" : "had the buying power of"}`,
        inr(Math.round(res.equivalent)),
        "brand",
        `to buy the same things in ${toYear} (${Math.abs(res.years)} years ${forward ? "later" : "earlier"})`,
      ),
      section("The same span, on everyday things"),
      ...TIME_ITEMS.map((it) => {
        const future = it.base * Math.pow(1 + inflation / 100, toYear - fromYear);
        return stat(it.label, `${it.base >= 100000 ? inrShort(it.base) : inr(it.base)} → ${it.base >= 100000 ? inrShort(future) : inr(Math.round(future))}`);
      }),
    ];
    if (inflation > 0) {
      out.push(insight(`At ${inflation}% inflation, money kept idle loses roughly half its value every ~${Math.round(72 / inflation)} years. Beating inflation isn’t optional — it’s the whole point of investing.`, "warning"));
    }
    return out;
  },
};

/** WealthDoublingCalculator.tsx — Wealth Doubling, Rule of 72 (doublingTimeline). */
const doubling: CalcBody = {
  inputs: [
    { key: "amount", label: "Amount (₹)", type: "money", default: 1000000 },
    { key: "returnPct", label: "Expected return (% p.a.)", type: "percent", default: 12 },
    { key: "doublings", label: "How many doublings", type: "int", default: 4 },
  ],
  compute: (v) => {
    const amount = nn(v.amount);
    const returnPct = nn(v.returnPct);
    const res = doublingTimeline({ amount, returnPct, doublings: nn(v.doublings) });
    const year = thisYear();
    const last = res.rows[res.rows.length - 1];
    return [
      stat("Money doubles every", Number.isFinite(res.yearsToDouble) ? `${res.yearsToDouble.toFixed(1)} yrs` : "—", "success"),
      stat("Rule of 72 estimate", Number.isFinite(res.rule72) ? `${res.rule72.toFixed(1)} yrs` : "—", "brand"),
      ...chart("Year", [0, ...res.rows.map((r) => r.years)], [{ label: "Corpus", values: [amount, ...res.rows.map((r) => r.value)] }]),
      table(
        ["Milestone", "Corpus", "Years", "Reached by"],
        res.rows.map((r) => [
          `${r.multiple}×`,
          inrShort(r.value),
          Number.isFinite(r.years) ? `${r.years.toFixed(1)} yrs` : "—",
          Number.isFinite(r.years) ? String(year + Math.round(r.years)) : "—",
        ]),
      ),
      Number.isFinite(res.yearsToDouble) && last
        ? insight(`At ${returnPct}% p.a., your client’s ${inrShort(amount)} doubles in about ${res.yearsToDouble.toFixed(1)} years — the “Rule of 72” (72 ÷ ${returnPct}) gives a quick ${res.rule72.toFixed(1)}. Stay invested long enough for a few doublings and compounding does the heavy lifting: ${inrShort(amount)} becomes ${inrShort(last.value)} in ${last.years.toFixed(0)} years.`, "success")
        : insight(`At ${returnPct}% p.a. money never doubles — enter a positive return.`, "warning"),
    ];
  },
};

export const DEFS: Record<string, CalcBody> = {
  passiveincome, wedding, dreamcar, youthbucket, journey, familywealth,
  emergency, buckets, sippause, budget,
  quiz, timemachine, doubling,
};
