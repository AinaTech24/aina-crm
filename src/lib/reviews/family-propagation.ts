/**
 * A review meeting with one family member reviews the whole family.
 *
 * MFDs serve households, not individuals. One sitting covers the father's
 * portfolio, the spouse's SIPs and the child's goal plan — but the CRM only
 * ever stamped `last_review_at` / `next_review_at` on the ONE client the
 * meeting row pointed at. Every other member stayed "review overdue", so the
 * RM saw a review-due list full of people they had just sat with, and the only
 * way to clear it was to log a fake meeting per member.
 *
 * `review_meetings.family_id` already existed for "family-level review" and
 * nothing read it. This is what reads it.
 *
 * Two deliberate limits:
 *
 *  - **`last_contact_at` is NOT propagated.** Contact is a fact about a person:
 *    meeting the head of the family is not evidence anyone spoke to the son.
 *    It drives dormancy detection, and bumping it family-wide would silence a
 *    genuine "nobody has spoken to this client in a year" signal, which is
 *    exactly the kind of quiet wrong number this codebase avoids elsewhere.
 *
 *  - **Each member keeps their OWN cadence.** A quarterly client in an annual
 *    family stays quarterly: without an explicit next date the member's next
 *    review is derived from their own `review_frequency`, not the attendee's.
 *    An explicit date from the form is a decision the RM made, so that one
 *    applies to everybody.
 */

import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { investors } from "@/db/schema";
import { computeNextReview } from "@/lib/investors/review-cadence";

type Tx = any;

/** Fallback when a client has no cadence configured — mirrors the caller's. */
const DEFAULT_REVIEW_DAYS = 180;

export type FamilyPropagationResult = {
  /** The family the meeting's client belongs to, or null when they have none. */
  familyId: string | null;
  /** Members updated, EXCLUDING the client the meeting was actually with. */
  updated: number;
  /** Who was updated — carried into the audit row so this is explainable. */
  members: Array<{ id: string; name: string; nextReviewAt: string }>;
};

/**
 * Stamp the review onto every other live member of this client's family.
 *
 * Call inside the same transaction that completes the meeting, AFTER the
 * attendee's own row is updated. Returns what it did so the caller can audit
 * it — a client whose review date moved without a meeting of their own must be
 * able to show why.
 */
export async function propagateReviewToFamily(
  tx: Tx,
  opts: {
    tenantId: string;
    /** The client the meeting was actually with. Never updated here. */
    investorId: string;
    reviewedAt: Date;
    /** ISO date (yyyy-mm-dd) the RM chose on the form, if any. */
    explicitNextReview?: string | null;
  }
): Promise<FamilyPropagationResult> {
  const none: FamilyPropagationResult = { familyId: null, updated: 0, members: [] };

  const [attendee] = await tx
    .select({ familyId: investors.familyId })
    .from(investors)
    .where(and(eq(investors.id, opts.investorId), eq(investors.tenantId, opts.tenantId)))
    .limit(1);
  const familyId: string | null = attendee?.familyId ?? null;
  if (!familyId) return none;

  // Live members only: a deleted or merged-away record must not be revived
  // into the review cycle.
  const members = (await tx
    .select({
      id: investors.id,
      name: investors.name,
      rf: investors.reviewFrequency,
      rfd: investors.reviewFrequencyDays,
    })
    .from(investors)
    .where(
      and(
        eq(investors.tenantId, opts.tenantId),
        eq(investors.familyId, familyId),
        ne(investors.id, opts.investorId),
        isNull(investors.deletedAt),
        isNull(investors.mergedIntoId)
      )
    )) as Array<{ id: string; name: string; rf: string | null; rfd: number | null }>;

  if (members.length === 0) return { familyId, updated: 0, members: [] };

  const updated: FamilyPropagationResult["members"] = [];
  for (const m of members) {
    const next =
      opts.explicitNextReview
        ? new Date(opts.explicitNextReview)
        : computeNextReview(opts.reviewedAt, m.rf as any, m.rfd as any) ??
          new Date(opts.reviewedAt.getTime() + DEFAULT_REVIEW_DAYS * 24 * 60 * 60 * 1000);

    await tx
      .update(investors)
      .set({
        lastReviewAt: opts.reviewedAt,
        nextReviewAt: next,
        updatedAt: new Date(),
      } as any)
      .where(and(eq(investors.id, m.id), eq(investors.tenantId, opts.tenantId)));

    updated.push({ id: m.id, name: m.name, nextReviewAt: next.toISOString().slice(0, 10) });
  }

  return { familyId, updated: updated.length, members: updated };
}

/**
 * Members of a family, for showing the RM who a completion will also cover
 * BEFORE they confirm it. Read-only.
 */
export async function familyMembersFor(
  tx: Tx,
  tenantId: string,
  investorId: string
): Promise<{ familyId: string | null; others: Array<{ id: string; name: string }> }> {
  const rows = (
    await tx.execute(sql`
      SELECT other.id, other.name, me.family_id
        FROM investors me
        JOIN investors other
          ON other.tenant_id = me.tenant_id
         AND other.family_id = me.family_id
         AND other.id <> me.id
         AND other.deleted_at IS NULL
         AND other.merged_into_id IS NULL
       WHERE me.id = ${investorId}::uuid
         AND me.tenant_id = ${tenantId}::uuid
         AND me.family_id IS NOT NULL
       ORDER BY other.name
    `)
  ).rows as Array<{ id: string; name: string; family_id: string }>;

  return {
    familyId: rows[0]?.family_id ?? null,
    others: rows.map((r) => ({ id: r.id, name: r.name })),
  };
}
