/**
 * The client feedback questionnaire.
 *
 * One definition, used by the public form, the submit endpoint, the dashboard
 * and both PDFs — so a question can never be worded one way on the form and
 * another way on the report.
 *
 * The set is deliberately short. Every extra question costs responses, and a
 * five-question form a client abandons is worth less than a three-question one
 * they finish. Each is rated 0–10 on the same scale, so the answers are
 * comparable and the averages mean something.
 *
 * `recommend` is the Net Promoter question and is stored separately on
 * `service_requests.csat_rating`, which is what the NPS page has always read.
 * Keeping it there means existing feedback still counts towards the score.
 */

export type FeedbackQuestion = {
  key: string;
  label: string;
  /** Shown under the question when the intent isn't obvious from the wording. */
  hint?: string;
  /** The NPS question — exactly one carries this. */
  isNps?: boolean;
};

export const FEEDBACK_QUESTIONS: FeedbackQuestion[] = [
  {
    key: "services",
    label: "How satisfied are you with our services overall?",
  },
  {
    key: "reviews",
    label: "How satisfied are you with your portfolio reviews?",
    hint: "The meetings and updates where we go through how your investments are doing.",
  },
  {
    key: "responsiveness",
    label: "How satisfied are you with how quickly we respond to you?",
    hint: "Calls, emails and requests such as statements or transaction help.",
  },
  {
    key: "clarity",
    label: "How clearly do we explain schemes, risks and charges?",
    hint: "Whether you feel you understand what you hold and what it costs.",
  },
  {
    key: "recommend",
    label: "How likely are you to recommend us to a friend or colleague?",
    isNps: true,
  },
];

export const NPS_QUESTION_KEY =
  FEEDBACK_QUESTIONS.find((q) => q.isNps)?.key ?? "recommend";

/** What the form posts and the service request stores. */
export type FeedbackAnswer = { key: string; label: string; score: number };

/** 0–6 detractor, 7–8 passive, 9–10 promoter — the standard NPS bands. */
export function scoreBand(score: number): "promoter" | "passive" | "detractor" {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

export function bandLabel(score: number): string {
  const b = scoreBand(score);
  return b === "promoter" ? "Promoter" : b === "passive" ? "Passive" : "Detractor";
}

/**
 * Average of the answers, or null when there are none. Used for the "overall"
 * figure on a client's report — distinct from the NPS, which only counts the
 * recommend question.
 */
export function averageScore(answers: FeedbackAnswer[]): number | null {
  const scored = (answers ?? []).filter((a) => Number.isFinite(Number(a.score)));
  if (!scored.length) return null;
  return scored.reduce((s, a) => s + Number(a.score), 0) / scored.length;
}

/** Label for a stored answer key, falling back to the key itself. */
export function labelForKey(key: string): string {
  return FEEDBACK_QUESTIONS.find((q) => q.key === key)?.label ?? key;
}
