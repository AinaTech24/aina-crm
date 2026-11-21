/**
 * Insurance & Protection and Tax — mirrors the two web groups of those names
 * (src/components/calculators/*, maths in ./web). Labels, figures and the
 * order of results follow the web component named on each def.
 */

import type { CalcBody, InputSpec, ResultBlock, Tone } from "../types";
import { inr, fmtPct, yearsMonths } from "../fmt";
import { computeInsuranceIrr, type Payout, type PayoutMode } from "../web/insurance-irr";
import { computeSurrenderAnalysis, ALT_OPTIONS, type AltOption } from "../web/surrender-analysis";
import { computeIncomeReplacement, computeNeedAnalysis, type CoverBasis } from "../web/hlv";
import { termPlusSip, termPlusSipGoal, insuranceVsTermSip, type TermSipRow } from "../web/term-plus-sip";
import { compareRegimes } from "../web/tax-regime";
import { computeRealReturns, type Instrument } from "../web/real-return";
import { computeNps } from "../web/nps";
import { computeTaxHarvesting } from "../web/tax-harvesting";
import { computeCapitalGains, CII, fyLabel, type AcquisitionBasis, type AssetType, type Improvement } from "../web/capital-gains";
import { capitalGainsBondVsOthers, type CgBondColumn } from "../web/capital-gains-bond";
import { ciiTable, indexCost, latestCiiYear } from "../web/cii";
import { stat, section, table, insight, note, opts } from "./shared";

/** The web's clampNum: a non-negative finite number, 0 on garbage. */
const nn = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/* ═══════════════════════ Insurance & Protection ═══════════════════════ */

/**
 * InsuranceReturnAnalyzer.tsx — Insurance Return Analyzer (computeInsuranceIrr).
 * The web's add / remove payout list is ten fixed slots, the web's three rows
 * pre-filled; a slot with no amount is unused (the module drops it), and the
 * next slot appears once the one before it has an amount.
 */
const PAYOUT_SLOTS = 10;
const PAYOUT_DEFAULTS: Payout[] = [
  { year: 4, amount: 50000 },
  { year: 8, amount: 50000 },
  { year: 12, amount: 50000 },
];
const insurance: CalcBody = {
  inputs: [
    { key: "policyName", label: "Policy name (optional)", type: "text", default: "", placeholder: "e.g. Guaranteed Plan" },
    { key: "currentAge", label: "Current age (optional)", type: "years", default: 38 },
    { key: "annualPremium", label: "Annual premium (₹)", type: "money", default: 100000 },
    { key: "premiumPaymentTerm", label: "Premium payment term (yrs)", type: "years", default: 10 },
    { key: "policyTerm", label: "Policy term (yrs)", type: "years", default: 15 },
    { key: "maturityAmount", label: "Expected maturity amount (₹)", type: "money", default: 1750000 },
    { key: "payoutMode", label: "Payout mode", type: "segmented", default: "maturity", options: opts([["maturity", "Maturity only"], ["periodic", "Periodic"], ["annuity", "Annuity"]]) },
    ...Array.from({ length: PAYOUT_SLOTS }, (_, i): InputSpec[] => {
      const n = i + 1;
      // The web's "+ Add payout" puts a new row 4 years after the last one.
      const year = PAYOUT_DEFAULTS[i]?.year ?? 12 + 4 * (i - 2);
      const shown = (v: Record<string, any>) =>
        v.payoutMode !== "maturity" && (n === 1 || nn(v[`payout${n - 1}Amount`]) > 0 || nn(v[`payout${n}Amount`]) > 0);
      return [
        {
          key: `payout${n}Year`, label: `Payout ${n} — year`, type: "years", default: year, visibleIf: shown,
          ...(n === 1
            ? { section: "Payout details (year & amount)", hint: "For an annuity, add one row per annuity year (year + amount received). An amount of 0 drops the payout." }
            : {}),
        },
        { key: `payout${n}Amount`, label: `Payout ${n} — amount (₹)`, type: "money", default: PAYOUT_DEFAULTS[i]?.amount ?? 0, visibleIf: shown },
      ];
    }).flat(),
    { key: "showMfCompare", label: "Add mutual fund comparison", type: "toggle", default: true },
    { key: "showMfMaturity", label: "Show MF maturity value", type: "toggle", default: true },
    { key: "expectedReturnPct", label: "Expected MF return (%)", type: "percent", default: 12 },
  ],
  compute: (v) => {
    const annualPremium = nn(v.annualPremium);
    const premiumPaymentTerm = nn(v.premiumPaymentTerm);
    const expectedReturnPct = nn(v.expectedReturnPct);
    const payoutMode = (["maturity", "periodic", "annuity"].includes(v.payoutMode) ? v.payoutMode : "maturity") as PayoutMode;
    const payouts: Payout[] = Array.from({ length: PAYOUT_SLOTS }, (_, i) => ({
      year: nn(v[`payout${i + 1}Year`]),
      amount: nn(v[`payout${i + 1}Amount`]),
    }));
    const result = computeInsuranceIrr({
      annualPremium, premiumPaymentTerm, policyTerm: nn(v.policyTerm), payoutMode,
      payouts, maturityAmount: nn(v.maturityAmount), expectedReturnPct,
    });
    const showMfCompare = !!v.showMfCompare;
    const irrTone: Tone =
      result.irrPct == null ? "warning" : result.irrPct < 6 ? "danger" : result.irrPct < 9 ? "warning" : "success";
    const ppt = Math.max(0, Math.round(premiumPaymentTerm));
    const policyName = String(v.policyName ?? "");

    const out: ResultBlock[] = [];
    if (policyName) out.push(section(policyName));
    out.push(
      stat("Total premiums", inr(result.totalPremiums)),
      stat("Total benefit", inr(result.totalBenefit)),
      stat("Net gain", inr(result.netGain)),
      stat("Policy IRR", result.irrPct == null ? "—" : `${result.irrPct.toFixed(2)}%`, irrTone),
    );
    if (result.irrPct != null) {
      out.push(insight(
        `This policy returns ${result.irrPct.toFixed(2)}% IRR` +
          (result.irrPct < expectedReturnPct
            ? ` — below the ${fmtPct(expectedReturnPct)} a mutual fund is assumed to deliver, and likely below long-term inflation.`
            : ` — competitive with the ${fmtPct(expectedReturnPct)} assumed for mutual funds.`),
        irrTone,
      ));
    }
    if (showMfCompare) {
      out.push(
        section(`1. Mutual fund comparison (same premiums @ ${fmtPct(expectedReturnPct)})`),
        table(
          ["Metric", "Insurance", "Mutual fund"],
          [
            [result.totalPayouts > 0 ? "Value at maturity (payouts reinvested)" : "Maturity / value", inr(result.benefitAtMaturity), inr(result.mfMaturity)],
            ["You invest", inr(result.totalPremiums), inr(result.totalPremiums)],
          ],
        ),
        insight(
          `The same premiums in a mutual fund could grow to ${inr(result.mfMaturity)}` +
            (result.mfWealthAdvantage > 0
              ? ` — about ${inr(result.mfWealthAdvantage)} more wealth${result.mfAdvantagePct != null ? ` (${Math.round(result.mfAdvantagePct)}% higher)` : ""}.`
              : ""),
          "success",
        ),
        insight(
          `To reach the same ${inr(result.benefitAtMaturity)} from a mutual fund, you'd only need to invest about ${inr(result.mfContributionToMatch)}/year — far less than the ${inr(annualPremium)} premium.`,
          "brand",
        ),
      );
    }
    out.push(
      section(`${showMfCompare ? 2 : 1}. Year-wise cash flows`),
      note("Premiums and investments are made at the start of each year; payouts and values are at the end of the year."),
      note("Policy"),
      table(
        ["Year", "Premium", "Payout"],
        result.policySchedule.map((r) => [`${r.year}`, r.premium > 0 ? inr(r.premium) : "—", r.payout > 0 ? inr(r.payout) : "—"]),
      ),
    );
    if (showMfCompare) {
      out.push(
        note(`MF for the same payout · ${inr(result.mfContributionRounded)}/yr × ${ppt} yrs`),
        table(
          ["Year", "Investment", "Value at year end"],
          result.mfMatchSchedule.map((r) => [`${r.year}`, r.investment > 0 ? inr(r.investment) : "—", inr(r.yearEndValue)]),
          true,
        ),
        note(`Same premium in an MF @ ${fmtPct(expectedReturnPct)}`),
        table(
          ["Year", "Investment", "Value at year end"],
          result.mfSameSchedule.map((r) => [`${r.year}`, r.investment > 0 ? inr(r.investment) : "—", inr(r.yearEndValue)]),
          true,
        ),
      );
    }
    if (v.showMfMaturity && !showMfCompare) {
      out.push(stat(`MF maturity value @ ${fmtPct(expectedReturnPct)}`, inr(result.mfMaturity), "success"));
    }
    return out;
  },
};

/**
 * SurrenderAnalyzer.tsx — Policy Surrender vs. Reinvest (computeSurrenderAnalysis).
 * Picking an alternate investment on the web resets the return to that option's
 * typical one; here each option keeps its own return field, pre-filled with the
 * typical return, and the picked option's field is shown.
 */
const altReturnKey = (o: string) => `altReturn_${o}`;
const surrender: CalcBody = {
  inputs: [
    { key: "policyName", label: "Policy name (optional)", type: "text", default: "", placeholder: "e.g. LIC Jeevan Anand" },
    { key: "currentSurrenderValue", label: "Current surrender value (₹)", type: "money", default: 480000 },
    { key: "policyYearsLeft", label: "No. of policy years left", type: "years", default: 15 },
    { key: "premiumYearsLeft", label: "No. of premium years left", type: "years", default: 10 },
    { key: "annualPremium", label: "Annual premium (₹)", type: "money", default: 50000 },
    { key: "expectedMaturityAmount", label: "Expected maturity amount (₹)", type: "money", default: 1250000 },
    { key: "altOption", label: "Alternate investment", type: "select", default: "equity_mf", options: ALT_OPTIONS.map((o) => ({ value: o.value, label: o.label })) },
    ...ALT_OPTIONS.map((o): InputSpec => ({
      key: altReturnKey(o.value), label: "Assumed return on alternate (% p.a.)", type: "percent", default: o.typicalReturn,
      visibleIf: (v) => (v.altOption ?? "equity_mf") === o.value,
    })),
    { key: "includeAnnuity", label: "Add future annuity payouts (if you continue)", type: "toggle", default: false },
    { key: "annuityStartYear", label: "Starts in year", type: "years", default: 1, visibleIf: (v) => !!v.includeAnnuity },
    { key: "annuityAnnualAmount", label: "Annual payout (₹)", type: "money", default: 0, visibleIf: (v) => !!v.includeAnnuity },
    { key: "annuityYears", label: "For how many years", type: "years", default: 0, visibleIf: (v) => !!v.includeAnnuity },
    { key: "includePeriodic", label: "Add periodic money-back payouts (if you continue)", type: "toggle", default: false },
    { key: "periodicEveryYears", label: "Every N years", type: "years", default: 5, visibleIf: (v) => !!v.includePeriodic },
    { key: "periodicAmount", label: "Payout amount (₹)", type: "money", default: 0, visibleIf: (v) => !!v.includePeriodic },
    { key: "periodicTimes", label: "Number of payouts", type: "int", default: 0, visibleIf: (v) => !!v.includePeriodic },
  ],
  compute: (v) => {
    const altOption = (ALT_OPTIONS.some((o) => o.value === v.altOption) ? v.altOption : "equity_mf") as AltOption;
    const altReturnPct = nn(v[altReturnKey(altOption)]);
    const currentSurrenderValue = nn(v.currentSurrenderValue);
    const result = computeSurrenderAnalysis({
      policyName: String(v.policyName ?? ""),
      currentSurrenderValue,
      policyYearsLeft: nn(v.policyYearsLeft),
      premiumYearsLeft: nn(v.premiumYearsLeft),
      annualPremium: nn(v.annualPremium),
      expectedMaturityAmount: nn(v.expectedMaturityAmount),
      altOption,
      altReturnPct,
      includeAnnuity: !!v.includeAnnuity,
      annuityStartYear: nn(v.annuityStartYear),
      annuityAnnualAmount: nn(v.annuityAnnualAmount),
      annuityYears: nn(v.annuityYears),
      includePeriodic: !!v.includePeriodic,
      periodicEveryYears: nn(v.periodicEveryYears),
      periodicAmount: nn(v.periodicAmount),
      periodicTimes: nn(v.periodicTimes),
    });
    const altLabel = ALT_OPTIONS.find((o) => o.value === altOption)?.label;

    const out: ResultBlock[] = [
      section("If you CONTINUE the policy"),
      stat("Current surrender value (kept in)", inr(currentSurrenderValue)),
      stat("Future premiums to pay", inr(result.futurePremiumsPaid)),
      ...(result.totalPayouts > 0 ? [stat("Money-back / annuity payouts", inr(result.totalPayouts))] : []),
      stat("Expected payout + maturity", inr(result.expectedPayoutAndMaturity), "warning"),
      stat("Incremental return", inr(result.incrementalReturn)),
      stat("Effective policy IRR", result.policyIrrPct == null ? "—" : `${result.policyIrrPct.toFixed(2)}%`, "warning"),
      section("If you SURRENDER & invest"),
      stat("Surrender value invested (lumpsum)", inr(currentSurrenderValue)),
      stat("Premiums invested instead", inr(result.futurePremiumsPaid)),
      stat(`Assumed return (${altLabel})`, `${altReturnPct.toFixed(2)}%`),
      stat("Expected value at the end", inr(result.expectedValueAtEnd), "success"),
      stat("Total return", inr(result.totalReturn), "success"),
    ];
    out.push(
      result.surrenderIsBetter
        ? insight(
            `On these numbers, surrendering & investing could grow to ${inr(result.expectedValueAtEnd)} —` +
              (result.expectedPayoutAndMaturity > 0
                ? ` about ${result.multipleVsMaturity.toFixed(1)}× the policy's ${inr(result.expectedPayoutAndMaturity)},`
                : "") +
              ` a difference of ${inr(result.advantageOfSurrender)}.` +
              (result.policyIrrPct != null ? ` The policy's own return is just ${result.policyIrrPct.toFixed(2)}% p.a.` : ""),
            "success",
          )
        : insight(
            `On these numbers, continuing the policy (${inr(result.expectedPayoutAndMaturity)}) is ahead of surrendering & investing (${inr(result.expectedValueAtEnd)}) at the assumed ${altReturnPct.toFixed(1)}% return.`,
            "warning",
          ),
      insight(
        "⚠️ Before surrendering: a policy also provides life cover you would lose. Insurance is for protection; investments are for growth. If you surrender, consider a pure term plan for the cover, and check surrender charges, guarantees and tax before deciding.",
        "brand",
      ),
      note("* Illustration only, on the assumptions you enter. Endowment maturity is typically guaranteed/bonus-based while market investments carry risk and are not guaranteed. This is not investment advice — review the policy document and consult a qualified advisor."),
    );
    return out;
  },
};

/** HumanLifeValueCalculator.tsx — Human Life Value (computeIncomeReplacement / computeNeedAnalysis). */
const isIr = (v: Record<string, any>) => v.method !== "need_analysis";
const isNa = (v: Record<string, any>) => v.method === "need_analysis";
const hlv: CalcBody = {
  inputs: [
    { key: "method", label: "Method", type: "segmented", default: "income_replacement", options: opts([["income_replacement", "Income Replacement"], ["need_analysis", "Need Analysis"]]) },
    // Income Replacement
    { key: "currentAge", label: "Current age (yrs)", type: "years", default: 30, visibleIf: isIr },
    { key: "retirementAge", label: "Retirement age (yrs)", type: "years", default: 60, visibleIf: isIr },
    { key: "currentAnnualIncome", label: "Current annual income (₹)", type: "money", default: 1800000, visibleIf: isIr },
    { key: "annualPersonalExpenses", label: "Annual personal expenses (₹)", type: "money", default: 300000, visibleIf: isIr },
    { key: "incrementPct", label: "Expected annual increment (%)", type: "percent", default: 8, visibleIf: isIr },
    { key: "discountPct", label: "Discounting rate (%)", type: "percent", default: 6, visibleIf: isIr },
    { key: "existingCover", label: "Existing life cover (₹)", type: "money", default: 10000000, visibleIf: isIr },
    // Net of own expenses is the standard income-replacement basis (reference:
    // ₹18 L income − ₹3 L expenses → ₹5,64,00,788); gross is an option.
    { key: "basis", label: "Cover basis", type: "segmented", default: "net", options: opts([["net", "Net of own expenses"], ["gross", "Replace gross income"]]), visibleIf: isIr },
    // Need Analysis
    { key: "outstandingLiabilities", label: "Outstanding liabilities / loans (₹)", type: "money", default: 5000000, visibleIf: isNa },
    { key: "futureGoals", label: "Future goals — education/marriage (₹)", type: "money", default: 5000000, visibleIf: isNa },
    { key: "familyAnnualNeed", label: "Family annual expense need (₹)", type: "money", default: 800000, visibleIf: isNa },
    { key: "yearsOfSupport", label: "Years of support needed", type: "years", default: 25, visibleIf: isNa },
    { key: "naIncrementPct", label: "Expense inflation (%)", type: "percent", default: 6, visibleIf: isNa },
    { key: "naDiscountPct", label: "Discounting rate (%)", type: "percent", default: 7, visibleIf: isNa },
    { key: "existingAssets", label: "Existing assets / savings (₹)", type: "money", default: 3000000, visibleIf: isNa },
    { key: "naExistingCover", label: "Existing life cover (₹)", type: "money", default: 10000000, visibleIf: isNa },
  ],
  compute: (v) => {
    if (isIr(v)) {
      const incrementPct = nn(v.incrementPct);
      const discountPct = nn(v.discountPct);
      const existingCover = nn(v.existingCover);
      const ir = computeIncomeReplacement({
        currentAge: nn(v.currentAge), retirementAge: nn(v.retirementAge), discountPct,
        currentAnnualIncome: nn(v.currentAnnualIncome), annualPersonalExpenses: nn(v.annualPersonalExpenses), incrementPct, existingCover,
      });
      const basis: CoverBasis = v.basis === "gross" ? "gross" : "net";
      const hlvValue = basis === "gross" ? ir.hlvGross : ir.hlvNet;
      const additional = basis === "gross" ? ir.additionalGross : ir.additionalNet;
      return [
        stat("PV of future income", inr(ir.pvIncome)),
        stat("PV of own expenses", inr(ir.pvExpenses)),
        stat(`Human Life Value (${basis})`, inr(hlvValue), "brand"),
        stat("Additional cover required", inr(additional), "success"),
        table(
          ["Component", "Amount"],
          [
            [`PV of future income (${fmtPct(incrementPct)} increment, ${fmtPct(discountPct)} discount, ${ir.years} yrs)`, inr(ir.pvIncome)],
            ["Less: PV of own personal expenses", `(${inr(ir.pvExpenses)})`],
            ["Human Life Value — net of self-expenses", inr(ir.hlvNet)],
            ["Human Life Value — gross income", inr(ir.hlvGross)],
            ["Less: existing life cover", `(${inr(existingCover)})`],
            [`Additional term cover required (${basis})`, inr(additional)],
          ],
        ),
        insight(
          `On a ${basis === "gross" ? "gross-income" : "net-of-expenses"} basis, the client needs about ${inr(hlvValue)} of life cover; with ${inr(existingCover)} already in force, that's ${inr(additional)} of additional term cover.`,
          "brand",
        ),
      ];
    }
    const outstandingLiabilities = nn(v.outstandingLiabilities);
    const futureGoals = nn(v.futureGoals);
    const yearsOfSupport = nn(v.yearsOfSupport);
    const na = computeNeedAnalysis({
      outstandingLiabilities, futureGoals, familyAnnualNeed: nn(v.familyAnnualNeed), yearsOfSupport,
      incrementPct: nn(v.naIncrementPct), discountPct: nn(v.naDiscountPct), existingAssets: nn(v.existingAssets), existingCover: nn(v.naExistingCover),
    });
    return [
      section("✓ Cover required (Need Analysis)"),
      table(
        ["Component", "Amount"],
        [
          ["Outstanding liabilities", inr(outstandingLiabilities)],
          ["Future goals (education / marriage)", inr(futureGoals)],
          [`PV of family's ongoing expenses (${yearsOfSupport} yrs)`, inr(na.pvFamilyNeed)],
          ["Total need", inr(na.totalNeed)],
          ["Less: existing assets + cover", `(${inr(na.offsets)})`],
          ["Cover required", inr(na.coverRequired)],
        ],
      ),
      insight(
        `By the needs approach, the family requires about ${inr(na.totalNeed)}; after existing assets and cover (${inr(na.offsets)}), a further ${inr(na.coverRequired)} of cover is needed.`,
        "success",
      ),
    ];
  },
};

/**
 * TermPlusSipCalculator.tsx — Term Insurance + SIP (termPlusSip / termPlusSipGoal /
 * insuranceVsTermSip). The web's cover field is relabelled "Cover = goal amount"
 * in the goal view; a label here is fixed, so the goal view has its own field
 * (same default).
 */
const termsip: CalcBody = {
  inputs: [
    { key: "mode", label: "Start from", type: "segmented", default: "budget", options: opts([["budget", "A yearly budget"], ["goal", "A goal (need based)"], ["policy", "Compare with a policy"]]) },
    { key: "age", label: "Current age (yrs)", type: "years", default: 30, visibleIf: (v) => v.mode !== "policy" },
    { key: "annualOutlay", label: "Yearly budget — premium + SIP (₹)", type: "money", default: 400000, visibleIf: (v) => v.mode === "budget" },
    { key: "sumAssured", label: "Term cover (₹)", type: "money", default: 10000000, visibleIf: (v) => v.mode === "budget" },
    { key: "goalAmount", label: "Cover = goal amount (₹)", type: "money", default: 10000000, visibleIf: (v) => v.mode === "goal" },
    { key: "termYears", label: "Term period (yrs)", type: "years", default: 30, visibleIf: (v) => v.mode !== "policy" },
    { key: "premium", label: "Term premium per year (₹)", type: "money", default: 10000, visibleIf: (v) => v.mode !== "policy" },
    { key: "returnPct", label: "Expected SIP return (%)", type: "percent", default: 12, visibleIf: (v) => v.mode !== "policy" },
    { key: "policyPremium", label: "Policy premium per year (₹)", type: "money", default: 500000, visibleIf: (v) => v.mode === "policy" },
    { key: "policyCover", label: "Sum assured / death benefit (₹)", type: "money", default: 5000000, visibleIf: (v) => v.mode === "policy" },
    { key: "policyYears", label: "Policy term (yrs)", type: "years", default: 20, visibleIf: (v) => v.mode === "policy" },
    { key: "policyRatePct", label: "Expected return on the policy (%)", type: "percent", default: 7, visibleIf: (v) => v.mode === "policy" },
    { key: "termPremium", label: "Term premium for the same cover (₹/yr)", type: "money", default: 15000, visibleIf: (v) => v.mode === "policy" },
    { key: "sipRatePct", label: "Expected SIP return (%)", type: "percent", default: 12, visibleIf: (v) => v.mode === "policy" },
  ],
  compute: (v) => {
    const mode = v.mode === "goal" || v.mode === "policy" ? v.mode : "budget";
    const out: ResultBlock[] = [];
    if (mode !== "policy") {
      const age = nn(v.age);
      const termYears = nn(v.termYears);
      const premium = nn(v.premium);
      const returnPct = nn(v.returnPct);
      const sumAssured = nn(mode === "goal" ? v.goalAmount : v.sumAssured);
      let rows: TermSipRow[];
      let finalAge: number;
      if (mode === "budget") {
        const annualOutlay = nn(v.annualOutlay);
        const budget = termPlusSip({ age, annualOutlay, sumAssured, termYears, premium, returnPct });
        rows = budget.rows;
        finalAge = budget.finalAge;
        out.push(
          stat("Left for SIP each year", inr(budget.balanceForSip)),
          stat("Monthly SIP", inr(budget.sipMonthly), "brand"),
          stat(`Fund at age ${budget.finalAge}`, inr(budget.finalValue), "success"),
          stat("Cover throughout", inr(sumAssured)),
        );
        if (premium >= annualOutlay) out.push(insight("The premium uses the whole budget, so nothing is left to invest.", "warning"));
        if (budget.finalValue > 0) {
          out.push(insight(
            `Of the ${inr(annualOutlay)} a year, ${inr(premium)} buys ${inr(sumAssured)} of cover and ${inr(budget.sipMonthly)}/month goes into a SIP that could reach ${inr(budget.finalValue)} by age ${budget.finalAge} at ${fmtPct(returnPct)}. If the worst happens in between, the family receives the cover plus the fund built so far.`,
            "brand",
          ));
        }
      } else {
        const goal = termPlusSipGoal({ age, goal: sumAssured, termYears, premium, returnPct });
        rows = goal.rows;
        finalAge = goal.finalAge;
        out.push(
          stat(`Monthly SIP needed @ ${fmtPct(returnPct)}`, inr(goal.sipMonthly), "brand"),
          stat(`Or one-time lumpsum today @ ${fmtPct(returnPct)}`, inr(goal.lumpsumToday)),
          stat("Yearly outlay (premium + SIP)", inr(goal.annualOutlay)),
          stat(`Minimum payout, alive at ${goal.finalAge} or not`, inr(sumAssured), "success"),
        );
        if (goal.sipMonthly > 0) {
          out.push(insight(
            `A ${inr(sumAssured)} term plan plus a SIP of ${inr(goal.sipMonthly)}/month means at least ${inr(sumAssured)} for the family either way: as the SIP fund at age ${goal.finalAge}, or as the cover (plus whatever the SIP has built) earlier — subject to the SIP earning ${fmtPct(returnPct)}. A one-time lumpsum of ${inr(goal.lumpsumToday)} invested today instead of the SIP reaches the same ${inr(sumAssured)} by age ${goal.finalAge}.`,
            "brand",
          ));
        }
      }
      if (rows.length > 0) {
        out.push(
          section(`1. Year by year to age ${finalAge}`),
          table(
            ["Age", mode === "goal" ? "Yearly investment" : "Yearly budget", "Life cover", "SIP fund at year end", "Payout on death"],
            rows.map((r) => [`${r.age}`, inr(r.annualOutlay), inr(r.cover), inr(r.sipValue), inr(r.payout)]),
            true,
          ),
        );
      }
    } else {
      const policyPremium = nn(v.policyPremium);
      const policyCover = nn(v.policyCover);
      const policyYears = nn(v.policyYears);
      const policyRatePct = nn(v.policyRatePct);
      const termPremium = nn(v.termPremium);
      const sipRatePct = nn(v.sipRatePct);
      const policy = insuranceVsTermSip({
        premium: policyPremium, sumAssured: policyCover, years: policyYears,
        termPremium, sipRatePct, insuranceRatePct: policyRatePct,
      });
      out.push(
        stat("Policy maturity value", inr(policy.maturity), "warning"),
        stat("Monthly SIP (premium − term) ÷ 12", inr(policy.monthlySip), "brand"),
        stat("Term + SIP fund value", inr(policy.fundValue), "success"),
        stat("Difference", inr(policy.difference)),
        section("1. The two routes, same yearly outlay"),
        table(
          ["", "Traditional policy", "Term cover + SIP"],
          [
            ["Yearly outlay", inr(policyPremium), inr(policyPremium)],
            ["Life cover", inr(policyCover), inr(policyCover)],
            ["Term premium", "—", inr(termPremium)],
            ["Monthly SIP", "—", inr(policy.monthlySip)],
            ["Period (yrs)", `${policyYears}`, `${policyYears}`],
            ["Assumed return", fmtPct(policyRatePct), fmtPct(sipRatePct)],
            ["Expected value at the end", inr(policy.maturity), inr(policy.fundValue)],
          ],
          true,
        ),
      );
      if (policy.difference !== 0) {
        out.push(insight(
          `For the same ${inr(policyPremium)} a year and the same ${inr(policyCover)} of cover, the term-plus-SIP route could end with ${inr(Math.abs(policy.difference))} ${policy.difference > 0 ? "more" : "less"} than the policy after ${policyYears} years.`,
          policy.difference > 0 ? "success" : "warning",
        ));
      }
    }
    out.push(note("* Illustration only. The SIP is invested at the start of each month and compounds at the assumed yearly return; the premium stays level for the term. Figures are before tax. Returns are neither indicative nor guaranteed. Not investment advice."));
    return out;
  },
};

/* ═══════════════════════════════ Tax ═══════════════════════════════ */

/** TaxRegimeOptimizer.tsx — Old vs New Tax Regime (compareRegimes). */
const taxregime: CalcBody = {
  inputs: [
    { key: "grossIncome", label: "Gross annual income (₹)", type: "money", default: 1500000 },
    { key: "isSalaried", label: "Salaried (standard deduction)", type: "toggle", default: true },
    { key: "employerNps", label: "Employer NPS 80CCD(2) (₹)", type: "money", default: 0 },
    { key: "section80C", label: "80C (max ₹1.5L)", type: "money", default: 150000, section: "Deductions (old regime only)" },
    { key: "section80D", label: "80D health insurance", type: "money", default: 25000 },
    { key: "nps80CCD1B", label: "80CCD(1B) NPS (max ₹50k)", type: "money", default: 50000 },
    { key: "homeLoanInterest", label: "Home loan interest (max ₹2L)", type: "money", default: 0 },
    { key: "hraExemption", label: "HRA exemption", type: "money", default: 0 },
    { key: "otherDeductions", label: "Other deductions", type: "money", default: 0 },
    { key: "sipReturnPct", label: "SIP return (%)", type: "percent", default: 12 },
    { key: "sipYears", label: "SIP years", type: "years", default: 20 },
  ],
  compute: (v) => {
    const sipReturnPct = nn(v.sipReturnPct);
    const sipYears = nn(v.sipYears);
    const result = compareRegimes({
      grossIncome: nn(v.grossIncome),
      isSalaried: !!v.isSalaried,
      deductions: {
        section80C: nn(v.section80C), section80D: nn(v.section80D), nps80CCD1B: nn(v.nps80CCD1B),
        homeLoanInterest: nn(v.homeLoanInterest), hraExemption: nn(v.hraExemption), otherDeductions: nn(v.otherDeductions),
        employerNps80CCD2: nn(v.employerNps),
      },
      sipReturnPct,
      sipYears,
    });
    const better = result.betterRegime;
    return [
      stat("Old regime tax", inr(result.old.totalTax), better === "old" ? "success" : undefined),
      stat("New regime tax", inr(result.new.totalTax), better === "new" ? "success" : undefined),
      stat("Better regime", better === "new" ? "New" : "Old", "brand"),
      stat("Annual tax saving", inr(result.annualSaving), "success"),
      section("✓ Side-by-side"),
      table(
        ["Component", "Old regime", "New regime"],
        [
          ["Taxable income", inr(result.old.taxableIncome), inr(result.new.taxableIncome)],
          ["Income tax (pre-rebate)", inr(result.old.baseTax), inr(result.new.baseTax)],
          ["Less: 87A rebate / marginal relief", `(${inr(result.old.rebate)})`, `(${inr(result.new.rebate)})`],
          ["Surcharge", inr(result.old.surcharge), inr(result.new.surcharge)],
          ["Health & education cess 4%", inr(result.old.cess), inr(result.new.cess)],
          ["Total tax", inr(result.old.totalTax), inr(result.new.totalTax)],
        ],
      ),
      insight(
        `The ${better === "new" ? "new" : "old"} regime saves about ${inr(result.annualSaving)}/year. Invested as a ${inr(result.monthlyFromSaving)}/month SIP at ${fmtPct(sipReturnPct)} for ${sipYears} years, that tax saving alone grows to ${inr(result.sipFutureValue)} — turning a tax decision into wealth.`,
        "success",
      ),
      note("Indicative; surcharge marginal relief and senior-citizen exemptions not modelled. Confirm with a tax advisor."),
    ];
  },
};

/**
 * RealReturnCalculator.tsx — Real Return (computeRealReturns). The web's add /
 * remove instrument list is six fixed slots, the web's four rows pre-filled;
 * a blank name drops a slot.
 */
const INSTRUMENT_SLOTS = 6;
const INSTRUMENT_DEFAULTS: Instrument[] = [
  { name: "Savings account", nominalPct: 3, taxPct: 30 },
  { name: "Fixed deposit", nominalPct: 7, taxPct: 30 },
  { name: "Debt fund", nominalPct: 8, taxPct: 30 },
  { name: "Equity fund", nominalPct: 12, taxPct: 12.5 },
];
const named = (v: Record<string, any>, n: number) => String(v[`name${n}`] ?? "").trim() !== "";
const realreturn: CalcBody = {
  inputs: [
    { key: "inflationPct", label: "Expected inflation (%)", type: "percent", default: 6 },
    { key: "amount", label: "Amount (₹)", type: "money", default: 1000000 },
    { key: "years", label: "Years (for purchasing power)", type: "years", default: 10 },
    ...Array.from({ length: INSTRUMENT_SLOTS }, (_, i): InputSpec[] => {
      const n = i + 1;
      // The web's "+ Add instrument" row: "New instrument", 7%, 30% tax.
      const d = INSTRUMENT_DEFAULTS[i] ?? { name: "", nominalPct: 7, taxPct: 30 };
      return [
        {
          key: `name${n}`, label: "Instrument", type: "text", default: d.name, section: `Instrument ${n}`,
          placeholder: "New instrument",
          visibleIf: (v) => n === 1 || named(v, n - 1) || named(v, n),
          ...(n === 1 ? { hint: "A blank name drops the instrument." } : {}),
        },
        { key: `nominal${n}`, label: "Nominal %", type: "percent", default: d.nominalPct, visibleIf: (v) => named(v, n) },
        { key: `tax${n}`, label: "Tax %", type: "percent", default: d.taxPct, visibleIf: (v) => named(v, n) },
      ];
    }).flat(),
  ],
  compute: (v) => {
    const inflationPct = nn(v.inflationPct);
    const amount = nn(v.amount);
    const years = nn(v.years);
    const rows: Instrument[] = Array.from({ length: INSTRUMENT_SLOTS }, (_, i) => i + 1)
      .filter((n) => named(v, n))
      .map((n) => ({ name: String(v[`name${n}`]), nominalPct: nn(v[`nominal${n}`]), taxPct: nn(v[`tax${n}`]) }));
    const results = computeRealReturns(rows, inflationPct, amount, years);
    const fmtPctSigned = (n: number) => `${n.toFixed(2)}%`;
    const out: ResultBlock[] = [];
    if (results.length === 0) return out;
    const worst = results.reduce((a, b) => (b.realPct < a.realPct ? b : a), results[0]);
    const best = results.reduce((a, b) => (b.realPct > a.realPct ? b : a), results[0]);
    out.push(table(
      ["Instrument", "Nominal %", "Tax %", "Post-tax %", "Real return %", `Real value in ${years}y`],
      results.map((r) => [r.name, `${r.nominalPct}%`, `${r.taxPct}%`, `${r.postTaxNominalPct.toFixed(2)}%`, fmtPctSigned(r.realPct), inr(r.realFutureValue)]),
    ));
    out.push(insight(
      (worst.realPct < 0
        ? `${worst.name} actually loses ${Math.abs(worst.realPct).toFixed(2)}% a year in real, post-tax terms — your money buys less over time. `
        : `${worst.name} barely keeps pace with inflation after tax. `) +
        `${best.name} delivers the strongest real return (${best.realPct.toFixed(2)}%) — the gap is the real cost of playing it "safe."`,
      worst.realPct < 0 ? "danger" : "success",
    ));
    return out;
  },
};

/** NpsPlanner.tsx — NPS Retirement & Tax Planner (computeNps). */
const nps: CalcBody = {
  inputs: [
    { key: "currentAge", label: "Current age", type: "years", default: 30 },
    { key: "retirementAge", label: "Retirement age", type: "years", default: 60 },
    { key: "monthlyContribution", label: "Monthly contribution (₹)", type: "money", default: 5000 },
    { key: "annualStepUpPct", label: "Annual step-up (%)", type: "percent", default: 5 },
    { key: "expectedReturnPct", label: "Expected return (%)", type: "percent", default: 10 },
    { key: "existingCorpus", label: "Existing NPS corpus (₹)", type: "money", default: 0 },
    { key: "annuityPortionPct", label: "Annuity portion (% ≥ 40)", type: "percent", default: 40 },
    { key: "annuityRatePct", label: "Annuity rate (%)", type: "percent", default: 6 },
    { key: "taxSlabPct", label: "Tax slab (% for 80CCD-1B, old regime)", type: "percent", default: 30 },
  ],
  compute: (v) => {
    const retirementAge = nn(v.retirementAge);
    const monthlyContribution = nn(v.monthlyContribution);
    const annuityRatePct = nn(v.annuityRatePct);
    const r = computeNps({
      currentAge: nn(v.currentAge), retirementAge, monthlyContribution, annualStepUpPct: nn(v.annualStepUpPct),
      expectedReturnPct: nn(v.expectedReturnPct), existingCorpus: nn(v.existingCorpus), annuityPortionPct: nn(v.annuityPortionPct),
      annuityRatePct, taxSlabPct: nn(v.taxSlabPct),
    });
    return [
      stat(`Corpus at ${retirementAge}`, inr(r.corpus), "brand"),
      stat("Tax-free lump sum", inr(r.lumpSum), "success"),
      stat("Annuity corpus", inr(r.annuityCorpus)),
      stat("Monthly pension", inr(r.monthlyPension), "success"),
      section("✓ At retirement"),
      table(
        ["Component", "Amount"],
        [
          [`Total contributed (over ${r.years} yrs)`, inr(r.totalContributed)],
          [`Corpus at age ${retirementAge}`, inr(r.corpus)],
          [`Lump-sum withdrawal (${100 - r.annuityPortionPct}%, tax-free)`, inr(r.lumpSum)],
          [`Annuity corpus (${r.annuityPortionPct}%)`, inr(r.annuityCorpus)],
          [`Monthly pension @ ${fmtPct(annuityRatePct)}`, inr(r.monthlyPension)],
        ],
      ),
      insight(
        `Contributing ${inr(monthlyContribution)}/month builds a ${inr(r.corpus)} corpus — a ${inr(r.lumpSum)} tax-free lump sum plus ${inr(r.monthlyPension)}/month pension for life. The 80CCD(1B) deduction (old regime) also saves about ${inr(r.annual80CCD1BBenefit)} in tax every year, over and above your 80C limit.`,
        "success",
      ),
    ];
  },
};

/** TaxHarvestingCalculator.tsx — Equity LTCG Tax-Harvesting (computeTaxHarvesting). */
const harvest: CalcBody = {
  inputs: [
    { key: "investment", label: "Investment (₹)", type: "money", default: 2000000 },
    { key: "expectedReturnPct", label: "Expected return (%)", type: "percent", default: 12 },
    { key: "years", label: "Holding period (yrs)", type: "years", default: 15 },
    { key: "exemptionPerYear", label: "Tax-free LTCG / yr (₹)", type: "money", default: 125000 },
    { key: "ltcgRatePct", label: "LTCG rate (%)", type: "percent", default: 12.5 },
  ],
  compute: (v) => {
    const exemptionPerYear = nn(v.exemptionPerYear);
    const r = computeTaxHarvesting({
      investment: nn(v.investment), expectedReturnPct: nn(v.expectedReturnPct), years: nn(v.years),
      exemptionPerYear, ltcgRatePct: nn(v.ltcgRatePct),
    });
    return [
      stat("Final value", inr(r.finalValue), "brand"),
      stat("Tax if you never harvest", inr(r.taxWithoutHarvesting), "danger"),
      stat("Tax with harvesting", inr(r.taxWithHarvesting), "success"),
      stat("Tax saved", inr(r.taxSaved), "success"),
      section("✓ Year-by-year harvesting"),
      table(
        ["Year", "Value", "Unrealised gain", "Harvested (tax-free)", "Stepped-up cost"],
        r.rows.map((row) => [
          `${row.year}`,
          inr(row.value),
          inr(row.unrealizedGain),
          row.harvested > 0 ? inr(row.harvested) : "—",
          inr(row.costBase),
        ]),
      ),
      insight(
        `By harvesting the ${inr(exemptionPerYear)} tax-free exemption each year, your client banks ${inr(r.totalHarvestedTaxFree)} of gains tax-free and pays ${inr(r.taxSaved)} less tax than someone who simply holds and sells at the end — with no change to the underlying investment.`,
        "success",
      ),
      note("Assumes gains qualify as long-term and exit loads/STT are ignored. Illustration only."),
    ];
  },
};

/**
 * CapitalGainsTaxCalculator.tsx — Capital Gains Tax (computeCapitalGains). The
 * web's add / remove improvement list is four fixed slots, the web's one row
 * pre-filled; a slot with no cost is unused, and the next slot appears once the
 * one before it has a cost. A new slot starts at the sale year's FY (2022-23
 * for the default sale date), as the web's "+ Add more" does.
 */
const ASSET_TYPES: { value: AssetType; label: string }[] = [
  { value: "immovable", label: "Immovable Property" },
  { value: "movable", label: "Movable Property" },
  { value: "gold", label: "Gold / Jewellery" },
  { value: "unlisted_shares", label: "Unlisted Shares" },
  { value: "other", label: "Other" },
];
const FY_YEARS = Object.keys(CII).map(Number).sort((a, b) => a - b);
const IMPROVEMENT_SLOTS = 4;
const IMPROVEMENT_DEFAULTS: Improvement[] = [{ fyStartYear: 2008, cost: 500000 }];
const captax: CalcBody = {
  inputs: [
    { key: "basis", label: "Acquisition basis", type: "segmented", default: "after_2001", options: opts([["after_2001", "Purchased in/after FY2001-02"], ["before_2001", "Purchased before FY2001-02"]]) },
    { key: "assetType", label: "Asset type", type: "select", default: "immovable", options: ASSET_TYPES.map((a) => ({ value: a.value, label: a.label })) },
    { key: "assetName", label: "Asset name", type: "text", default: "House" },
    { key: "purchasePrice", label: "Purchase price (₹)", type: "money", default: 1500000 },
    { key: "purchaseDate", label: "Date of purchase", type: "date", default: "2004-06-15" },
    { key: "fmv2001", label: "FMV as on 01/04/2001 (₹)", type: "money", default: 0, visibleIf: (v) => v.basis === "before_2001" },
    ...Array.from({ length: IMPROVEMENT_SLOTS }, (_, i): InputSpec[] => {
      const n = i + 1;
      const d = IMPROVEMENT_DEFAULTS[i] ?? { fyStartYear: 2022, cost: 0 };
      const shown = (v: Record<string, any>) => n === 1 || nn(v[`imp${n - 1}Cost`]) > 0 || nn(v[`imp${n}Cost`]) > 0;
      return [
        {
          key: `imp${n}Fy`, label: `Financial year ${n}`, type: "select", default: String(d.fyStartYear),
          options: FY_YEARS.map((y) => ({ value: String(y), label: fyLabel(y) })), visibleIf: shown,
          ...(n === 1 ? { section: "Cost of improvement (by financial year)" } : {}),
        },
        {
          key: `imp${n}Cost`, label: `Cost of improvement ${n} (₹)`, type: "money", default: d.cost, visibleIf: shown,
          ...(n === 1 ? { hint: "A cost of 0 drops the improvement." } : {}),
        },
      ];
    }).flat(),
    { key: "salePrice", label: "Sale price (₹)", type: "money", default: 7000000 },
    { key: "salesExpenses", label: "Sales expenses (₹)", type: "money", default: 100000 },
    { key: "saleDate", label: "Sale date", type: "date", default: "2022-11-01" },
    { key: "expectedSaleCII", label: "Expected sale-year CII (optional)", type: "int", default: 0 },
    { key: "incomeTaxSlabPct", label: "Income-tax slab of assessee (%)", type: "percent", default: 30 },
    { key: "includeCess", label: "Add 4% health & education cess", type: "toggle", default: false },
  ],
  compute: (v) => {
    const basis = (v.basis === "before_2001" ? "before_2001" : "after_2001") as AcquisitionBasis;
    const assetType = (ASSET_TYPES.some((a) => a.value === v.assetType) ? v.assetType : "immovable") as AssetType;
    const assetName = String(v.assetName ?? "");
    const salePrice = nn(v.salePrice);
    const salesExpenses = nn(v.salesExpenses);
    const incomeTaxSlabPct = nn(v.incomeTaxSlabPct);
    const expectedSaleCII = nn(v.expectedSaleCII);
    const includeCess = !!v.includeCess;
    const improvements: Improvement[] = Array.from({ length: IMPROVEMENT_SLOTS }, (_, i) => ({
      fyStartYear: Number(v[`imp${i + 1}Fy`]) || 2022,
      cost: nn(v[`imp${i + 1}Cost`]),
    })).filter((im) => im.cost > 0);
    const result = computeCapitalGains({
      acquisitionBasis: basis, assetType, purchasePrice: nn(v.purchasePrice), purchaseDate: String(v.purchaseDate ?? ""),
      fmv2001: nn(v.fmv2001), improvements, salePrice, salesExpenses, saleDate: String(v.saleDate ?? ""),
      expectedSaleCII: expectedSaleCII > 0 ? expectedSaleCII : null, incomeTaxSlabPct, includeCess,
    });

    const holdY = Math.floor(result.holdingMonths / 12);
    const holdM = result.holdingMonths % 12;
    const imps = result.improvementCii.filter((im) => im.cost > 0);
    const rows: string[][] = result.isLongTerm
      ? [
          ["Sale price", inr(salePrice)],
          ["Less: sales expenses", `(${inr(salesExpenses)})`],
          ["Net sale consideration", inr(result.netConsideration)],
          [basis === "before_2001" ? "Cost of purchase (higher of cost and FMV on 01-04-2001)" : "Cost of purchase", inr(result.costBase)],
          ...(result.indexed
            ? [[`CII — year of purchase (${fyLabel(basis === "before_2001" ? 2001 : result.purchaseFY ?? 2001)})`, `${result.ciiPurchase}`]]
            : []),
          ...imps.map((im) => [`Cost of improvement in FY ${fyLabel(im.fyStartYear)}${result.indexed ? ` (CII ${im.cii})` : ""}`, inr(im.cost)]),
          ...(result.indexed
            ? [[`CII — year of sale${result.saleFY != null ? ` (${fyLabel(result.saleFY)})` : ""}`, `${result.ciiSale}`]]
            : []),
          result.indexed
            ? ["Less: indexed cost of acquisition (purchase + improvements)", `(${inr(result.indexedCostTotal)})`]
            : ["Less: cost of acquisition + improvements", `(${inr(result.indexedCostTotal)})`],
          ["Taxable long-term capital gain", inr(result.gain)],
          [`Tax @ ${fmtPct(result.ltcgRatePct)} (${result.indexed ? "with" : "without"} indexation)`, inr(result.baseTax)],
          ...(includeCess ? [["Health & education cess @ 4%", inr(result.cess)]] : []),
          ["Total tax payable", inr(result.totalTax)],
        ]
      : [
          ["Net sale consideration", inr(result.netConsideration)],
          ["Less: cost of acquisition", `(${inr(result.costBase)})`],
          ["Less: cost of improvement", `(${inr(result.totalImprovementsRaw)})`],
          ["Short-term capital gain", inr(result.gain)],
          [`Tax @ slab ${fmtPct(incomeTaxSlabPct)}`, inr(result.baseTax)],
          ...(includeCess ? [["Health & education cess @ 4%", inr(result.cess)]] : []),
          ["Total tax payable", inr(result.totalTax)],
        ];

    const out: ResultBlock[] = [
      stat("Holding period", yearsMonths(result.holdingMonths)),
      stat("Gain type", result.isLongTerm ? "Long-term" : "Short-term", result.isLongTerm ? "success" : "warning"),
      stat(result.isLongTerm ? "Long-term capital gain" : "Short-term capital gain", inr(result.gain), "brand"),
      stat("Total tax payable", inr(result.totalTax), "danger"),
      section(result.isLongTerm ? `✓ Computation (${result.indexed ? "with" : "without"} indexation)` : "✓ Computation (short-term, at slab)"),
      table(["Component", "Amount"], rows),
      // The web's JSX leaves a double space when there are no odd months; HTML
      // collapses it, so it is written single here.
      insight(
        `${assetName || "This asset"} was held for ${holdY} years${holdM ? ` ${holdM} months` : ""} → ${result.isLongTerm ? "long-term" : "short-term"}. Tax payable is ${inr(result.totalTax)}` +
          (result.gain > 0 ? ` (effective ${result.effectiveRatePct.toFixed(1)}% of the gain)` : "") +
          "." +
          (result.isLongTerm && result.indexed ? " Indexation raises the cost base to today's value, sharply reducing the taxable gain." : "") +
          (!includeCess ? " Cess is not included." : ""),
        result.isLongTerm ? "success" : "warning",
      ),
    ];
    if (result.isLongTerm && result.indexed) {
      out.push(note(
        `Indexed cost = purchase ${inr(result.indexedAcquisition)} (${inr(result.costBase)} × ${result.ciiSale} / ${result.ciiPurchase})` +
          imps.map((im) => ` + improvement FY ${fyLabel(im.fyStartYear)} ${inr(im.indexedCost)} (${inr(im.cost)} × ${result.ciiSale} / ${im.cii})`).join("") +
          ", each part rounded to the rupee.",
      ));
    }
    return out;
  },
};

/** CapitalGainsBondCalculator.tsx — 54EC Bond vs Other Investment (capitalGainsBondVsOthers). */
type CgOption = {
  key: string;
  name: string;
  enabled: boolean;
  ratePct: number;
  taxRatePct: number;
  indexation: boolean;
  isEquity?: boolean;
  editableName?: boolean;
};
const CG_OPTIONS: CgOption[] = [
  { key: "fd", name: "Fixed Deposit", enabled: true, ratePct: 6, taxRatePct: 30, indexation: false },
  { key: "debt", name: "Debt Fund", enabled: true, ratePct: 7, taxRatePct: 30, indexation: false },
  { key: "equity", name: "Equity Fund", enabled: true, ratePct: 12, taxRatePct: 12.5, indexation: false, isEquity: true },
  { key: "other", name: "Other product", enabled: false, ratePct: 8, taxRatePct: 30, indexation: false, editableName: true },
];
const pct2 = (n: number) => `${n.toFixed(2)}%`;
const cgbond: CalcBody = {
  inputs: [
    { key: "gain", label: "Long-term capital gain (₹)", type: "money", default: 5000000 },
    { key: "ltcgRatePct", label: "LTCG tax rate (%)", type: "percent", default: 12.5 },
    { key: "years", label: "Bond lock-in / period (yrs)", type: "years", default: 5 },
    { key: "bondRatePct", label: "54EC bond interest (%)", type: "percent", default: 5.25 },
    { key: "slabPct", label: "Your income-tax slab (%)", type: "percent", default: 30 },
    { key: "indexationPct", label: "Assumed yearly rise in CII (%)", type: "percent", default: 5 },
    ...CG_OPTIONS.flatMap((o, i): InputSpec[] => {
      const on = (v: Record<string, any>) => !!v[`${o.key}On`];
      return [
        {
          key: `${o.key}On`, label: o.editableName ? "Add a product" : o.name, type: "toggle", default: o.enabled,
          ...(i === 0 ? { section: "Compare the bond with" } : {}),
        },
        ...(o.editableName ? [{ key: `${o.key}Name`, label: "Product name", type: "text" as const, default: o.name, visibleIf: on }] : []),
        { key: `${o.key}Rate`, label: "Return (%)", type: "percent", default: o.ratePct, visibleIf: on },
        { key: `${o.key}Tax`, label: "Tax rate (%)", type: "percent", default: o.taxRatePct, visibleIf: on },
        { key: `${o.key}Indexation`, label: "Indexation", type: "segmented", default: o.indexation ? "yes" : "no", options: opts([["no", "No"], ["yes", "Yes (estimate)"]]), visibleIf: on },
      ];
    }),
    { key: "addCess", label: "Add 4% health & education cess", type: "toggle", default: false },
    {
      key: "useExemption", label: "Deduct equity LTCG exemption", type: "toggle", default: false,
      hint: "Both are off by default — the standard illustration taxes the whole gain at the rate entered, with no cess and no exemption.",
    },
    { key: "exemption", label: "Exemption amount (₹)", type: "money", default: 125000, visibleIf: (v) => !!v.useExemption },
  ],
  compute: (v) => {
    const gain = nn(v.gain);
    const addCess = !!v.addCess;
    const useExemption = !!v.useExemption;
    const exemption = nn(v.exemption);
    const options = CG_OPTIONS.map((o) => ({
      ...o,
      name: o.editableName ? String(v[`${o.key}Name`] ?? "") : o.name,
      enabled: !!v[`${o.key}On`],
      ratePct: nn(v[`${o.key}Rate`]),
      taxRatePct: nn(v[`${o.key}Tax`]),
      indexation: v[`${o.key}Indexation`] === "yes",
    }));
    const cols = capitalGainsBondVsOthers({
      gain, ltcgRatePct: nn(v.ltcgRatePct), years: nn(v.years), bondRatePct: nn(v.bondRatePct), slabPct: nn(v.slabPct),
      indexationPct: nn(v.indexationPct),
      cessPct: addCess ? 4 : 0,
      options: options.filter((o) => o.enabled).map((o) => ({
        name: o.name || "Other product",
        ratePct: o.ratePct,
        taxRatePct: o.taxRatePct,
        indexation: o.indexation,
        exemption: useExemption && o.isEquity ? exemption : 0,
      })),
    });

    const usesIndexation = options.some((o) => o.enabled && o.indexation);
    const best = cols.reduce<CgBondColumn | null>(
      (b, c) => (c.postTaxIrrPct != null && (b == null || (b.postTaxIrrPct ?? -Infinity) < c.postTaxIrrPct) ? c : b),
      null,
    );
    const bond = cols[0];
    const row = (label: string, f: (c: CgBondColumn) => string) => [label, ...cols.map(f)];

    const out: ResultBlock[] = [
      ...cols.map((c) => stat(
        `${c.name} · post-tax IRR`,
        c.postTaxIrrPct == null ? "—" : pct2(c.postTaxIrrPct),
        best && c.name === best.name ? "success" : c.isBond ? "brand" : undefined,
      )),
      section("1. Side-by-side comparison"),
      table(
        ["", ...cols.map((c) => c.name)],
        [
          row("Capital gain", (c) => inr(c.gain)),
          row("LTCG tax paid now", (c) => inr(c.ltcgTax)),
          row("Amount invested", (c) => inr(c.netInvestment)),
          row("Assumed return", (c) => pct2(c.ratePct)),
          row("Period (yrs)", (c) => `${c.years}`),
          row("Indexation", (c) => (c.indexation ? "Yes" : "No")),
          row("Maturity value", (c) => inr(c.maturity)),
          row("Indexation rate", (c) => pct2(c.indexationPct)),
          row("Cost for tax (indexed)", (c) => inr(c.indexedCost)),
          row("Taxable income", (c) => inr(c.taxableIncome)),
          row("Tax rate", (c) => pct2(c.taxRatePct)),
          row(addCess ? "Tax (incl. cess)" : "Tax", (c) => inr(c.tax)),
          row("Maturity after tax", (c) => inr(c.postTaxMaturity)),
          row("Post-tax IRR (on the full gain)", (c) => (c.postTaxIrrPct == null ? "—" : pct2(c.postTaxIrrPct))),
        ],
        true,
      ),
    ];
    if (best && bond.postTaxIrrPct != null) {
      out.push(insight(
        `After tax, ${best.name} leaves the most: ${inr(best.postTaxMaturity)} after ${bond.years} years, a post-tax return of ${pct2(best.postTaxIrrPct ?? 0)} on the original ${inr(gain)} gain.` +
          (!best.isBond ? ` The 54EC bond would leave ${inr(bond.postTaxMaturity)} (${pct2(bond.postTaxIrrPct)}).` : ""),
        best.isBond ? "brand" : "success",
      ));
    }
    out.push(note(
      "* Illustration only. Interest or gains are assumed reinvested at the same rate and taxed once, at maturity. The IRR is measured on the full capital gain, so tax paid up front lowers it. 54EC bonds carry a 5-year lock-in and a yearly investment limit; their interest is taxed at your slab." +
        (usesIndexation ? " Indexation “Yes” is an estimate: the cost is raised by the assumed yearly rise in the Cost Inflation Index, compounded." : "") +
        " Not tax or investment advice.",
    ));
    return out;
  },
};

/** CiiCalculator.tsx — Cost Inflation Index (ciiTable / indexCost). */
const CII_ROWS = ciiTable();
const CII_OPTIONS = CII_ROWS.map((r) => ({ value: String(r.fyStart), label: `${r.label} (CII ${r.cii})` }));
const cii: CalcBody = {
  inputs: [
    { key: "cost", label: "Cost (₹)", type: "money", default: 1000000 },
    { key: "fromFy", label: "Bought / improved in FY", type: "select", default: "2010", options: CII_OPTIONS },
    { key: "toFy", label: "Index it to FY", type: "select", default: String(latestCiiYear()), options: CII_OPTIONS },
  ],
  compute: (v) => {
    const cost = nn(v.cost);
    const latest = latestCiiYear();
    const fromFy = Number(v.fromFy);
    const toFy = Number(v.toFy);
    const res = indexCost(cost, Number.isFinite(fromFy) ? fromFy : 2010, Number.isFinite(toFy) ? toFy : latest);
    const out: ResultBlock[] = [];
    if (res.error) {
      out.push(insight(res.error, "warning"));
    } else {
      out.push(
        stat("Original cost", inr(cost)),
        stat(`CII ${fyLabel(res.fromFy)} → ${fyLabel(res.toFy)}`, `${res.ciiFrom} → ${res.ciiTo}`),
        stat("Indexation factor", `${res.factor.toFixed(4)}×`),
        stat("Indexed cost", inr(res.indexedCost), "brand"),
        insight(
          `${inr(cost)} spent in FY ${fyLabel(res.fromFy)} is worth ${inr(res.indexedCost)} in FY ${fyLabel(res.toFy)} terms (${inr(cost)} × ${res.ciiTo} ÷ ${res.ciiFrom}) — ${inr(res.inflationUplift)} more cost to set against the sale price where indexation is allowed.`,
          "brand",
        ),
      );
    }
    out.push(
      section("1. Cost Inflation Index, FY 2001-02 onwards"),
      table(
        ["Financial year", "CII", "Change on the year"],
        CII_ROWS.map((r, i) => [
          r.label,
          `${r.cii}`,
          i === 0 ? "Base year" : `${(((r.cii - CII_ROWS[i - 1].cii) / CII_ROWS[i - 1].cii) * 100).toFixed(1)}%`,
        ]),
      ),
      note(`Notified by CBDT under Section 48 of the Income-tax Act; base FY 2001-02 = 100. An asset bought before 1 April 2001 takes its cost or fair market value as on that date, indexed from 2001-02. Since 23 July 2024 indexation applies only to land and buildings bought before that date by resident individuals and HUFs. Latest year in this table: FY ${fyLabel(latest)}.`),
    );
    return out;
  },
};

export const DEFS: Record<string, CalcBody> = {
  insurance,
  surrender,
  hlv,
  termsip,
  taxregime,
  realreturn,
  nps,
  harvest,
  captax,
  cgbond,
  cii,
};
