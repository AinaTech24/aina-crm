/**
 * Property & Assets and Investor Conversion — mirror the web groups of the same
 * names (src/components/calculators/*, maths in ./web). Labels, figures and the
 * order of results follow the web component named on each def. Charts are not
 * drawn; where a chart is the only place the web prints a figure (a milestone
 * date, a race time) its labels become a table.
 */

import type { CalcBody, InputSpec, ResultBlock, SchemePick } from "../types";
import { inr, fmtPct, inrCompact } from "../fmt";
import { computePropertyYield } from "../web/property-yield";
import { computeDebtFundBenefit } from "../web/debt-fund-benefit";
import { computeEmiSip, type EmiSipMode } from "../web/emi-sip";
import { computeAssetAllocationFv, ASSET_CLASSES, type AssetRow } from "../web/asset-allocation-fv";
import { LOAN_PRESETS, loanEmi, type LoanType, type PrepayMode } from "../web/loan-emi";
import {
  monthsToTarget, habitToCorpus, fdVsEquity, rentVsBuy, lifestyleShock, moneyLast, croreRace,
} from "../web/conversion";
import { fvSip, fvLumpsum } from "../web/goal-planning-calc";
import { stat, section, table, insight, note, opts } from "./shared";

/** The web's clampNum: a non-negative finite number, 0 on garbage. */
const nn = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** The web's inrShort (src/components/calculators/charts.tsx) — the same rule as inrCompact. */
const inrShort = inrCompact;

/**
 * The label of conversion.ts dateAfterMonths (the same Date, en-IN "short
 * month + year": "Sept 2033"). The web prints it with toLocaleDateString,
 * which Hermes renders differently on Android and iOS, so the month names are
 * spelt out here exactly as en-IN prints them.
 */
const EN_IN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
function monthYearAfter(from: Date, months: number): string {
  const d = new Date(from.getFullYear(), from.getMonth() + months, from.getDate());
  return `${EN_IN_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** CrorepatiCountdown / CroreRaceCalculator goal options. */
const TARGETS = opts([["10000000", "₹1 Crore"], ["20000000", "₹2 Crore"], ["50000000", "₹5 Crore"]]);
const targetOf = (v: unknown): number => {
  const t = Number(v);
  return TARGETS.some((o) => Number(o.value) === t) ? t : 10000000;
};

/* ─────────────────────────── Property & Assets ─────────────────────────── */

/**
 * PropertyYieldCalculator.tsx — Property Rental Yield & Reinvestment
 * (computePropertyYield). The web's investible surplus follows rent −
 * maintenance until a different amount is typed; here a blank field means
 * "follow the net surplus".
 */
const property: CalcBody = {
  inputs: [
    { key: "marketValue", label: "Current market value (₹)", type: "money", default: 10000000, section: "① The property" },
    { key: "appreciationPct", label: "Expected appreciation (% p.a.)", type: "percent", default: 5 },
    { key: "monthlyRent", label: "Current monthly rent (₹)", type: "money", default: 30000 },
    { key: "monthlyMaintenance", label: "Monthly maintenance cost (₹)", type: "money", default: 2500 },
    { key: "annualIncrementPct", label: "Annual increment — rent & expenses (%)", type: "percent", default: 3 },
    { key: "years", label: "Report period (years)", type: "years", default: 10 },
    {
      key: "investibleSurplus", label: "Starting monthly investible surplus (₹)", type: "money", default: null,
      section: "② Reinvest the surplus", placeholder: "Net surplus (rent − maintenance)",
      hint: "Leave blank to use the net surplus (rent − maintenance). The reinvested surplus steps up each year by the rent/expense increment, as rent rises.",
    },
    { key: "sipReturnPct", label: "Assumed return on SIP (% p.a.)", type: "percent", default: 12 },
  ],
  compute: (v) => {
    const marketValue = nn(v.marketValue);
    const monthlyRent = nn(v.monthlyRent);
    const monthlyMaintenance = nn(v.monthlyMaintenance);
    const years = nn(v.years);
    const netSurplus = Math.max(0, monthlyRent - monthlyMaintenance);
    const typed = nn(v.investibleSurplus);
    const investibleSurplus = typed > 0 ? typed : netSurplus;
    const result = computePropertyYield({
      marketValue,
      appreciationPct: nn(v.appreciationPct),
      monthlyRent,
      monthlyMaintenance,
      annualIncrementPct: nn(v.annualIncrementPct),
      investibleSurplus,
      sipReturnPct: nn(v.sipReturnPct),
      years,
    });
    const out: ResultBlock[] = [
      note(`Net surplus = rent − maintenance = ${inr(netSurplus)}/mo.`),
      stat(`Property value after ${years}y`, inr(result.futurePropertyValue), "warning"),
      stat("SIP value from rental surplus", inr(result.sipValue), "success"),
      stat("Total combined wealth", inr(result.totalCombinedDisplay), "success"),
      stat("Overall yield", `${result.overallYieldPct.toFixed(2)}%`, "success"),
      stat("Appreciation-only return", `${result.propertyOnlyCagrPct.toFixed(2)}% p.a.`),
      stat("Net annual rental yield", `${result.annualRentalYieldPct.toFixed(2)}%`),
      stat("Total surplus reinvested", inr(result.totalInvestedSurplus)),
      stat("Wealth from reinvestment", inr(result.sipGain)),
      insight(`Property alone grows to ${inr(result.futurePropertyValue)} (~${result.propertyOnlyCagrPct.toFixed(1)}%). Reinvesting the rent lifts the blended yield to ${result.overallYieldPct.toFixed(2)}% — property + disciplined reinvestment beats property alone.`, "success"),
    ];
    if (result.schedule.length > 0) {
      out.push(
        section(`Year-by-year breakdown (${result.schedule.length} years)`),
        table(
          ["Year", "Property value", "Monthly surplus", "SIP corpus", "Combined"],
          result.schedule.map((row) => [`${row.year}`, inr(row.propertyValue), inr(row.monthlySurplusThatYear), inr(row.sipCorpus), inr(row.combined)]),
        ),
      );
    }
    out.push(note("* Illustration only. A fictional scenario for education — figures assume constant appreciation, rent growth and SIP return, which vary in reality. Not investment advice; consult scheme documents before investing."));
    return out;
  },
};

/** DebtFundBenefitCalculator.tsx — Debt Fund, Hold vs Sell (computeDebtFundBenefit).
 *  Each "If redeemed today" / "If held to LTCG" row is a tile. */
const debtfund: CalcBody = {
  inputs: [
    { key: "purchaseDate", label: "Purchase date", type: "date", default: "2020-07-20" },
    { key: "investmentAmount", label: "Investment amount (₹)", type: "money", default: 1000000 },
    { key: "redemptionDate", label: "Redemption date (sell now)", type: "date", default: "2022-11-14" },
    { key: "currentMarketValue", label: "Current market value (₹)", type: "money", default: 1200000 },
    { key: "indexationRatePct", label: "Indexation rate (%) · sale before 23 Jul 2024", type: "percent", default: 5 },
    { key: "expectedReturnPct", label: "Expected return — remaining period (%)", type: "percent", default: 6 },
    { key: "shortTermTaxPct", label: "Short-term tax rate (%)", type: "percent", default: 30 },
    { key: "longTermTaxPct", label: "Long-term tax rate (%) · sale before 23 Jul 2024", type: "percent", default: 20 },
    { key: "ltcgYears", label: "LTCG after (years) · sale before 23 Jul 2024", type: "int", default: 3 },
  ],
  compute: (v) => {
    const purchaseDate = String(v.purchaseDate ?? "");
    const redemptionDate = String(v.redemptionDate ?? "");
    const investmentAmount = nn(v.investmentAmount);
    const currentMarketValue = nn(v.currentMarketValue);
    const indexationRatePct = nn(v.indexationRatePct);
    const r = computeDebtFundBenefit({
      purchaseDate, investmentAmount, redemptionDate, currentMarketValue, indexationRatePct,
      expectedReturnPct: nn(v.expectedReturnPct), shortTermTaxPct: nn(v.shortTermTaxPct),
      longTermTaxPct: nn(v.longTermTaxPct), ltcgYears: nn(v.ltcgYears),
    });
    const fmtDate = (iso: string) => {
      if (!iso) return "—";
      const [y, m, d] = iso.split("-");
      return `${d}/${m}/${y}`;
    };
    const out: ResultBlock[] = [];
    if (!r.valid) {
      out.push(insight(r.error, "danger"));
    } else {
      out.push(
        section(`If redeemed today · ${fmtDate(redemptionDate)}`),
        stat("Investment amount", inr(investmentAmount)),
        stat("Current market value", inr(currentMarketValue)),
        stat(r.sellIsLongTerm ? "Taxable long-term gain" : "Taxable gain (at slab)", inr(r.sellGain)),
        stat(`Tax payable @ ${r.sellTaxPct}%`, inr(r.sellTax)),
        stat("Net in hand", inr(r.netIfSold), "warning"),
        stat("Post-tax yield", `${r.postTaxYieldSold.toFixed(2)}%`, "warning"),
      );
      if (r.remainingDays > 0) {
        out.push(
          section(`If held to LTCG · ${fmtDate(r.qualifyDate)} (after ${r.remainingDays} days)`),
          stat("Expected redemption amount", inr(r.expectedRedemptionAmount)),
          stat(r.regime === "flat" ? "Cost (no indexation)" : `Indexed cost (${r.indexYears}y @ ${indexationRatePct}%)`, inr(r.indexedCost)),
          stat("Taxable long-term gain", inr(r.longTermGain)),
          stat(`Tax payable @ ${r.holdTaxPct}%`, inr(r.longTermTax)),
          stat("Net in hand", inr(r.netIfHeld), "success"),
          stat("Post-tax yield", `${r.postTaxYieldHeld.toFixed(2)}%`, "success"),
        );
      }
      if (r.remainingDays === 0) {
        out.push(insight(
          r.regime === "slab"
            ? "Bought on/after 1 Apr 2023: taxed at slab however long it is held — holding saves no tax."
            : "Already long-term — nothing to gain by waiting.",
          "neutral",
        ));
      } else {
        out.push(
          insight(`By holding just ${r.remainingDays} more days to qualify for LTCG, the client keeps an extra ${inr(r.extraInHand)} (tax saved ${inr(r.taxSaved)}) — an effective post-tax yield of ${r.effectiveRemainingYield.toFixed(2)}% on the remaining period.`, "success"),
          stat("Tax saved by holding", inr(r.taxSaved)),
          stat("Extra in hand", inr(r.extraInHand)),
          stat("Holding to qualify", `${(r.totalHoldingDays / 365).toFixed(2)} yrs`),
          stat("Remaining wait", `${r.remainingDays} days`),
        );
      }
    }
    out.push(note("* Illustration only. Applies the rules of each sale date: indexation for sales before 23 Jul 2024; from then, 12.5% without indexation after 24 months; units bought on/after 1 Apr 2023 taxed at slab regardless of period. Verify the applicable tax rules for the specific units. Not tax or investment advice."));
    return out;
  },
};

/** EmiSipRecoveryPlanner.tsx — Recover Your EMIs through SIP (computeEmiSip), with
 *  the one-time lumpsum beside the SIP (web f7f89a79). The suggested schemes are
 *  three Scheme Master slots instead of an add-as-you-go list. */
const emisip: CalcBody = {
  inputs: [
    { key: "mode", label: "Mode", type: "segmented", default: "loan", options: opts([["loan", "Enter loan details"], ["emi", "Enter EMI details"]]) },
    { key: "loanAmount", label: "Outstanding loan amount (₹)", type: "money", default: 2500000, visibleIf: (v) => v.mode !== "emi" },
    { key: "interestRatePct", label: "Rate of interest (% p.a.)", type: "percent", default: 9, visibleIf: (v) => v.mode !== "emi" },
    { key: "emiAmount", label: "Monthly EMI (₹)", type: "money", default: 25357, visibleIf: (v) => v.mode === "emi" },
    { key: "tenureValue", label: "Loan tenure remaining", type: "int", default: 15, visibleIf: (v) => v.mode !== "emi" },
    { key: "emiTenureValue", label: "EMI tenure remaining", type: "int", default: 15, visibleIf: (v) => v.mode === "emi" },
    { key: "tenureUnit", label: "Tenure in", type: "segmented", default: "years", options: opts([["years", "Years"], ["months", "Months"]]) },
    { key: "sipReturnPct", label: "Assumed return on SIP (% p.a.)", type: "percent", default: 12 },
    { key: "addSchemes", label: "Add suggested schemes for investment", type: "toggle", default: false },
    { key: "scheme1", label: "Suggested scheme", type: "scheme", default: null, visibleIf: (v) => !!v.addSchemes },
    { key: "scheme2", label: "Suggested scheme 2", type: "scheme", default: null, visibleIf: (v) => !!v.addSchemes && (!!v.scheme1 || !!v.scheme2) },
    { key: "scheme3", label: "Suggested scheme 3", type: "scheme", default: null, visibleIf: (v) => !!v.addSchemes && (!!v.scheme2 || !!v.scheme3) },
  ],
  compute: (v) => {
    const mode: EmiSipMode = v.mode === "emi" ? "emi" : "loan";
    const tenureValue = mode === "loan" ? nn(v.tenureValue) : nn(v.emiTenureValue);
    const tenureMonths = v.tenureUnit === "months" ? tenureValue : tenureValue * 12;
    const sipReturnPct = nn(v.sipReturnPct);
    const result = computeEmiSip({
      mode, loanAmount: nn(v.loanAmount), interestRatePct: nn(v.interestRatePct), emiAmount: nn(v.emiAmount), tenureMonths, sipReturnPct,
    });
    const out: ResultBlock[] = [];
    if (mode === "loan") {
      out.push(
        stat("Monthly EMI", inr(result.monthlyEmi), "warning"),
        stat("Principal repayment", inr(result.principalRepayment ?? 0)),
        stat("Interest repayment", inr(result.interestRepayment ?? 0), "danger"),
        stat("Total repayment", inr(result.totalRepayment), "warning"),
      );
    }
    out.push(
      stat(`Monthly SIP required @ ${sipReturnPct.toFixed(2)}%`, inr(result.monthlySipRequired), "success"),
      stat("SIP as % of EMI", `${result.sipAsPctOfEmi.toFixed(2)}%`, "success"),
      stat("Total you'll repay", inr(result.totalRepayment)),
      stat("SIP grows to (recovers)", inr(result.totalRepayment), "success"),
      stat(`Or one-time lumpsum today @ ${sipReturnPct.toFixed(2)}%`, inr(result.lumpsumRequired), "success"),
      stat("Lumpsum grows to (recovers)", inr(result.totalRepayment)),
      insight(`If you start a SIP of ${inr(result.monthlySipRequired)} — just ${result.sipAsPctOfEmi.toFixed(2)}% of your ${inr(result.monthlyEmi)} EMI — you'll accumulate ${inr(result.totalRepayment)} by the end of the tenure and effectively recover your entire EMI outgo. A one-time lumpsum of ${inr(result.lumpsumRequired)} invested today does the same.`, "success"),
    );
    // The web joins the picked schemes with ", ".
    const schemes = v.addSchemes
      ? [v.scheme1, v.scheme2, v.scheme3].map((s: SchemePick) => s?.name ?? "").filter(Boolean).join(", ")
      : "";
    if (schemes) out.push(section("Suggested schemes"), note(schemes));
    out.push(note("* Illustration only. Interest on the loan is assumed compounded monthly with the EMI at month end; the SIP earns the assumed return monthly. Mutual fund returns are not guaranteed and subject to market risk. Not investment advice."));
    return out;
  },
};

/**
 * AssetAllocationFvPlanner.tsx — Asset Allocation Future Value
 * (computeAssetAllocationFv). The web's add / remove asset rows are eight
 * slots per scenario, the next one appearing once the last has an allocation;
 * 0% allocation leaves a slot unused. (The web also resets a row's rate to the
 * asset class's default when the class changes; here the rate is typed.)
 */
// The web component's S1_DEFAULT / S2_DEFAULT; "Add asset" adds Equity 12% / 0%.
const S1_DEFAULT: AssetRow[] = [
  { assetClass: "bonds", ratePct: 6, allocationPct: 20 },
  { assetClass: "debt", ratePct: 7, allocationPct: 30 },
  { assetClass: "equity", ratePct: 12, allocationPct: 40 },
  { assetClass: "gold", ratePct: 8, allocationPct: 10 },
];
const S2_DEFAULT: AssetRow[] = [
  { assetClass: "equity", ratePct: 12, allocationPct: 60 },
  { assetClass: "hybrid", ratePct: 9, allocationPct: 25 },
  { assetClass: "gold", ratePct: 8, allocationPct: 10 },
  { assetClass: "debt", ratePct: 7, allocationPct: 5 },
];
const NEW_ROW: AssetRow = { assetClass: "equity", ratePct: 12, allocationPct: 0 };
const ASSET_SLOTS = 8;
const ASSET_OPTIONS = ASSET_CLASSES.map((a) => ({ value: a.value, label: a.label }));
const SLOT_NOS = Array.from({ length: ASSET_SLOTS }, (_, k) => k + 1);
/** Allocation adds up to 100% (within rounding of typed decimals). */
const is100 = (pct: number) => Math.abs(pct - 100) < 0.01;

function assetSlotInputs(sc: "s1" | "s2", title: string, defaults: AssetRow[], shown?: (v: Record<string, any>) => boolean): InputSpec[] {
  return SLOT_NOS.flatMap((i): InputSpec[] => {
    const d = defaults[i - 1] ?? NEW_ROW;
    const visibleIf = (v: Record<string, any>) =>
      (!shown || shown(v)) && (i <= defaults.length || nn(v[`${sc}a${i - 1}`]) > 0 || nn(v[`${sc}a${i}`]) > 0);
    return [
      { key: `${sc}c${i}`, label: "Asset class", type: "select", default: d.assetClass, options: ASSET_OPTIONS, section: `${title} · Asset ${i}`, visibleIf },
      { key: `${sc}r${i}`, label: "Assumed rate %", type: "percent", default: d.ratePct, visibleIf },
      {
        key: `${sc}a${i}`, label: "Allocation %", type: "percent", default: d.allocationPct, visibleIf,
        ...(i === defaults.length ? { hint: "Set an allocation to 0% to remove the asset." } : {}),
      },
    ];
  });
}

function assetRows(v: Record<string, any>, sc: "s1" | "s2"): AssetRow[] {
  return SLOT_NOS.map((i) => {
    const c = String(v[`${sc}c${i}`] ?? "");
    return {
      assetClass: ASSET_CLASSES.some((a) => a.value === c) ? c : "equity",
      ratePct: nn(v[`${sc}r${i}`]),
      allocationPct: nn(v[`${sc}a${i}`]),
    };
  });
}

const assetalloc: CalcBody = {
  inputs: [
    { key: "initialInvestment", label: "Initial investment (₹)", type: "money", default: 1000000 },
    { key: "years", label: "Investment period (years)", type: "years", default: 15 },
    ...assetSlotInputs("s1", "Scenario 1", S1_DEFAULT),
    { key: "s2enabled", label: "Compare with Scenario 2", type: "toggle", default: true },
    ...assetSlotInputs("s2", "Scenario 2", S2_DEFAULT, (v) => !!v.s2enabled),
  ],
  compute: (v) => {
    const initialInvestment = nn(v.initialInvestment);
    const result = computeAssetAllocationFv({
      initialInvestment, years: nn(v.years), scenario1: assetRows(v, "s1"), scenario2: v.s2enabled ? assetRows(v, "s2") : null,
    });
    const s1 = result.scenario1;
    const s2 = result.scenario2;
    const scenarioBlocks = (title: string, r: typeof s1): ResultBlock[] => [
      section(title),
      stat("Total allocation", `${r.totalAllocationPct}%`, r.totalAllocationPct === 100 ? "success" : "danger"),
      stat("Invested", inr(r.totalInvested)),
      stat("Future value", inr(r.futureValue)),
      stat("Wealth gain", inr(r.gain)),
      stat("Blended return", `${r.blendedReturnPct.toFixed(2)}%`),
    ];
    const out: ResultBlock[] = scenarioBlocks("Scenario 1", s1);
    if (s2) {
      out.push(...scenarioBlocks("Scenario 2", s2));
      if (!(is100(s1.totalAllocationPct) && is100(s2.totalAllocationPct))) {
        out.push(insight("Set both allocations to 100% to compare them on the same investment.", "warning"));
      } else {
        out.push(insight(
          `Scenario 1 grows ${inr(initialInvestment)} to ${inr(s1.futureValue)} (${s1.blendedReturnPct.toFixed(2)}%). Scenario 2 reaches ${inr(s2.futureValue)} (${s2.blendedReturnPct.toFixed(2)}%) — a difference of ${inr(Math.abs(s2.futureValue - s1.futureValue))} on the same investment & tenure.`,
          s2.futureValue >= s1.futureValue ? "success" : "warning",
        ));
      }
    }
    if (s1.schedule.length > 0) {
      out.push(
        section(`Year-wise projected portfolio value (${s1.schedule.length} years)`),
        table(
          ["Year", "Scenario 1", ...(s2 ? ["Scenario 2"] : [])],
          s1.schedule.map((row, i) => [`${row.year}`, inr(row.value), ...(s2 ? [inr(s2.schedule[i]?.value ?? 0)] : [])]),
        ),
      );
    }
    out.push(note("* Illustration only. Each asset class is assumed to grow at its own annual return; the portfolio is the sum of the sleeves. Actual returns vary with market performance and are not guaranteed. Not investment advice."));
    return out;
  },
};

/**
 * LoanEmiCalculator.tsx — Loan EMI (loanEmi). The web's loan-type switch loads
 * that type's preset (amount, rate, tenure, moratorium, prepayment = a tenth of
 * the amount); here each type keeps its own preset-filled fields.
 */
const LOAN_TYPES = Object.keys(LOAN_PRESETS) as LoanType[];
const loanTypeOf = (v: Record<string, any>): LoanType => (LOAN_TYPES.includes(v.loanType) ? v.loanType : "home");
function tenureText(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y > 0 ? `${y} yr${y === 1 ? "" : "s"}` : "", m > 0 ? `${m} mo` : ""].filter(Boolean).join(" ") || "0 mo";
}
const loanemi: CalcBody = {
  inputs: [
    { key: "loanType", label: "Loan type", type: "select", default: "home", options: LOAN_TYPES.map((t) => ({ value: t, label: LOAN_PRESETS[t].label })) },
    ...LOAN_TYPES.flatMap((t): InputSpec[] => {
      const p = LOAN_PRESETS[t];
      const visibleIf = (v: Record<string, any>) => loanTypeOf(v) === t;
      const fields: InputSpec[] = [
        { key: `${t}Amount`, label: "Loan amount (₹)", type: "money", default: p.amount, visibleIf },
        { key: `${t}Rate`, label: "Interest rate (% a year)", type: "percent", default: p.ratePct, visibleIf },
        { key: `${t}Years`, label: "Tenure (years)", type: "years", default: p.years, visibleIf },
        { key: `${t}Months`, label: "Tenure (months)", type: "int", default: p.months, visibleIf },
      ];
      if (t === "education") fields.push({ key: "moratorium", label: "Moratorium (months)", type: "int", default: p.moratoriumMonths, visibleIf });
      return fields;
    }),
    { key: "usePrepay", label: "Add a part-prepayment", type: "toggle", default: false },
    ...LOAN_TYPES.map((t): InputSpec => ({
      key: `${t}PrepayAmt`, label: "Prepayment (₹)", type: "money", default: Math.round(LOAN_PRESETS[t].amount / 10),
      visibleIf: (v) => !!v.usePrepay && loanTypeOf(v) === t,
    })),
    { key: "prepayMonth", label: "Paid with EMI number", type: "int", default: 24, visibleIf: (v) => !!v.usePrepay },
    { key: "prepayMode", label: "After the prepayment", type: "segmented", default: "reduce_tenure", options: opts([["reduce_tenure", "Keep EMI, shorter loan"], ["reduce_emi", "Keep tenure, lower EMI"]]), visibleIf: (v) => !!v.usePrepay },
    { key: "schedule", label: "Amortisation schedule", type: "segmented", default: "yearly", options: opts([["yearly", "Year by year"], ["monthly", "Month by month"]]) },
  ],
  compute: (v) => {
    const t = loanTypeOf(v);
    const amount = nn(v[`${t}Amount`]);
    const rate = nn(v[`${t}Rate`]);
    const years = nn(v[`${t}Years`]);
    const months = Math.min(11, Math.round(nn(v[`${t}Months`])));
    const moratorium = Math.round(nn(v.moratorium));
    const usePrepay = !!v.usePrepay;
    const prepayAmt = nn(v[`${t}PrepayAmt`]);
    const prepayMonth = Math.round(nn(v.prepayMonth));
    const prepayMode: PrepayMode = v.prepayMode === "reduce_emi" ? "reduce_emi" : "reduce_tenure";
    const res = loanEmi({
      amount, annualRatePct: rate, years, months,
      moratoriumMonths: t === "education" ? moratorium : 0,
      prepayment: usePrepay ? { amount: prepayAmt, month: prepayMonth, mode: prepayMode } : null,
    });
    const s = res.schedule;
    const prepayOutOfRange = usePrepay && prepayAmt > 0 && (prepayMonth < 1 || prepayMonth > res.tenureMonths);

    const out: ResultBlock[] = [];
    if (prepayOutOfRange) out.push(insight(`The prepayment must be paid with an EMI between 1 and ${res.tenureMonths}.`, "warning"));
    out.push(
      stat("Monthly EMI", inr(res.emi), "brand"),
      stat("Total interest", inr(res.totalInterest), "warning"),
      stat("Total payment", inr(res.totalPayment)),
      stat("Repayment period", tenureText(res.tenureMonths)),
    );
    if (res.moratoriumInterest > 0) {
      out.push(stat("Interest during moratorium", inr(res.moratoriumInterest)), stat("Owed when EMIs start", inr(res.repayPrincipal)));
    }
    if (res.prepay) {
      out.push(
        stat("Interest saved", inr(res.prepay.interestSaved), "success"),
        res.prepay.mode === "reduce_tenure"
          ? stat("Loan ends sooner by", tenureText(res.prepay.monthsSaved), "success")
          : stat("New EMI", res.prepay.newEmi > 0 ? inr(res.prepay.newEmi) : "Loan closed", "success"),
      );
    }
    if (res.tenureMonths > 0 && amount > 0) {
      const mor = res.moratoriumInterest > 0
        ? ` (including ${inr(res.moratoriumInterest)} of simple interest over the ${moratorium}-month moratorium, added to the loan when EMIs start)`
        : "";
      let pre = "";
      if (res.prepay && res.prepay.interestSaved > 0) {
        const end = res.prepay.mode === "reduce_tenure"
          ? ` and closes the loan ${tenureText(res.prepay.monthsSaved)} early.`
          : res.prepay.newEmi > 0 ? ` and lowers the EMI to ${inr(res.prepay.newEmi)}.` : " and closes the loan.";
        pre = ` Prepaying ${inr(res.prepay.amount)} with EMI ${res.prepay.month} saves ${inr(res.prepay.interestSaved)} of interest${end}`;
      }
      out.push(insight(`An EMI of ${inr(res.emi)} for ${tenureText(res.tenureMonths)} at ${fmtPct(rate)} repays ${inr(res.repayPrincipal)} with ${inr(res.totalInterest)} of interest${mor} — every ₹1 borrowed costs ₹${(res.totalPayment / amount).toFixed(2)} in all.${pre}`, "brand"));
    }
    if (s.months > 0) {
      out.push(section("1. Where the money goes"));
      // The web's SplitBar legend (the bar and the chart are not drawn).
      const total = res.amount + res.totalInterest;
      if (total > 0) {
        const pShare = (res.amount / total) * 100;
        out.push(
          stat("Principal", `${inr(res.amount)} (${pShare.toFixed(1)}%)`),
          stat("Interest", `${inr(res.totalInterest)} (${(100 - pShare).toFixed(1)}%)`),
        );
      }
      out.push(
        section("2. Amortisation schedule"),
        v.schedule === "monthly"
          ? table(
            ["EMI no.", "Opening balance", "EMI", "Interest", "Principal", ...(res.prepay ? ["Prepayment"] : []), "Closing balance"],
            s.monthly.map((m) => [`${m.month}`, inr(m.opening), inr(m.emi), inr(m.interest), inr(m.principal), ...(res.prepay ? [m.prepayment > 0 ? inr(m.prepayment) : "—"] : []), inr(m.closing)]),
          )
          : table(
            ["Year", "Opening balance", "EMIs paid", "Interest", "Principal", ...(res.prepay ? ["Prepayment"] : []), "Closing balance"],
            s.yearly.map((y) => [`${y.year}`, inr(y.opening), inr(y.emiPaid), inr(y.interest), inr(y.principal), ...(res.prepay ? [y.prepayment > 0 ? inr(y.prepayment) : "—"] : []), inr(y.closing)]),
          ),
        note(`Reducing-balance method: each month's interest is the balance × ${fmtPct(rate)} ÷ 12. Year 1 is the first 12 EMIs. Lenders round each EMI to the rupee, so their statements can differ by a few rupees.`),
      );
    }
    return out;
  },
};

/* ─────────────────────────── Investor Conversion ─────────────────────────── */

/** CrorepatiCountdown.tsx — Crorepati Countdown (monthsToTarget). The milestone
 *  bar chart's labels are a table. */
const MILESTONES = [1000000, 2500000, 5000000, 10000000, 20000000, 50000000];
const crorepati: CalcBody = {
  inputs: [
    { key: "sip", label: "Monthly SIP (₹)", type: "money", default: 25000 },
    { key: "lumpsum", label: "One-time lumpsum (₹)", type: "money", default: 0 },
    { key: "returnPct", label: "Expected return (% p.a.)", type: "percent", default: 12 },
    { key: "target", label: "Goal", type: "segmented", default: "10000000", options: TARGETS },
  ],
  compute: (v) => {
    const sip = nn(v.sip);
    const lumpsum = nn(v.lumpsum);
    const returnPct = nn(v.returnPct);
    const targetNum = targetOf(v.target);
    const today = new Date();
    const months = monthsToTarget({ monthlySip: sip, lumpsum, annualReturnPct: returnPct, target: targetNum });
    if (months == null) {
      return [insight("At these inputs the goal isn’t reached within 60 years. Increase the SIP, add a lumpsum, or extend the horizon.", "warning")];
    }
    const milestones = MILESTONES.filter((t) => t <= targetNum).map((t) => ({
      amount: t,
      months: monthsToTarget({ monthlySip: sip, lumpsum, annualReturnPct: returnPct, target: t }),
    }));
    const invested = lumpsum + sip * months;
    const fvAt = fvLumpsum(lumpsum, returnPct, months) + fvSip(sip, returnPct, months);
    const date = monthYearAfter(today, months);
    const years = (months / 12).toFixed(1);
    return [
      stat(`You hit ${inrShort(targetNum)} in`, date, "success", `that’s just ${years} years from today`),
      stat("Time to goal", `${years} yrs`, "brand"),
      stat("You invest", inr(invested)),
      stat("Goal corpus", inr(Math.round(fvAt)), "success"),
      section("1. Milestone timeline"),
      table(
        ["Milestone", "Reached by", "Time"],
        milestones.map((m) => [
          inrShort(m.amount),
          m.months != null ? monthYearAfter(today, m.months) : "—",
          m.months != null ? `${(m.months / 12).toFixed(1)} yrs` : "—",
        ]),
      ),
      insight(`At ${inr(sip)}/month growing at ${returnPct}% p.a., your client reaches ${inrShort(targetNum)} by ${date} — having invested only ${inr(invested)}. Every month of delay pushes that date further out.`, "success"),
    ];
  },
};

/** HabitCorpusCalculator.tsx — Small Habit, Big Corpus (habitToCorpus). The web's
 *  preset chips set the amount and frequency; here each preset keeps its own
 *  (editable) amount and frequency, and "Custom" starts at the web's defaults. */
type Freq = "daily" | "weekly" | "monthly";
const FREQ: { value: Freq; label: string; perMonth: number }[] = [
  { value: "daily", label: "Per day", perMonth: 30 },
  { value: "weekly", label: "Per week", perMonth: 4.333 },
  { value: "monthly", label: "Per month", perMonth: 1 },
];
const HABITS: { key: string; label: string; amount: number; freq: Freq }[] = [
  { key: "chai", label: "☕ Chai/Coffee", amount: 150, freq: "daily" },
  { key: "cigarettes", label: "🚬 Cigarettes", amount: 300, freq: "daily" },
  { key: "eatingout", label: "🍔 Eating out", amount: 2000, freq: "weekly" },
  { key: "ott", label: "📺 OTT/Subscriptions", amount: 1500, freq: "monthly" },
  { key: "custom", label: "Custom", amount: 150, freq: "daily" },
];
const habitOf = (v: Record<string, any>) => HABITS.find((h) => h.key === v.habit) ?? HABITS[0];
const habit: CalcBody = {
  inputs: [
    { key: "habit", label: "Habit", type: "select", default: "chai", options: HABITS.map((h) => ({ value: h.key, label: h.label })) },
    ...HABITS.flatMap((h): InputSpec[] => [
      { key: `${h.key}Amount`, label: "Amount (₹)", type: "money", default: h.amount, visibleIf: (v) => habitOf(v).key === h.key },
      { key: `${h.key}Freq`, label: "Frequency", type: "segmented", default: h.freq, options: FREQ.map((f) => ({ value: f.value, label: f.label })), visibleIf: (v) => habitOf(v).key === h.key },
    ]),
    { key: "years", label: "Years invested", type: "years", default: 30 },
    { key: "returnPct", label: "Expected return (% p.a.)", type: "percent", default: 12 },
  ],
  compute: (v) => {
    const h = habitOf(v);
    const amount = nn(v[`${h.key}Amount`]);
    const freq = FREQ.find((f) => f.value === v[`${h.key}Freq`]) ?? FREQ.find((f) => f.value === h.freq)!;
    const returnPct = nn(v.returnPct);
    const years = nn(v.years);
    const res = habitToCorpus({ monthlyAmount: amount * freq.perMonth, annualReturnPct: returnPct, years });
    return [
      stat("That's per month", inr(Math.round(res.monthly)), "brand"),
      stat("If you just spend it", inr(res.spent), "danger"),
      stat(`If you invest it (${years} yrs)`, inr(Math.round(res.corpus)), "success"),
      insight(`That ${inr(amount)} ${freq.label.toLowerCase()} habit is ${inr(Math.round(res.monthly))}/month. Invested at ${returnPct}% for ${years} years it becomes ${inrShort(res.corpus)} — a ${inrShort(res.gain)} wealth gain over simply spending it.`, "success"),
    ];
  },
};

/** FdVsEquityGap.tsx — FD vs Equity, the Wealth Gap (fdVsEquity). */
const fdgap: CalcBody = {
  inputs: [
    { key: "lumpsum", label: "One-time lumpsum (₹)", type: "money", default: 1000000 },
    { key: "sip", label: "Monthly SIP (₹)", type: "money", default: 20000 },
    { key: "years", label: "Years", type: "years", default: 20 },
    { key: "fdRate", label: "FD rate (% p.a.)", type: "percent", default: 6.5 },
    { key: "equityRate", label: "Equity return (% p.a.)", type: "percent", default: 12 },
  ],
  compute: (v) => {
    const years = nn(v.years);
    const res = fdVsEquity({ lumpsum: nn(v.lumpsum), monthlySip: nn(v.sip), years, fdRatePct: nn(v.fdRate), equityRatePct: nn(v.equityRate) });
    const multiple = res.fd > 0 ? res.eq / res.fd : 0;
    return [
      stat("In a bank FD", inr(Math.round(res.fd)), "warning"),
      stat("In equity", inr(Math.round(res.eq)), "success"),
      stat("Wealth gap", inrShort(res.gap), "danger"),
      insight(`On ${inr(res.invested)} invested, equity grows to ${inrShort(res.eq)} versus ${inrShort(res.fd)} in an FD over ${years} years — about ${multiple.toFixed(1)}×, a ${inrShort(Math.abs(res.gap))} ${res.gap >= 0 ? "gap in equity's favour" : "gap in the FD's favour"}. FD interest is also fully taxable at slab rate.`, "success"),
    ];
  },
};

/** RentVsBuyPlanner.tsx — Rent vs Buy, & Invest the Difference (rentVsBuy). */
const rentbuy: CalcBody = {
  inputs: [
    { key: "homePrice", label: "Home price (₹)", type: "money", default: 10000000 },
    { key: "downPct", label: "Down payment (%)", type: "percent", default: 20 },
    { key: "loanRate", label: "Loan rate (% p.a.)", type: "percent", default: 8.5 },
    { key: "loanYears", label: "Loan tenure (yrs)", type: "years", default: 20 },
    { key: "appreciation", label: "Home appreciation (% p.a.)", type: "percent", default: 7 },
    { key: "maintenance", label: "Maintenance (% / yr)", type: "percent", default: 1 },
    { key: "rent", label: "Monthly rent (₹)", type: "money", default: 30000 },
    { key: "rentInflation", label: "Rent inflation (% p.a.)", type: "percent", default: 7 },
    { key: "equityReturn", label: "Equity return (% p.a.)", type: "percent", default: 12 },
    { key: "horizon", label: "Compare over (yrs)", type: "years", default: 20 },
  ],
  compute: (v) => {
    const horizon = nn(v.horizon);
    const res = rentVsBuy({
      homePrice: nn(v.homePrice), downPaymentPct: nn(v.downPct), loanRatePct: nn(v.loanRate), loanYears: nn(v.loanYears),
      homeAppreciationPct: nn(v.appreciation), maintenancePctPerYear: nn(v.maintenance), monthlyRent: nn(v.rent),
      rentInflationPct: nn(v.rentInflation), equityReturnPct: nn(v.equityReturn), horizonYears: horizon,
    });
    const gap = Math.abs(res.buyNetWorth - res.rentNetWorth);
    const why = res.winner === "rent"
      ? "When equity is expected to out-earn property, the disciplined renter-investor wins — but a home also brings security & forced savings."
      : "A leveraged, appreciating asset plus forced savings wins here.";
    return [
      stat("Home loan EMI", `${inr(Math.round(res.emi))}/mo`, "brand"),
      stat(`Buy — net worth in ${horizon} yrs`, inr(Math.round(res.buyNetWorth)), res.winner === "buy" ? "success" : undefined),
      stat("Rent + invest — net worth", inr(Math.round(res.rentNetWorth)), res.winner === "rent" ? "success" : undefined),
      insight(`Over ${horizon} years, ${res.winner === "buy" ? "buying" : "renting & investing the difference"} comes out ahead by ${inrShort(gap)}. ${why}`, res.winner === "rent" ? "brand" : "success"),
      insight("Illustration only. Assumes the rent-vs-EMI surplus is invested every month without fail; ignores taxes, stamp duty, brokerage and emotional value of owning. Returns are not guaranteed.", "warning"),
    ];
  },
};

/** LifestyleShockCalculator.tsx — Inflation Lifestyle Shock (lifestyleShock). */
const lifestyle: CalcBody = {
  inputs: [
    { key: "monthlyExpense", label: "Monthly expense today (₹)", type: "money", default: 75000 },
    { key: "inflation", label: "Inflation (% p.a.)", type: "percent", default: 6 },
    { key: "yearsToRetire", label: "Years to retirement", type: "years", default: 25 },
    { key: "retirementYears", label: "Years in retirement", type: "years", default: 25 },
    { key: "postReturn", label: "Post-retirement return (% p.a.)", type: "percent", default: 9 },
  ],
  compute: (v) => {
    const inflation = nn(v.inflation);
    const yearsToRetire = nn(v.yearsToRetire);
    const retirementYears = nn(v.retirementYears);
    const res = lifestyleShock({
      monthlyExpenseToday: nn(v.monthlyExpense), inflationPct: inflation, yearsToRetire, retirementYears, postReturnPct: nn(v.postReturn),
    });
    const future = `${inr(Math.round(res.futureMonthly))}/mo`;
    return [
      stat(`In ${yearsToRetire} years, the same lifestyle costs`, future, "danger", `that’s ${res.multiple.toFixed(1)}× today’s ${inr(res.todayMonthly)}/mo`),
      stat("Today", `${inr(res.todayMonthly)}/mo`),
      stat(`In ${yearsToRetire} yrs`, future, "danger"),
      stat("Corpus to sustain it", inrShort(res.corpusNeeded), "success"),
      insight(`At ${inflation}% inflation, your ${inr(res.todayMonthly)}/month lifestyle becomes ${inr(Math.round(res.futureMonthly))}/month in ${yearsToRetire} years. To fund ${retirementYears} years of that, you’ll need a corpus of ${inrShort(res.corpusNeeded)} — starting today is the cheapest it will ever be.`, "warning"),
    ];
  },
};

/** MoneyLastCalculator.tsx — Will My Money Last? (moneyLast). */
const moneylast: CalcBody = {
  inputs: [
    { key: "corpus", label: "Retirement corpus (₹)", type: "money", default: 30000000 },
    { key: "currentAge", label: "Current age", type: "int", default: 60 },
    { key: "withdrawal", label: "Monthly withdrawal (₹)", type: "money", default: 150000 },
    { key: "returnPct", label: "Return (% p.a.)", type: "percent", default: 8 },
    { key: "withdrawalInflation", label: "Withdrawal step-up (% p.a.)", type: "percent", default: 6 },
    { key: "lifeExpectancy", label: "Life expectancy (age)", type: "int", default: 85 },
  ],
  compute: (v) => {
    const corpus = nn(v.corpus);
    const withdrawal = nn(v.withdrawal);
    const returnPct = nn(v.returnPct);
    const withdrawalInflation = nn(v.withdrawalInflation);
    const lifeExpectancy = nn(v.lifeExpectancy);
    const res = moneyLast({
      corpus, currentAge: nn(v.currentAge), monthlyWithdrawal: withdrawal, annualReturnPct: returnPct,
      withdrawalInflationPct: withdrawalInflation, lifeExpectancy,
    });
    const ok = res.lastsForLife;
    const shortfallYears = res.runsOutAge != null && !ok ? Math.max(0, lifeExpectancy - res.runsOutAge) : 0;
    const out: ResultBlock[] = [
      stat(
        ok ? "The money outlives the plan" : "The money runs out early",
        res.runsOutAge == null ? "Lasts for life ✓" : ok ? `Lasts to age ${Math.floor(res.runsOutAge)} ✓` : `Runs out at age ${Math.floor(res.runsOutAge)}`,
        ok ? "success" : "danger",
        ok ? `Beyond the planned life expectancy of ${lifeExpectancy}.` : `That's ${shortfallYears.toFixed(0)} years short of the planned ${lifeExpectancy}.`,
      ),
      stat("Starting corpus", inrShort(corpus), "brand"),
      stat("First-year withdrawal", `${inr(withdrawal)}/mo`),
      stat("Lasts for", res.runsOutAge == null ? "Lifetime" : `${res.yearsLasted.toFixed(0)} yrs`, ok ? "success" : "danger"),
    ];
    if (res.schedule.length > 0) {
      out.push(
        section("Year-by-year — withdrawals & balance left"),
        table(
          ["Age", "Opening balance", "Withdrawn (year)", "Growth", "Balance after withdrawal"],
          res.schedule.map((s) => [`Age ${Math.round(s.age)}`, inrShort(s.opening), inrShort(s.withdrawn), inrShort(s.growth), inrShort(s.balance)]),
          true,
        ),
      );
    }
    out.push(ok
      ? insight(`With ${inrShort(corpus)} earning ${returnPct}% and a ${inr(withdrawal)}/month withdrawal (stepped up ${withdrawalInflation}%/yr), the client is covered for life.`, "success")
      : insight(`At ${inr(withdrawal)}/month (stepped up ${withdrawalInflation}%/yr), the corpus runs dry at age ${Math.floor(res.runsOutAge ?? 0)} — ${shortfallYears.toFixed(0)} years too soon. A larger corpus, a lower withdrawal, or a higher-return allocation closes the gap.`, "danger"));
    return out;
  },
};

/** CroreRaceCalculator.tsx — ₹1 Crore Race (croreRace). The race's bars
 *  (SIP · time · date) are a table. */
const RUNGS = [5000, 10000, 25000, 50000, 100000];
const crorerace: CalcBody = {
  inputs: [
    { key: "yourSip", label: "Your SIP (₹/mo)", type: "money", default: 25000 },
    { key: "lumpsum", label: "One-time lumpsum (₹)", type: "money", default: 0 },
    { key: "returnPct", label: "Expected return (% p.a.)", type: "percent", default: 12 },
    { key: "target", label: "Goal", type: "segmented", default: "10000000", options: TARGETS },
  ],
  compute: (v) => {
    const yourSip = nn(v.yourSip);
    const targetNum = targetOf(v.target);
    const today = new Date();
    const amounts = Array.from(new Set<number>([...RUNGS, yourSip].filter((a) => a > 0))).sort((a, b) => a - b);
    const race = croreRace({ sipAmounts: amounts, lumpsum: nn(v.lumpsum), annualReturnPct: nn(v.returnPct), target: targetNum });
    const yours = race.find((r) => r.sip === yourSip);
    return [
      table(
        ["SIP", "Time", "Reached by"],
        race.map((r) => [
          `${inr(r.sip)}/mo`,
          r.months != null ? `${(r.months / 12).toFixed(1)} yrs` : "60+ yrs",
          r.months != null ? monthYearAfter(today, r.months) : "—",
        ]),
      ),
      yours && yours.months != null
        ? insight(`At ${inr(yourSip)}/month, your client reaches ${inrShort(targetNum)} in ${(yours.months / 12).toFixed(1)} years (by ${monthYearAfter(today, yours.months)}). Doubling the SIP doesn’t take half the time — but it gets there meaningfully sooner. Pick the finish line, then the SIP.`, "success")
        : insight(`At ${inr(yourSip)}/month the goal isn’t reached within 60 years — step up the SIP or add a lumpsum.`, "success"),
    ];
  },
};

export const DEFS: Record<string, CalcBody> = {
  property, debtfund, emisip, assetalloc, loanemi,
  crorepati, habit, fdgap, rentbuy, lifestyle, moneylast, crorerace,
};
