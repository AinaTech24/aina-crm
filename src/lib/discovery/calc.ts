/**
 * Financial Discovery — the calculation engine. Pure functions over the
 * fact-find data, shared by the in-meeting RM form (live recalc), the public
 * client wizard, and the server (cached snapshot). Adapted from the
 * "Financial Discovery Form" workbook, with a Financial Health Score and an
 * affordability gap added on top.
 *
 * Money is in ₹. All inputs are tolerant of undefined / strings ("" → 0).
 */

/**
 * One income source. `amount` is per `frequency` (Rs 1,00,000 Monthly = Rs 12 L
 * a year). `annualAmount` is the pre-2026-10 field, already a yearly figure, so
 * a row saved before the change keeps reading exactly as it did.
 */
export type IncomeRow = {
  source?: string;
  amount?: number | string;
  annualAmount?: number | string;
  frequency?: string;
  taxable?: string;
  notes?: string;
};
export type ExpenseMap = {
  rent?: number | string;
  groceries?: number | string;
  education?: number | string;
  insurance?: number | string;
  vehicle?: number | string;
  utilities?: number | string;
  medical?: number | string;
  entertainment?: number | string;
  clothing?: number | string;
  other?: number | string;
};
export type AssetRow = { description?: string; category?: string; currentValue?: number | string; invested?: number | string; liquid?: string; notes?: string };
export type LiabilityRow = { description?: string; type?: string; outstanding?: number | string; emi?: number | string; ratePct?: number | string; tenureMonths?: number | string; notes?: string };
export type LifePolicyRow = { policy?: string; type?: string; sumAssured?: number | string; premium?: number | string; term?: number | string; maturityYear?: number | string; nominee?: string; status?: string };
export type HealthPolicyRow = { insurer?: string; type?: string; sumInsured?: number | string; premium?: number | string; members?: string; floater?: string; expiry?: string; remarks?: string };
export type GoalRow = { description?: string; type?: string; targetYear?: number | string; targetCorpus?: number | string; alreadySaved?: number | string; sipEst?: number | string; priority?: string };

export type DiscoveryData = {
  identification?: Record<string, any>;
  income?: IncomeRow[];
  expenses?: ExpenseMap;
  surplusInputs?: { annualLoanEmis?: number | string; annualInsurancePremiums?: number | string; estimatedTax?: number | string };
  assets?: AssetRow[];
  liabilities?: LiabilityRow[];
  lifeInsurance?: LifePolicyRow[];
  healthInsurance?: HealthPolicyRow[];
  goals?: GoalRow[];
  /** Risk-profiling answers (the behavioural questions from RISK_QUESTIONS). */
  riskProfile?: Record<string, string>;
  /** The risk profile on record in the Risk Profiles module. When present it
   *  IS the client's risk profile here; the questionnaire is not asked again. */
  recordedRisk?: RecordedRisk;
  /** Fields and lists filled in from the client / lead record (lib/discovery/prefill). */
  prefilledFromRecord?: string[];
  /** Monthly SIPs the client already runs with the firm (from the record). Shown
   *  in the surplus section for context; not part of any calculation. */
  existingSipMonthly?: number;
  recommendations?: any[];
  assessment?: Record<string, any>;
};

import { computeRisk, type RiskResult } from "./risk";

export type RecordedRisk = {
  /** conservative | moderate | aggressive | very_aggressive */
  category: string;
  score: number | null;
  /** ISO date it was signed / completed. */
  date: string | null;
  /** Suggested in bulk and not yet confirmed by the client. */
  provisional: boolean;
  responseId: string | null;
};

const n = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const x = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};

/** Payments a year for each income frequency. Blank reads as a yearly figure. */
export const FREQUENCY_PER_YEAR: Record<string, number> = {
  Monthly: 12, Quarterly: 4, "Half-Yearly": 2, Annually: 1, "One-time": 1,
};

/** One income row as a yearly figure (see IncomeRow). */
export function annualIncomeOf(r: IncomeRow): number {
  if (r.amount != null && r.amount !== "") return n(r.amount) * (FREQUENCY_PER_YEAR[String(r.frequency ?? "")] ?? 1);
  return n(r.annualAmount);
}

/** Today's date in India, 'YYYY-MM-DD'. */
function indiaToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * Age in whole years from a 'YYYY-MM-DD' DOB on `today` ('YYYY-MM-DD'), so a
 * birthday later in the year is not counted yet.
 */
function ageFromDob(dob: unknown, today: string): number | null {
  const m = String(dob ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  const t = today.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m || !t) return null;
  let age = Number(t[1]) - Number(m[1]);
  if (`${t[2]}-${t[3]}` < `${m[2]}-${m[3]}`) age -= 1;
  return age > 0 && age < 120 ? age : null;
}

/**
 * Return assumed for a goal, by how far away it is. A goal three years out
 * cannot be funded on equity returns, so it is not planned on them.
 */
export function goalReturnPct(years: number): number {
  if (years < 3) return 7;
  if (years < 5) return 9;
  return 11;
}

/** Benchmark health cover a household should hold, in rupees. */
export const HEALTH_COVER_TARGET = 1_000_000;

export type DiscoveryComputed = {
  grossAnnualIncome: number;
  monthlyExpenses: number;
  annualExpenses: number;
  annualLoanEmis: number;
  annualInsurancePremiums: number;
  estimatedTax: number;
  netInvestableSurplus: number;
  monthlySipCapacity: number;
  surplusRatio: number; // surplus / income
  totalAssets: number;
  totalInvested: number;
  liquidAssets: number;
  totalLiabilities: number;
  totalEmi: number;
  netWorth: number;
  debtToAssetRatio: number; // %
  totalLifeCover: number;
  totalLifePremium: number;
  recommendedLifeCover: number; // 10x income + loans (loans only with no dependents)
  lifeCoverGap: number;
  totalHealthCover: number;
  totalCorpusTarget: number;
  totalAlreadySaved: number;
  totalSipNeeded: number;
  emergencyFundTarget: number; // 6× monthly expenses
  emergencyFundCovered: number; // liquidAssets / target, capped 1
  affordabilityGap: number; // capacity − needed (negative = shortfall)
  /**
   * 0-100 over the pillars the fact-find has data for; null until at least two
   * pillars do. A pillar with no data scores nothing and counts for nothing:
   * before 2026-10 a blank form scored 70 "Good".
   */
  healthScore: number | null;
  healthBand: "Excellent" | "Good" | "Fair" | "Needs work" | "Incomplete";
  scoreParts: { label: string; score: number; max: number; hint: string; known: boolean }[];
  /** Where the loan EMIs and insurance premiums deducted from income came from. */
  emiSource: "liabilities" | "typed" | "none";
  premiumSource: "policies" | "typed" | "none";
  /** Risk profile (0–50 score, 6-band) + product suitability matrix. */
  risk: RiskResult;
};

/** Monthly SIP needed to reach a future corpus, given years and an assumed
 *  annual return. Standard FV-of-annuity solved for the payment. */
export function sipForGoal(targetCorpus: number, alreadySaved: number, years: number, annualReturnPct = 11): number {
  const gap = Math.max(0, targetCorpus - alreadySaved * Math.pow(1 + annualReturnPct / 100, Math.max(0, years)));
  if (gap <= 0 || years <= 0) return 0;
  const r = annualReturnPct / 100 / 12;
  const months = years * 12;
  if (r === 0) return gap / months;
  return (gap * r) / (Math.pow(1 + r, months) - 1);
}

export function computeDiscovery(d: DiscoveryData, opts?: { currentYear?: number; today?: string }): DiscoveryComputed {
  // `today` drives ages and goal horizons. A caller pinning only the year (the
  // financial-plan import) gets mid-year, as before.
  const today = opts?.today ?? (opts?.currentYear ? `${opts.currentYear}-07-01` : indiaToday());
  const year = Number(today.slice(0, 4));
  const grossAnnualIncome = (d.income ?? []).reduce((s, r) => s + annualIncomeOf(r), 0);

  // Loan EMIs and insurance premiums are entered once, where they belong: on
  // the liability and on the policy. The surplus section used to ask for them
  // again, and so did the expenses list, so one Rs 60,000 premium entered
  // wherever the form asked came off the surplus twice. Typed totals are used
  // only by records saved before that, which have no per-row figures.
  const liabilityEmiAnnual = (d.liabilities ?? []).reduce((s, r) => s + n(r.emi), 0) * 12;
  const policyPremiumAnnual =
    (d.lifeInsurance ?? []).reduce((s, r) => s + n(r.premium), 0) +
    (d.healthInsurance ?? []).reduce((s, r) => s + n(r.premium), 0);
  const typedEmis = n(d.surplusInputs?.annualLoanEmis);
  const typedPremiums = n(d.surplusInputs?.annualInsurancePremiums);
  const annualLoanEmis = liabilityEmiAnnual > 0 ? liabilityEmiAnnual : typedEmis;
  const annualInsurancePremiums = policyPremiumAnnual > 0 ? policyPremiumAnnual : typedPremiums;
  const emiSource: DiscoveryComputed["emiSource"] = liabilityEmiAnnual > 0 ? "liabilities" : typedEmis > 0 ? "typed" : "none";
  const premiumSource: DiscoveryComputed["premiumSource"] = policyPremiumAnnual > 0 ? "policies" : typedPremiums > 0 ? "typed" : "none";

  const e = d.expenses ?? {};
  // The old "Insurance premiums" expense line counts only when premiums are
  // known from nowhere else.
  const expenseInsurance = premiumSource === "none" ? n(e.insurance) : 0;
  const monthlyExpenses = n(e.rent) + n(e.groceries) + n(e.education) + expenseInsurance + n(e.vehicle) + n(e.utilities) + n(e.medical) + n(e.entertainment) + n(e.clothing) + n(e.other);
  const annualExpenses = monthlyExpenses * 12;
  const estimatedTax = n(d.surplusInputs?.estimatedTax);

  const netInvestableSurplus = grossAnnualIncome - annualExpenses - annualLoanEmis - annualInsurancePremiums - estimatedTax;
  const monthlySipCapacity = netInvestableSurplus / 12;
  const surplusRatio = grossAnnualIncome > 0 ? netInvestableSurplus / grossAnnualIncome : 0;

  const totalAssets = (d.assets ?? []).reduce((s, r) => s + n(r.currentValue), 0);
  const totalInvested = (d.assets ?? []).reduce((s, r) => s + n(r.invested), 0);
  const liquidAssets = (d.assets ?? []).filter((r) => String(r.liquid).toLowerCase() === "yes").reduce((s, r) => s + n(r.currentValue), 0);
  const totalLiabilities = (d.liabilities ?? []).reduce((s, r) => s + n(r.outstanding), 0);
  const totalEmi = (d.liabilities ?? []).reduce((s, r) => s + n(r.emi), 0);
  const netWorth = totalAssets - totalLiabilities;
  const debtToAssetRatio = totalAssets > 0 ? (totalLiabilities / totalAssets) * 100 : 0;

  const totalLifeCover = (d.lifeInsurance ?? []).reduce((s, r) => s + n(r.sumAssured), 0);
  const totalLifePremium = (d.lifeInsurance ?? []).reduce((s, r) => s + n(r.premium), 0);
  // Life cover has to replace the income for the people who depend on it AND
  // clear the loans. With no dependents (stated as 0) only the loans remain.
  const dependentsRaw = d.identification?.dependents;
  const noDependents = dependentsRaw !== undefined && dependentsRaw !== null && dependentsRaw !== "" && n(dependentsRaw) === 0;
  const recommendedLifeCover = (noDependents ? 0 : grossAnnualIncome * 10) + totalLiabilities;
  const lifeCoverGap = Math.max(0, recommendedLifeCover - totalLifeCover);
  const healthRows = (d.healthInsurance ?? []).filter((r) => n(r.sumInsured) > 0 || String(r.insurer ?? "").trim());
  const totalHealthCover = (d.healthInsurance ?? []).reduce((s, r) => s + n(r.sumInsured), 0);

  const goals = d.goals ?? [];
  const totalCorpusTarget = goals.reduce((s, g) => s + n(g.targetCorpus), 0);
  const totalAlreadySaved = goals.reduce((s, g) => s + n(g.alreadySaved), 0);
  const totalSipNeeded = goals.reduce((s, g) => {
    const explicit = n(g.sipEst);
    if (explicit > 0) return s + explicit;
    const years = Math.max(0, n(g.targetYear) - year);
    return s + sipForGoal(n(g.targetCorpus), n(g.alreadySaved), years, goalReturnPct(years));
  }, 0);

  const emergencyFundTarget = monthlyExpenses * 6;
  const emergencyFundCovered = emergencyFundTarget > 0 ? Math.min(1, liquidAssets / emergencyFundTarget) : 0;
  const affordabilityGap = monthlySipCapacity - totalSipNeeded;

  // ── Financial Health Score ───────────────────────────────────────────────
  // Six pillars, each scored only when the fact-find holds what it needs.
  // Missing data is "not known", never "perfect": a blank form used to score
  // 70 "Good" because no debt read as no debt, no income as fully insured and
  // no expenses as a complete emergency fund.
  const clamp20 = (x: number) => Math.max(0, Math.min(20, Math.round(x)));
  const parts: DiscoveryComputed["scoreParts"] = [];
  const sr = surplusRatio;
  const savingsKnown = grossAnnualIncome > 0 && monthlyExpenses > 0;
  parts.push({
    label: "Savings rate", max: 20, known: savingsKnown,
    score: clamp20((sr / 0.3) * 20),
    hint: savingsKnown ? `${(sr * 100).toFixed(0)}% of income is investable (target 30%+)` : "Needs income and monthly expenses",
  });
  const debtKnown = totalAssets > 0 || totalLiabilities > 0;
  parts.push({
    label: "Debt load", max: 20, known: debtKnown,
    score: totalAssets <= 0 ? (totalLiabilities > 0 ? 0 : 20) : clamp20(20 - ((debtToAssetRatio - 20) / 40) * 20),
    hint: !debtKnown ? "Needs assets or loans" : totalAssets <= 0 ? "Loans with no assets recorded" : `Debt is ${debtToAssetRatio.toFixed(0)}% of assets (target under 40%)`,
  });
  const lifeKnown = grossAnnualIncome > 0 || totalLiabilities > 0;
  const insAdq = recommendedLifeCover > 0 ? totalLifeCover / recommendedLifeCover : 1;
  parts.push({
    label: "Life cover", max: 20, known: lifeKnown,
    score: clamp20(insAdq * 20),
    hint: lifeKnown ? `${(Math.min(insAdq, 9.99) * 100).toFixed(0)}% of the cover needed (${noDependents ? "loans" : "10x income + loans"})` : "Needs income",
  });
  parts.push({
    label: "Health cover", max: 20, known: healthRows.length > 0,
    score: clamp20(Math.min(1, totalHealthCover / HEALTH_COVER_TARGET) * 20),
    hint: healthRows.length > 0 ? `₹${(totalHealthCover / 100000).toFixed(1)} L of a ₹10 L benchmark` : "No health policy recorded",
  });
  parts.push({
    label: "Emergency fund", max: 20, known: monthlyExpenses > 0,
    score: clamp20(emergencyFundCovered * 20),
    hint: monthlyExpenses > 0 ? `${(emergencyFundCovered * 100).toFixed(0)}% of a 6-month buffer in liquid assets` : "Needs monthly expenses",
  });
  const goalKnown = totalSipNeeded > 0 && grossAnnualIncome > 0;
  const goalFund = totalSipNeeded > 0 ? Math.max(0, Math.min(1, monthlySipCapacity / totalSipNeeded)) : 0;
  parts.push({
    label: "Goal funding", max: 20, known: goalKnown,
    score: clamp20(goalFund * 20),
    hint: goalKnown ? `Surplus covers ${(goalFund * 100).toFixed(0)}% of the SIPs the goals need` : totalSipNeeded > 0 ? "Needs income" : "No goals with a target yet",
  });

  const known = parts.filter((p) => p.known);
  const healthScore = known.length >= 2
    ? Math.round((known.reduce((s, p) => s + p.score, 0) / known.reduce((s, p) => s + p.max, 0)) * 100)
    : null;
  const healthBand: DiscoveryComputed["healthBand"] = healthScore == null ? "Incomplete"
    : healthScore >= 80 ? "Excellent" : healthScore >= 60 ? "Good" : healthScore >= 40 ? "Fair" : "Needs work";

  // ── Risk profile + product suitability (workbook engine). Age, income and
  //    net worth are DERIVED from the fact-find above; the rest come from the
  //    risk-profiling answers. ───────────────────────────────────────────────
  const risk = computeRisk({
    answers: d.riskProfile ?? {},
    recordedCategory: d.recordedRisk?.category ?? null,
    recordedScore: d.recordedRisk?.score ?? null,
    age: ageFromDob(d.identification?.dob, today),
    grossAnnualIncome,
    netWorth,
    netWorthKnown: totalAssets > 0 || totalLiabilities > 0,
  });

  return {
    grossAnnualIncome, monthlyExpenses, annualExpenses, annualLoanEmis, annualInsurancePremiums, estimatedTax,
    netInvestableSurplus, monthlySipCapacity, surplusRatio,
    totalAssets, totalInvested, liquidAssets, totalLiabilities, totalEmi, netWorth, debtToAssetRatio,
    totalLifeCover, totalLifePremium, recommendedLifeCover, lifeCoverGap, totalHealthCover,
    totalCorpusTarget, totalAlreadySaved, totalSipNeeded,
    emergencyFundTarget, emergencyFundCovered, affordabilityGap,
    healthScore, healthBand, scoreParts: parts, emiSource, premiumSource,
    risk,
  };
}
