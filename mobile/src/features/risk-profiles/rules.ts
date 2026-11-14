/**
 * Risk-profile rules the app must decide exactly as the CRM does. Each block is
 * copied VERBATIM from the CRM file named above it (only the pure parts — those
 * files also import drizzle / zod / the DB, which the app cannot). Keep them in
 * step with their source; change it there first.
 *
 * The one block that is NOT a copy is `riskBucketOf`: the CRM decides the five
 * Risk Profiles tabs only in SQL (riskBucketSql), so this is its TS twin, line
 * for line against that SQL.
 */

// ─────────────────────────────────────────────────────────────────────────────
// src/lib/risk-profile/expiry.ts — the TS twin (verbatim)
// ─────────────────────────────────────────────────────────────────────────────

/** The default life of a profile when it states no expiry of its own. */
export const RISK_PROFILE_DEFAULT_YEARS = 1;

const DAY = 86_400_000;

type RiskDates = {
  riskProfileSignedAt?: Date | string | null;
  riskProfileExpiresOn?: Date | string | null;
  riskProfileExpiryFor?: Date | string | null;
};

/** TS twin of riskExpiresOnSql: the date the profile lapses, or null with no signed profile. */
export function riskExpiresOn(r: RiskDates): Date | null {
  if (!r.riskProfileSignedAt) return null;
  const signed = new Date(r.riskProfileSignedAt);
  if (r.riskProfileExpiresOn && r.riskProfileExpiryFor && new Date(r.riskProfileExpiryFor).getTime() === signed.getTime()) {
    return new Date(r.riskProfileExpiresOn);
  }
  const d = new Date(signed);
  d.setUTCFullYear(d.getUTCFullYear() + RISK_PROFILE_DEFAULT_YEARS);
  return d;
}

/**
 * True once the profile has lapsed: it stays valid THROUGH its expiry date, so
 * it lapses on the next day (the same as `riskExpiresOnSql() < CURRENT_DATE`).
 * A client with no signed profile is not "lapsed", they are missing one.
 */
export function riskProfileLapsed(r: RiskDates, now = new Date()): boolean {
  const e = riskExpiresOn(r);
  if (!e) return false;
  return now.getTime() >= Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()) + DAY;
}

// ─────────────────────────────────────────────────────────────────────────────
// src/lib/risk-profile/buckets.ts — the tab list (verbatim)
// ─────────────────────────────────────────────────────────────────────────────

export type RiskBucket = "not_profiled" | "due" | "current" | "expired" | "awaiting";

export const RISK_BUCKETS: Array<{ key: RiskBucket; label: string }> = [
  { key: "not_profiled", label: "Not profiled" },
  { key: "due", label: "Due for review" },
  { key: "current", label: "Current" },
  { key: "expired", label: "Expired" },
  { key: "awaiting", label: "Awaiting client confirmation" },
];

/** Old ?filter= values still arriving from bookmarks. */
const LEGACY: Record<string, RiskBucket> = {
  needs_review: "not_profiled",
  suggested: "awaiting",
  all: "not_profiled",
};

export function parseRiskBucket(v: string | undefined): RiskBucket {
  if (v && RISK_BUCKETS.some((b) => b.key === v)) return v as RiskBucket;
  return (v && LEGACY[v]) || "not_profiled";
}

// ── TS twin of riskBucketSql / riskBucketCaseSql (buckets.ts) ──
//
//   awaiting      i.risk_profile_provisional = true
//   not_profiled  confirmed AND i.risk_profile_signed_at IS NULL
//   current       confirmed AND expires > CURRENT_DATE + 1 month
//   due           confirmed AND CURRENT_DATE <= expires <= CURRENT_DATE + 1 month
//   expired       everything else (expires < CURRENT_DATE)
//
// Dates are compared as UTC calendar days, as riskProfileLapsed above does.

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** `CURRENT_DATE + interval '1 month'`: Postgres keeps the day, clamped to the month's end. */
function plusOneMonth(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const lastOfNext = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return ymd(new Date(Date.UTC(y, m, Math.min(d, lastOfNext))));
}

export function riskBucketOf(r: RiskDates & { riskProfileProvisional?: boolean | null }, now = new Date()): RiskBucket {
  if (r.riskProfileProvisional === true) return "awaiting";
  if (!r.riskProfileSignedAt) return "not_profiled";
  const exp = riskExpiresOn(r);
  if (!exp || Number.isNaN(exp.getTime())) return "not_profiled";
  const e = ymd(exp);
  const today = ymd(now);
  if (e > plusOneMonth(today)) return "current";
  if (e >= today) return "due";
  return "expired";
}

// ─────────────────────────────────────────────────────────────────────────────
// src/lib/risk-profile/template.ts — scoring (verbatim; the zod schemas there
// are written out here as the plain types they infer)
// ─────────────────────────────────────────────────────────────────────────────

export type RiskTemplateOption = { value: string; label: string; score: number };
export type RiskTemplateQuestion = { key: string; label: string; helperText?: string; type: "single"; options: RiskTemplateOption[] };
export type RiskTemplateBand = { id: string; label: string; minScore: number; maxScore: number; color?: string; description?: string };
export type RiskTemplate = {
  name: string;
  description?: string;
  questions: RiskTemplateQuestion[];
  bands: RiskTemplateBand[];
  reviewIntervalDays: number;
  requireEmailOtp?: boolean;
};

export interface ScoredResponse {
  total: number;
  band: RiskTemplateBand;
  breakdown: Array<{ key: string; question: string; answer: string; score: number }>;
}

/** Score a set of answers against a specific template. */
export function scoreAnswersAgainst(template: RiskTemplate, answers: Record<string, string>): ScoredResponse {
  let total = 0;
  const breakdown: ScoredResponse["breakdown"] = [];
  for (const q of template.questions) {
    const val = answers[q.key];
    if (!val) continue;
    const opt = q.options.find((o) => o.value === val);
    if (!opt) continue;
    total += opt.score;
    breakdown.push({ key: q.key, question: q.label, answer: opt.label, score: opt.score });
  }
  // First band whose [minScore..maxScore] contains the total wins.
  const band =
    template.bands.find((b) => total >= b.minScore && total <= b.maxScore) ??
    template.bands[template.bands.length - 1];
  return { total, band, breakdown };
}

/** Return the score range a template can produce — useful for UI hints. */
export function templateRange(template: RiskTemplate): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const q of template.questions) {
    const scores = q.options.map((o) => o.score);
    min += Math.min(...scores);
    max += Math.max(...scores);
  }
  return { min, max };
}

// ─────────────────────────────────────────────────────────────────────────────
// src/lib/risk-profile/upload.ts — the uploaded-profile checks (verbatim)
// ─────────────────────────────────────────────────────────────────────────────

export const UPLOAD_CATEGORIES = ["conservative", "moderate", "aggressive", "very_aggressive"] as const;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

/** Problems with the two dates, or null. `today` is the India date (YYYY-MM-DD). */
export function validateUploadDates(assessedOn: string, expiresOn: string, today: string): string | null {
  if (assessedOn > today) return "The profile cannot have been assessed in the future.";
  if (expiresOn <= assessedOn) return "Expire On must be after the date it was assessed.";
  if (expiresOn > addDays(assessedOn, 366 * 10)) return "Expire On is more than ten years after the assessment — check the date.";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// src/lib/risk-profile/age-bands.ts — labels (verbatim)
// ─────────────────────────────────────────────────────────────────────────────

export type RiskCategory = (typeof UPLOAD_CATEGORIES)[number];

export type AgeBand = {
  /** Inclusive upper age for this band; null = everyone older than the previous band. */
  upTo: number | null;
  category: RiskCategory;
};

/** "18–30", "31–45", "58+" — the label shown next to each band. */
export function bandLabel(bands: AgeBand[], i: number): string {
  const from = i === 0 ? 18 : (bands[i - 1].upTo ?? 0) + 1;
  const b = bands[i];
  return b.upTo === null ? `${from}+` : `${from}–${b.upTo}`;
}

export const CATEGORY_LABEL: Record<RiskCategory, string> = {
  conservative: "Conservative",
  moderate: "Moderate",
  aggressive: "Aggressive",
  very_aggressive: "Very aggressive",
};

// ─────────────────────────────────────────────────────────────────────────────
// src/lib/export/modules/relationships.ts — how a profile was taken (verbatim)
// ─────────────────────────────────────────────────────────────────────────────

export const VERIFICATION_LABELS: Record<string, string> = {
  rm_entry: "Entered by RM",
  client_otp: "Client (OTP verified)",
  client_physical: "Signed paper form",
  client_link: "Client (secure link)",
};

// ─────────────────────────────────────────────────────────────────────────────
// src/lib/fixed-deposits/terms.ts — the India date (verbatim)
// ─────────────────────────────────────────────────────────────────────────────

export function indiaToday(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

// ── App-side helpers ──────────────────────────────────────────────────────────

/** "very_aggressive" → "Very aggressive"; a firm's own category passes through readable. */
export function categoryLabel(c: string | null | undefined): string {
  if (!c) return "—";
  return CATEGORY_LABEL[c as RiskCategory] ?? c.replace(/_/g, " ").replace(/^\w/, (x) => x.toUpperCase());
}

/** A minor linked to a guardian carries the guardian's profile (migration 0234's trigger condition). */
export function profileIsGuardians(r: { investorCategory?: string | null; guardianInvestorId?: string | null }): boolean {
  return r.investorCategory === "minor" && !!r.guardianInvestorId;
}
