/**
 * SEBI-style risk-profile questionnaire — 8 questions, weighted scoring.
 *
 * WORDING: every question addresses the INVESTOR directly ("you", "your").
 * The same text is shown on the client's own form (/r/<token>) and in the RM
 * wizard, where the RM reads it out and records the answer — so it must never
 * say "the client", which reads absurdly to the person answering it. The
 * wizard makes the context explicit instead ("recording answers for <name>").
 * Keep new questions in the second person.
 *
 * Each answer carries a score 1–5; total range 8–40 maps to:
 *   8–18  → Conservative
 *   19–29 → Moderate
 *   30–40 → Aggressive
 *
 * This is the single source of truth for the wizard UI, the API scoring
 * helper, and the rendered PDF / record audit. Add new questions by
 * appending here; the rest of the system picks them up.
 */

export type AnswerOption = {
  value: string;
  label: string;
  score: number;
};

export type Question = {
  key: string; // matches the column on risk_profile_responses (e.g. "investmentHorizon")
  label: string;
  helperText?: string;
  type: "single";
  options: AnswerOption[];
};

export const RISK_PROFILE_QUESTIONS: Question[] = [
  {
    key: "age",
    label: "What is your age?",
    helperText: "The more years you can stay invested, the more time your money has to recover from a fall.",
    type: "single",
    options: [
      { value: "under_30", label: "Under 30", score: 5 },
      { value: "30_to_45", label: "30 – 45", score: 4 },
      { value: "45_to_55", label: "45 – 55", score: 3 },
      { value: "55_to_65", label: "55 – 65", score: 2 },
      { value: "over_65", label: "Over 65", score: 1 },
    ],
  },
  {
    key: "investmentHorizon",
    label: "How long do you plan to stay invested?",
    type: "single",
    options: [
      { value: "under_1yr", label: "Less than 1 year", score: 1 },
      { value: "1_to_3yr", label: "1 to 3 years", score: 2 },
      { value: "3_to_5yr", label: "3 to 5 years", score: 3 },
      { value: "5_to_10yr", label: "5 to 10 years", score: 4 },
      { value: "over_10yr", label: "More than 10 years", score: 5 },
    ],
  },
  {
    key: "incomeStability",
    label: "How steady is your income?",
    type: "single",
    options: [
      { value: "variable", label: "It varies a lot — freelance or commission", score: 1 },
      { value: "moderate", label: "Mostly steady, with some ups and downs", score: 2 },
      { value: "stable", label: "A steady salary", score: 4 },
      { value: "highly_stable", label: "Very secure — government, PSU, or several steady sources", score: 5 },
    ],
  },
  {
    key: "riskCapacity",
    label: "How much of your total savings are you investing here?",
    helperText: "If most of your savings sit in one place, a fall hurts a lot more.",
    type: "single",
    options: [
      { value: "very_high", label: "More than 75% of my savings", score: 1 },
      { value: "high", label: "Between half and three quarters", score: 2 },
      { value: "medium", label: "Between a quarter and half", score: 3 },
      { value: "low", label: "Between a tenth and a quarter", score: 4 },
      { value: "very_low", label: "Less than a tenth", score: 5 },
    ],
  },
  {
    key: "riskTolerance",
    label: "If your investment fell 20% in six months, what would you do?",
    type: "single",
    options: [
      { value: "sell_all", label: "Sell everything straight away", score: 1 },
      { value: "sell_some", label: "Sell some, hold the rest", score: 2 },
      { value: "hold", label: "Hold on and wait for it to recover", score: 3 },
      { value: "hold_buy_more", label: "Hold on, and slowly invest a bit more", score: 4 },
      { value: "buy_aggressively", label: "Invest a lot more while prices are low", score: 5 },
    ],
  },
  {
    key: "investmentObjective",
    label: "What are you mainly investing for?",
    type: "single",
    options: [
      { value: "capital_preservation", label: "Keeping my money safe", score: 1 },
      { value: "regular_income", label: "A regular income from it", score: 2 },
      { value: "balanced_growth", label: "A balance of growth and income", score: 3 },
      { value: "long_term_growth", label: "Growing my money over the long term", score: 4 },
      { value: "aggressive_growth", label: "The highest growth I can get, accepting bigger swings", score: 5 },
    ],
  },
  {
    key: "mfExperience",
    label: "How much experience do you have with mutual funds?",
    type: "single",
    options: [
      { value: "none", label: "None — this is my first time", score: 1 },
      { value: "less_than_2yr", label: "Less than 2 years", score: 2 },
      { value: "2_to_5yr", label: "2 – 5 years", score: 3 },
      { value: "5_to_10yr", label: "5 – 10 years", score: 4 },
      { value: "over_10yr", label: "More than 10 years", score: 5 },
    ],
  },
  {
    key: "netWorthBand",
    label: "Roughly what are your total savings and investments worth?",
    type: "single",
    options: [
      { value: "under_10L", label: "Under ₹ 10 lakh", score: 1 },
      { value: "10L_to_50L", label: "₹ 10 L – 50 L", score: 2 },
      { value: "50L_to_1Cr", label: "₹ 50 L – 1 Cr", score: 3 },
      { value: "1Cr_to_5Cr", label: "₹ 1 Cr – 5 Cr", score: 4 },
      { value: "over_5Cr", label: "Over ₹ 5 Cr", score: 5 },
    ],
  },
];

export type RiskCategory = "conservative" | "moderate" | "aggressive";

/**
 * Compute the final category from a total score.
 * Bands: 8–18 conservative, 19–29 moderate, 30–40 aggressive.
 */
export function categoryForScore(total: number): RiskCategory {
  if (total <= 18) return "conservative";
  if (total <= 29) return "moderate";
  return "aggressive";
}

/** Convenience: lookup the score for a given (questionKey, answerValue). */
export function scoreFor(questionKey: string, answerValue: string): number {
  const q = RISK_PROFILE_QUESTIONS.find((x) => x.key === questionKey);
  if (!q) return 0;
  return q.options.find((o) => o.value === answerValue)?.score ?? 0;
}

/** Compute total + category from an answers map. */
export function scoreAnswers(answers: Record<string, string>): {
  total: number;
  category: RiskCategory;
  breakdown: Array<{ key: string; question: string; answer: string; score: number }>;
} {
  const breakdown: Array<{ key: string; question: string; answer: string; score: number }> = [];
  let total = 0;
  for (const q of RISK_PROFILE_QUESTIONS) {
    const val = answers[q.key];
    if (!val) continue;
    const opt = q.options.find((o) => o.value === val);
    if (!opt) continue;
    total += opt.score;
    breakdown.push({ key: q.key, question: q.label, answer: opt.label, score: opt.score });
  }
  return { total, category: categoryForScore(total), breakdown };
}
