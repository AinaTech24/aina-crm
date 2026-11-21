/**
 * Markets & Mindset and Smart Decisions — mirror the web groups of the same
 * names (src/components/calculators/*, maths in ./web). Labels, figures and the
 * order of results follow the web component named on each def. Charts are not
 * drawn (each one's figures are already in a tile or a table).
 */

import type { CalcBody, ResultBlock } from "../types";
import { inr, fmtPct, inrCompact } from "../fmt";
import { computeCrashStress } from "../web/crash-stress";
import { computeFire } from "../web/fire";
import { prepayVsInvest, btid as btidCalc, npsVsMf } from "../web/advisory";
import { housingEmiSip } from "../web/housing-emi-sip";
import { stat, section, table, insight, note } from "./shared";

/** The web's clampNum: a non-negative finite number, 0 on garbage. */
const nn = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** The web's inrShort (src/components/calculators/charts.tsx) — the same rule as inrCompact. */
const inrShort = inrCompact;

/* ─────────────────────────── Markets & Mindset ─────────────────────────── */

/** CrashStressTest.tsx — Market-Crash Stress Test (computeCrashStress). */
const crash: CalcBody = {
  inputs: [
    { key: "monthlySip", label: "Monthly SIP (₹)", type: "money", default: 25000 },
    { key: "lumpsum", label: "Initial lumpsum (₹)", type: "money", default: 0 },
    { key: "years", label: "Horizon (yrs)", type: "years", default: 20 },
    { key: "expectedReturnPct", label: "Expected return (%)", type: "percent", default: 12 },
    { key: "crashYear", label: "Crash hits in year", type: "int", default: 5 },
    { key: "crashPct", label: "Crash severity (% drop)", type: "percent", default: 40 },
    { key: "fdRatePct", label: "Panic-park rate (FD %)", type: "percent", default: 6 },
  ],
  compute: (v) => {
    const years = nn(v.years);
    const crashYear = nn(v.crashYear);
    const crashPct = nn(v.crashPct);
    const r = computeCrashStress({
      monthlySip: nn(v.monthlySip), lumpsum: nn(v.lumpsum), years, expectedReturnPct: nn(v.expectedReturnPct),
      crashYear, crashPct, fdRatePct: nn(v.fdRatePct),
    });
    const out: ResultBlock[] = [
      stat("Stayed invested", inr(r.finalStay), "success"),
      stat("No-crash baseline", inr(r.finalNoCrash)),
      stat("Panic-sold (→ FD)", inr(r.finalPanic), "danger"),
      stat("Cost of panic", inr(r.costOfPanic), "danger"),
    ];
    if (!r.crashInHorizon) {
      out.push(insight(`Year ${crashYear} is outside the ${years}-year horizon — no crash is modelled.`, "warning"));
    } else {
      const recovery = r.recoveryMonths != null
        ? `The market regains its pre-crash level in about ${Math.round((r.recoveryMonths / 12) * 10) / 10} years; `
        : "The market doesn't regain its pre-crash level within the horizon; ";
      const gap = r.gapToNoCrash > 0.5 ? ` (${inr(r.gapToNoCrash)} below the no-crash path)` : "";
      out.push(insight(`A ${fmtPct(Math.min(100, crashPct))} crash in year ${crashYear} wipes about ${inr(r.crashDropAmount)} off the corpus on paper. ${recovery}staying invested still reaches ${inr(r.finalStay)}${gap}. Panic-selling and parking in an FD instead would leave just ${inr(r.finalPanic)} — a ${inr(r.costOfPanic)} mistake.`, "success"));
    }
    out.push(
      section("1. Corpus path (year-by-year)"),
      table(
        ["Year", "Stayed invested", "No crash", "Panic-sold"],
        r.series.filter((p) => p.month % 12 === 0).map((p) => [`${p.month / 12}`, inr(p.stay), inr(p.noCrash), inr(p.panic)]),
      ),
      note("Illustration of behaviour, not a market forecast. Crashes and recoveries vary."),
    );
    return out;
  },
};

/** FireNumberCalculator.tsx — FIRE, Financial Independence Number (computeFire). */
const fire: CalcBody = {
  inputs: [
    { key: "currentAge", label: "Current age", type: "int", default: 32 },
    { key: "monthlyExpenseNow", label: "Monthly expenses now (₹)", type: "money", default: 80000 },
    { key: "currentCorpus", label: "Current corpus (₹)", type: "money", default: 2000000 },
    { key: "monthlySip", label: "Monthly SIP (₹)", type: "money", default: 50000 },
    { key: "sipStepUpPct", label: "SIP step-up (%/yr)", type: "percent", default: 8 },
    { key: "preReturnPct", label: "Pre-FI return (%)", type: "percent", default: 12 },
    { key: "postReturnPct", label: "Post-FI return (%)", type: "percent", default: 8 },
    { key: "inflationPct", label: "Inflation (%)", type: "percent", default: 6 },
    { key: "swrPct", label: "Safe withdrawal rate (%)", type: "percent", default: 4 },
    { key: "lifeExpectancy", label: "Life expectancy", type: "int", default: 90 },
  ],
  compute: (v) => {
    const swrPct = nn(v.swrPct);
    const postReturnPct = nn(v.postReturnPct);
    const lifeExpectancy = nn(v.lifeExpectancy);
    const r = computeFire({
      currentAge: nn(v.currentAge), monthlyExpenseNow: nn(v.monthlyExpenseNow), inflationPct: nn(v.inflationPct),
      preReturnPct: nn(v.preReturnPct), postReturnPct, currentCorpus: nn(v.currentCorpus), monthlySip: nn(v.monthlySip),
      sipStepUpPct: nn(v.sipStepUpPct), swrPct, lifeExpectancy,
    });
    const out: ResultBlock[] = [
      stat("FIRE number (today's terms)", swrPct > 0 ? inr(r.fireNumberToday) : "—", "brand"),
      stat("Financial-independence age", r.fireAge != null ? `${r.fireAge}` : "Beyond horizon", r.fireAge != null ? "success" : "danger"),
      stat("Years to FI", r.yearsToFire != null ? `${r.yearsToFire} yrs` : "—"),
      stat("Corpus needed at FI", r.fireCorpus != null ? inr(r.fireCorpus) : "—"),
    ];
    if (r.fireAge != null) {
      const tail = r.sustainsToLifeExpectancy
        ? ` This corpus sustains inflation-rising expenses all the way to age ${lifeExpectancy}.`
        : ` ⚠ At ${fmtPct(postReturnPct)} post-FI return, expenses outpace the corpus around age ${r.shortfallAge} — consider a lower SWR, longer accumulation, or a larger corpus.`;
      out.push(insight(`On the current plan, your client reaches financial independence at age ${r.fireAge} (${r.yearsToFire} years away) with a corpus of ${inr(r.corpusAtFire ?? 0)} — enough to draw ${fmtPct(swrPct)}/yr for living costs.${tail}`, r.sustainsToLifeExpectancy ? "success" : "warning"));
    } else {
      out.push(insight(`The current savings plan doesn't reach financial independence within the horizon to age ${lifeExpectancy}. Increasing the SIP, the step-up, or the return assumption brings the FI age into reach.`, "danger"));
    }
    out.push(note("SWR rule is a planning heuristic; sequence-of-returns risk and taxes can change outcomes."));
    return out;
  },
};

/* ─────────────────────────── Smart Decisions ─────────────────────────── */

/** PrepayVsInvestCalculator.tsx — Loan Prepay vs Invest (prepayVsInvest). */
const prepayinvest: CalcBody = {
  inputs: [
    { key: "outstanding", label: "Loan outstanding (₹)", type: "money", default: 5000000 },
    { key: "loanRate", label: "Loan rate (% p.a.)", type: "percent", default: 8.5 },
    { key: "remainingYears", label: "Remaining tenure (yrs)", type: "years", default: 15 },
    { key: "surplus", label: "Monthly surplus (₹)", type: "money", default: 20000 },
    { key: "investReturn", label: "Expected investment return (% p.a.)", type: "percent", default: 12 },
  ],
  compute: (v) => {
    const loanRate = nn(v.loanRate);
    const investReturn = nn(v.investReturn);
    const res = prepayVsInvest({
      outstanding: nn(v.outstanding), loanRatePct: loanRate, remainingMonths: Math.round(nn(v.remainingYears) * 12),
      surplusMonthly: nn(v.surplus), investReturnPct: investReturn,
    });
    let verdict = res.winner === "tie"
      ? "Prepaying and investing end level at the loan’s original end-date."
      : `${res.winner === "invest" ? "Investing the surplus" : "Prepaying the loan"} wins by ${inrShort(res.gap)} at the loan’s original end-date.`;
    if (res.interestSaved > 0) {
      const yrs = Math.round(res.monthsSaved / 12);
      const early = res.monthsSaved < 12
        ? `${res.monthsSaved} month${res.monthsSaved === 1 ? "" : "s"}`
        : `${yrs} yr${yrs === 1 ? "" : "s"}`;
      verdict += ` Prepaying still saves ${inrShort(res.interestSaved)} in interest and closes the loan ${early} early.`;
    }
    return [
      stat("Loan EMI", `${inr(Math.round(res.emi))}/mo`, "brand"),
      stat("Prepay → final corpus", inr(Math.round(res.prepayCorpus)), res.winner === "prepay" ? "success" : undefined),
      stat("Invest → final corpus", inr(Math.round(res.investCorpus)), res.winner === "invest" ? "success" : undefined),
      insight(verdict, "success"),
      insight(`Prepaying is a guaranteed, risk-free ${loanRate}% return and removes debt stress; investing targets a higher but not guaranteed ${investReturn}%. The maths favours investing only if returns hold and the client stays the course.`, "warning"),
    ];
  },
};

/** BtidCalculator.tsx — Term + MF vs ULIP / Endowment (advisory.ts btid). */
const btid: CalcBody = {
  inputs: [
    { key: "annualBudget", label: "Yearly budget (₹)", type: "money", default: 100000 },
    { key: "termPremium", label: "Term plan premium / yr (₹)", type: "money", default: 15000 },
    { key: "termCover", label: "Term cover (₹)", type: "money", default: 10000000 },
    { key: "years", label: "Horizon (yrs)", type: "years", default: 25 },
    { key: "mfReturn", label: "MF return (% p.a.)", type: "percent", default: 12 },
    { key: "tradReturn", label: "ULIP/endowment return (% p.a.)", type: "percent", default: 5.5 },
  ],
  compute: (v) => {
    const annualBudget = nn(v.annualBudget);
    const res = btidCalc({
      annualBudget, termAnnualPremium: nn(v.termPremium), termCover: nn(v.termCover), years: nn(v.years),
      mfReturnPct: nn(v.mfReturn), tradReturnPct: nn(v.tradReturn),
    });
    const mfAhead = res.wealthGap >= 0;
    const coverAhead = res.coverGap >= 0;
    return [
      stat("Term + MF — corpus (post-tax)", inr(Math.round(res.btidPostTax)), mfAhead ? "success" : "warning"),
      stat("Traditional — corpus", inr(Math.round(res.tradPostTax)), mfAhead ? "warning" : "success"),
      stat("Term + MF — cover", inrShort(res.btidCover), coverAhead ? "success" : "danger"),
      stat("Traditional — cover", inrShort(res.tradCover), coverAhead ? "danger" : "success"),
      insight(`For the same ${inr(annualBudget)}/year, Term + MF builds ${inrShort(res.btidPostTax)} after LTCG with ${inrShort(res.btidCover)} cover — versus ${inrShort(res.tradPostTax)} and ${inrShort(res.tradCover)} cover from a bundled policy. That’s ${inrShort(Math.abs(res.wealthGap))} ${mfAhead ? "more" : "less"} wealth and ${inrShort(Math.abs(res.coverGap))} ${coverAhead ? "more" : "less"} protection.${mfAhead && coverAhead ? " Insurance and investment do their jobs best when kept separate." : ""}`, mfAhead && coverAhead ? "success" : "warning"),
      note(res.ulipTaxFree
        ? "ULIP maturity tax-free only while the annual premium is ≤ ₹2.5 L."
        : "Premium above ₹2.5 L/yr: ULIP gains taxed as LTCG too."),
    ];
  },
};

/** NpsVsMfCalculator.tsx — NPS vs Mutual Fund (npsVsMf). */
const npsvsmf: CalcBody = {
  inputs: [
    { key: "monthly", label: "Monthly contribution (₹)", type: "money", default: 10000 },
    { key: "years", label: "Years to 60", type: "years", default: 25 },
    { key: "npsReturn", label: "NPS return (% p.a.)", type: "percent", default: 9 },
    { key: "mfReturn", label: "MF return (% p.a.)", type: "percent", default: 12 },
    { key: "annuityRate", label: "Annuity rate (% p.a.)", type: "percent", default: 6 },
    { key: "taxSlab", label: "Your tax slab (%)", type: "percent", default: 30 },
  ],
  compute: (v) => {
    const annuityRate = nn(v.annuityRate);
    const res = npsVsMf({
      monthly: nn(v.monthly), years: nn(v.years), npsReturnPct: nn(v.npsReturn), mfReturnPct: nn(v.mfReturn),
      annuityRatePct: annuityRate, taxSlabPct: nn(v.taxSlab),
    });
    return [
      stat("NPS corpus @ 60", inr(Math.round(res.npsCorpus)), "brand"),
      stat("MF corpus @ 60", inr(Math.round(res.mfCorpus)), "success"),
      stat("NPS lump (60%)", inr(Math.round(res.npsLumpsum))),
      stat("NPS pension / mo (post-tax)", inr(Math.round(res.npsMonthlyPensionPostTax)), "warning"),
      insight(`MF grows to ${inrShort(res.mfCorpus)} — fully liquid — vs NPS’s ${inrShort(res.npsCorpus)}, of which only 60% (${inrShort(res.npsLumpsum)}) is withdrawable and the rest buys a ${annuityRate}% annuity ≈ ${inr(Math.round(res.npsMonthlyPensionPostTax))}/mo pension after tax at your slab. NPS adds an extra ${inr(Math.round(res.annualNpsTaxSaved))}/yr tax saving via 80CCD(1B) (old regime only). Best of both: NPS for the tax break, MFs for the flexible bulk.`, "success"),
      insight("Illustration only. NPS rules (40% annuity, tax treatment) and annuity rates change; equity-MF gains attract LTCG tax on withdrawal.", "warning"),
    ];
  },
};

/** HousingEmiSipCalculator.tsx — EMI → SIP, Home-Buying Wealth Strategy
 *  (housingEmiSip). Each strategy card is a tile: its wealth, then the card's
 *  "vs paying off early", income-for-life and note lines. */
const vsPayoff = (pct: number) => `${Math.abs(pct * 100).toFixed(0)}% ${pct < 0 ? "less" : "more"}`;
const housingstrategy: CalcBody = {
  inputs: [
    { key: "loan", label: "Home / loan amount (₹)", type: "money", default: 25000000 },
    { key: "loanRate", label: "Loan rate (% p.a.)", type: "percent", default: 9 },
    { key: "tenure", label: "Tenure (years)", type: "years", default: 20 },
    { key: "escalation", label: "Property escalation (% p.a.)", type: "percent", default: 6 },
    { key: "sipReturn", label: "Equity SIP return (% p.a.)", type: "percent", default: 15 },
    { key: "sipGrowth", label: "SIP step-up (% p.a.)", type: "percent", default: 10 },
    { key: "rentYield", label: "Rental yield (%)", type: "percent", default: 4 },
    { key: "rentGrowth", label: "Rent growth (% p.a.)", type: "percent", default: 10 },
  ],
  compute: (v) => {
    const loanRate = nn(v.loanRate);
    const sipReturn = nn(v.sipReturn);
    const sipGrowth = nn(v.sipGrowth);
    const res = housingEmiSip({
      loan: nn(v.loan), loanRatePct: loanRate, tenureYears: nn(v.tenure), escalationPct: nn(v.escalation),
      sipReturnPct: sipReturn, sipGrowthPct: sipGrowth, rentYieldPct: nn(v.rentYield), rentGrowthPct: nn(v.rentGrowth),
    });
    const best = res.strategies.find((s) => s.key === res.bestKey)!;
    return [
      insight(`Monthly outgo across all three: ${inr(Math.round(res.emiMonthly * 2))}/mo in year 1 (EMI ${inr(Math.round(res.emiMonthly))} + SIP of the same, stepping up ${sipGrowth}%/yr)`, "success"),
      ...res.strategies.map((s) => {
        const isBest = s.key === res.bestKey;
        return stat(
          isBest ? `${s.label} (best)` : s.label,
          inrShort(s.wealth),
          isBest ? "success" : undefined,
          [
            s.key === "payoff" ? "wealth created" : `${vsPayoff(s.incrementalPct)} than paying off early`,
            `≈ ${inrShort(s.monthlyIncome)}/mo income for life`,
            s.note,
          ].join("\n"),
        );
      }),
      stat("Home cost at end of tenure", inrShort(res.houseCostAtEnd), "warning"),
      stat("Total rent paid (rent route)", inrShort(res.totalRentPaid), "danger"),
      stat("Loan cleared early in", `${res.loanOverYear} yrs`, "brand"),
      insight(`On the same cashflow, ${best.label.toLowerCase()} builds the most — ${inrShort(best.wealth)}${best.key !== "payoff" ? ` (${vsPayoff(best.incrementalPct)} than paying the loan off early)` : ""}, worth ~${inrShort(best.monthlyIncome)}/month of income for life — equity at ${sipReturn}% against a ${loanRate}% loan.`, "success"),
      insight("Illustration only. Equity returns are market-linked and not guaranteed; renting forgoes the security & forced-savings of owning, and assumes the EMI-equivalent is invested every month without fail. Tax benefit modelled at 30% of interest (capped ₹60k/yr).", "warning"),
    ];
  },
};

export const DEFS: Record<string, CalcBody> = {
  crash, fire, prepayinvest, btid, npsvsmf, housingstrategy,
};
