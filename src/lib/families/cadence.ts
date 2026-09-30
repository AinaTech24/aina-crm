/**
 * Family review cadence — adopted from the Sanchay "Meeting Frequency" +
 * "First Meeting Date" fields. The frequency + first-meeting anchor together
 * drive `families.nextReviewAt`, which feeds the Command Center / Team
 * Dashboard "reviews due" and the review-cadence engine.
 */

export const FAMILY_REVIEW_FREQUENCIES = [
  ["monthly", "Monthly"],
  ["quarterly", "Quarterly"],
  ["half_yearly", "Half-yearly"],
  ["annual", "Annual"],
] as const;

const MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  annual: 12,
};

/**
 * Compute the next household review date from the first-meeting anchor + the
 * cadence. If the first meeting is in the future, that IS the next review;
 * otherwise advance by the cadence until the date is strictly in the future.
 * Returns null when either input is missing/invalid.
 */
export function computeFamilyNextReview(
  firstMeeting: string | Date | null | undefined,
  frequency: string | null | undefined,
  now = new Date()
): Date | null {
  if (!firstMeeting || !frequency) return null;
  const m = MONTHS[frequency];
  if (!m) return null;
  const d = new Date(firstMeeting);
  if (isNaN(d.getTime())) return null;
  let guard = 0;
  while (d <= now && guard < 1200) {
    d.setMonth(d.getMonth() + m);
    guard++;
  }
  return d;
}

export function familyReviewFrequencyLabel(frequency: string | null | undefined): string | null {
  return FAMILY_REVIEW_FREQUENCIES.find(([v]) => v === frequency)?.[1] ?? null;
}

/**
 * The next household review for a cadence, from the best anchor the family has:
 *
 *   1. a first-meeting date — a fixed schedule (computeFamilyNextReview);
 *   2. else the last household review — one cadence after it, NOT rolled past
 *      today, so a missed review shows as overdue;
 *   3. else `since` (when the household was created) — one cadence after it.
 *
 * The same shape as a client's review (last review, else onboarding, plus the
 * cadence). Null when there is no frequency — the caller then leaves the
 * current next-review date alone rather than blanking it.
 */
export function nextFamilyReview(args: {
  frequency: string | null | undefined;
  firstMeeting?: string | Date | null;
  lastReview?: string | Date | null;
  since?: string | Date | null;
  now?: Date;
}): Date | null {
  const m = args.frequency ? MONTHS[args.frequency] : undefined;
  if (!m) return null;
  if (args.firstMeeting) return computeFamilyNextReview(args.firstMeeting, args.frequency, args.now);
  const base = args.lastReview ?? args.since ?? args.now ?? new Date();
  const d = new Date(base);
  if (isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + m);
  return d;
}
