/**
 * What a new family takes from its head.
 *
 * The client record already carries the RM, branch, segment and review
 * schedule, so the New family form no longer asks for them (the firm's
 * request, 2026-10-02): the family gets its head's. A value an API caller
 * sends explicitly still wins. With no head, the family gets what an empty
 * form always gave it — the creator as RM, their branch, the firm's default
 * cadence.
 */

import { nextFamilyReview } from "./cadence";

type Frequency = "monthly" | "quarterly" | "half_yearly" | "annual";
type Category = "HNI" | "Affluent" | "Retail" | "NRI" | "Corporate";

export type FamilyHead = {
  rmId: string | null;
  branchId: string | null;
  segmentTag: Category | null;
  reviewFrequency: Frequency | null;
  nextReviewAt: Date | null;
};

export function familyDetailsFromHead(args: {
  head: FamilyHead | null;
  explicit: { rmId?: string; familyCategory?: Category; reviewFrequency?: Frequency; firstMeetingDate?: string };
  creator: { userId: string; branchId: string | null };
  firmReviewFrequency: Frequency | null;
  now?: Date;
}) {
  const { head, explicit, creator } = args;
  const reviewFrequency = explicit.reviewFrequency ?? head?.reviewFrequency ?? args.firmReviewFrequency ?? null;
  // A schedule asked for explicitly is computed as asked. Otherwise the
  // family's next review is the head's own — one meeting covers both — and
  // failing that, one cadence from today.
  const explicitSchedule = Boolean(explicit.reviewFrequency || explicit.firstMeetingDate);
  const nextReviewAt =
    !explicitSchedule && head?.nextReviewAt
      ? head.nextReviewAt
      : nextFamilyReview({
          frequency: reviewFrequency,
          firstMeeting: explicit.firstMeetingDate ?? null,
          since: args.now ?? new Date(),
        });
  return {
    rmId: explicit.rmId ?? head?.rmId ?? creator.userId,
    branchId: head?.branchId ?? creator.branchId,
    familyCategory: explicit.familyCategory ?? head?.segmentTag ?? null,
    reviewFrequency,
    firstMeetingDate: explicit.firstMeetingDate ?? null,
    nextReviewAt: nextReviewAt ?? null,
  };
}
