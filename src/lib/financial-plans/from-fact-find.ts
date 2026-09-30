/**
 * A completed fact-find (financial_discoveries) → the new-plan form's fields,
 * for "Start from a fact-find" on the Financial Plans empty state.
 *
 * Only what the fact-find actually holds comes across; a blank there stays
 * blank here (undefined, never 0). Three translations are deliberate:
 *
 *  - Income is MONTHLY and after the tax the fact-find records, because the
 *    plan's field is the monthly net inflow it subtracts expenses and EMIs from.
 *  - A goal's target corpus is already in future rupees (the fact-find solves
 *    its SIP against it at 11% a year). The plan inflates a present cost, so an
 *    imported goal gets 0% inflation and the same 11% return — otherwise every
 *    target would be inflated twice.
 *  - An asset type with no plain equity / debt / gold / cash / property reading
 *    (hybrid funds, PMS, AIF, SIF, ULIP, endowment) goes in as "other", with the
 *    fact-find's own type kept as its sub-category, rather than being guessed.
 */

import { computeDiscovery, type DiscoveryData } from "@/lib/discovery/calc";
import type { ASSET_TYPES, GOAL_TYPES } from "@/lib/discovery/options";

type AssetCategory = "equity" | "debt" | "gold" | "cash" | "real_estate" | "other";

const ASSET_CATEGORY: Partial<Record<(typeof ASSET_TYPES)[number], AssetCategory>> = {
  "Savings / Current A/C": "cash",
  "Fixed Deposit": "debt",
  "Recurring Deposit": "debt",
  "PPF / EPF / NPS": "debt",
  "MF – Equity": "equity",
  "MF – Debt": "debt",
  "Direct Equity / Shares": "equity",
  "Real Estate": "real_estate",
  "Gold / SGB": "gold",
  "Bonds / Debentures": "debt",
};

const GOAL_CATEGORY: Partial<Record<(typeof GOAL_TYPES)[number], string>> = {
  "Home Purchase": "house",
  "Child Education": "child_education",
  "Child Marriage": "child_marriage",
  Retirement: "retirement",
  "Wealth Creation": "wealth_creation",
  "Emergency Fund": "emergency_fund",
  "Foreign Travel": "vacation",
};

/** The plan form has no "very aggressive"; the fact-find's top band maps to its top. */
const RISK_PROFILE: Record<string, string> = {
  conservative: "conservative",
  moderately_conservative: "moderately_conservative",
  moderate: "moderate",
  moderately_aggressive: "moderately_aggressive",
  aggressive: "aggressive",
  very_aggressive: "aggressive",
};

/** The annual return the fact-find's own goal SIPs assume (calc.ts sipForGoal). */
export const FACT_FIND_GOAL_RETURN = 11;

export type FactFindRecord = {
  id: string;
  subjectType: "lead" | "investor";
  subjectId: string;
  title: string | null;
  status: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  updatedAt: string | null;
  data: unknown;
};

export type FactFindPrefill = {
  recipient: { id: string; name: string; kind: "investor" | "lead" };
  clientAge?: number;
  monthlyIncome?: number;
  monthlyExpenses?: number;
  assets: Array<{ category: AssetCategory; subCategory?: string; name: string; value: number }>;
  liabilities: Array<{ name: string; value: number; monthlyEmi?: number }>;
  emergencyFundCurrentValue?: number;
  lifeInsuranceSumAssured?: number;
  lifeInsuranceAnnualPremium?: number;
  healthInsuranceSumAssured?: number;
  healthInsuranceAnnualPremium?: number;
  goals: Array<{
    category: string;
    name: string;
    targetAmount: number;
    targetYears: number;
    inflationRate: number;
    expectedReturn: number;
    currentValue?: number;
  }>;
  /** Only when every scored risk question was answered. */
  riskProfile?: string;
};

const num = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const x = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};
const positive = (v: number): number | undefined => (v > 0 ? Math.round(v) : undefined);
const text = (v: unknown): string => String(v ?? "").trim();

/** Whole years on `today` from a 'YYYY-MM-DD' date of birth. */
function ageOn(dob: unknown, today: Date): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(dob));
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)) age -= 1;
  return age > 0 && age < 120 ? age : undefined;
}

export function planFromFactFind(f: FactFindRecord, today = new Date()): FactFindPrefill {
  const data = (f.data ?? {}) as DiscoveryData;
  const year = today.getFullYear();
  const c = computeDiscovery(data, { currentYear: year });

  const healthPremium = (data.healthInsurance ?? []).reduce((s, r) => s + num(r.premium), 0);

  return {
    recipient: {
      id: f.subjectId,
      name: text(f.title) || text(data.identification?.fullName) || "Client",
      kind: f.subjectType,
    },
    clientAge: ageOn(data.identification?.dob, today),
    monthlyIncome: c.grossAnnualIncome > 0 ? Math.round((c.grossAnnualIncome - c.estimatedTax) / 12) : undefined,
    monthlyExpenses: positive(c.monthlyExpenses),
    assets: (data.assets ?? [])
      .filter((r) => num(r.currentValue) > 0)
      .map((r) => {
        const type = text(r.category);
        return {
          category: ASSET_CATEGORY[type as (typeof ASSET_TYPES)[number]] ?? "other",
          subCategory: type || undefined,
          name: text(r.description) || type || "Asset",
          value: Math.round(num(r.currentValue)),
        };
      }),
    liabilities: (data.liabilities ?? [])
      .filter((r) => num(r.outstanding) > 0 || num(r.emi) > 0)
      .map((r) => ({
        name: text(r.description) || text(r.type) || "Loan",
        value: Math.round(num(r.outstanding)),
        monthlyEmi: positive(num(r.emi)),
      })),
    // The fact-find counts its liquid assets as the emergency buffer.
    emergencyFundCurrentValue: positive(c.liquidAssets),
    lifeInsuranceSumAssured: positive(c.totalLifeCover),
    lifeInsuranceAnnualPremium: positive(c.totalLifePremium),
    healthInsuranceSumAssured: positive(c.totalHealthCover),
    healthInsuranceAnnualPremium: positive(healthPremium),
    goals: (data.goals ?? [])
      .filter((g) => num(g.targetCorpus) > 0)
      .map((g) => {
        const type = text(g.type);
        const targetYear = num(g.targetYear);
        return {
          category: GOAL_CATEGORY[type as (typeof GOAL_TYPES)[number]] ?? "other",
          name: text(g.description) || type || "Goal",
          targetAmount: Math.round(num(g.targetCorpus)),
          // No target year in the fact-find → 0, for the adviser to set; never a guessed horizon.
          targetYears: targetYear > year ? targetYear - year : 0,
          inflationRate: 0,
          expectedReturn: FACT_FIND_GOAL_RETURN,
          currentValue: positive(num(g.alreadySaved)),
        };
      }),
    riskProfile: c.risk.complete ? RISK_PROFILE[c.risk.bandId] : undefined,
  };
}
