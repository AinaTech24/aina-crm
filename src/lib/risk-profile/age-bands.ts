/**
 * Age → risk category bands.
 *
 * Age is a proxy for INVESTMENT HORIZON, not for risk appetite: a 28-year-old
 * with no emergency fund is not "very aggressive", and a 65-year-old with a
 * pension and a paid-off house may well be. So a category derived here is only
 * ever PROVISIONAL — a starting point the client confirms or changes through
 * their own questionnaire link. Nothing in this file produces a signed profile.
 *
 * Bands are an ordered list of upper bounds. `upTo: null` is the final,
 * open-ended band. A firm can edit them (stored on tenants.risk_age_bands);
 * when they haven't, DEFAULT_AGE_BANDS applies, so improving the default here
 * reaches every firm that never customised it.
 */

import { z } from "zod";
import { RISK_CATEGORIES, type RiskCategory } from "@/lib/risk-profile/apply";

export type AgeBand = {
  /** Inclusive upper age for this band; null = everyone older than the previous band. */
  upTo: number | null;
  category: RiskCategory;
};

/**
 * Product defaults, monotonic from longest to shortest horizon. Deliberately
 * coarse — a finer split would imply a precision age alone cannot support.
 */
export const DEFAULT_AGE_BANDS: AgeBand[] = [
  { upTo: 30, category: "very_aggressive" },
  { upTo: 45, category: "aggressive" },
  { upTo: 57, category: "moderate" },
  { upTo: null, category: "conservative" },
];

export const AgeBandSchema = z.object({
  upTo: z.number().int().min(1).max(120).nullable(),
  category: z.enum(RISK_CATEGORIES),
});

/**
 * A usable band list: 1–8 bands, ascending, exactly one open-ended band and it
 * must be last. Rejecting a malformed list outright is safer than silently
 * "fixing" it — the firm is about to label hundreds of clients with it.
 */
export const AgeBandsSchema = z
  .array(AgeBandSchema)
  .min(1)
  .max(8)
  .superRefine((bands, ctx) => {
    const openIdx = bands.findIndex((b) => b.upTo === null);
    if (openIdx === -1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The last band must be open-ended (no upper age)." });
      return;
    }
    if (openIdx !== bands.length - 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Only the last band may be open-ended." });
    }
    let prev = 0;
    for (let i = 0; i < bands.length - 1; i++) {
      const up = bands[i].upTo!;
      if (up <= prev) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ages must increase down the list." });
        return;
      }
      prev = up;
    }
  });

/** Parse whatever is on the tenant row, falling back to the defaults. */
export function resolveAgeBands(raw: unknown): AgeBand[] {
  if (!raw) return DEFAULT_AGE_BANDS;
  const parsed = AgeBandsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_AGE_BANDS;
}

/** The category for an age, or null when age is unknown / implausible. */
export function categoryForAge(age: number | null | undefined, bands: AgeBand[]): RiskCategory | null {
  if (age == null || !Number.isFinite(age) || age < 1 || age > 120) return null;
  for (const b of bands) {
    if (b.upTo === null || age <= b.upTo) return b.category;
  }
  return bands[bands.length - 1]?.category ?? null;
}

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
