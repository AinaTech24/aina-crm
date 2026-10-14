/**
 * What a family's members share, so nobody types it twice (the firm's rule,
 * 2026-10-13): the ADDRESS is the head's, and the REVIEW FREQUENCY is the
 * family's. Like the head's RM (head-rm.ts), it is applied when a client is
 * mapped into a family, when the head changes, when families merge, when the
 * head's address changes and when the family's review frequency changes.
 *
 * Members' next review is re-derived from their own last review (else
 * onboarding, else today) on the family's cadence. A family with no review
 * frequency, or a head with no address, leaves that part alone. The client
 * master shows both as "from the family" for a member, not as fields to fill.
 */
import { sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { computeNextReview, type ReviewFrequency } from "@/lib/investors/review-cadence";

export type SharedDetailsReason =
  | "mapped_to_family"
  | "head_changed"
  | "families_merged"
  | "head_address_changed"
  | "family_review_changed";

/** The family's shared details: the head's address and the family's cadence. */
export async function familySharedDetails(tx: any, familyId: string): Promise<{
  headId: string | null;
  address: Record<string, unknown> | null;
  reviewFrequency: ReviewFrequency | null;
}> {
  const r = (await tx.execute(sql`
    SELECT f.primary_investor_id AS head_id, f.review_frequency, h.address
      FROM families f
      LEFT JOIN investors h ON h.id = f.primary_investor_id AND h.tenant_id = f.tenant_id
                           AND h.deleted_at IS NULL AND h.merged_into_id IS NULL
     WHERE f.id = ${familyId}::uuid
     LIMIT 1`)).rows[0] as { head_id: string | null; review_frequency: ReviewFrequency | null; address: any } | undefined;
  const addr = r?.address && typeof r.address === "object" && Object.values(r.address).some((v) => String(v ?? "").trim())
    ? (r.address as Record<string, unknown>)
    : null;
  return { headId: r?.head_id ?? null, address: addr, reviewFrequency: r?.review_frequency ?? null };
}

/**
 * Give the family's members the head's address (never the head itself) and
 * everyone, head included, the family's review frequency. `onlyInvestorIds` limits it to the clients just
 * mapped. Returns how many members changed.
 */
export async function applyFamilySharedDetails(
  tx: any,
  args: {
    tenantId: string;
    familyId: string;
    onlyInvestorIds?: string[];
    actorUserId: string | null;
    reason: SharedDetailsReason;
    clientMeta?: Record<string, unknown>;
  },
): Promise<number> {
  if (args.onlyInvestorIds && !args.onlyInvestorIds.length) return 0;
  const shared = await familySharedDetails(tx, args.familyId);
  if (!shared.address && !shared.reviewFrequency) return 0;

  const only = args.onlyInvestorIds
    ? sql` AND m.id = ANY(ARRAY[${sql.join(args.onlyInvestorIds.map((id) => sql`${id}`), sql`, `)}]::uuid[])`
    : sql``;
  const members = (await tx.execute(sql`
    SELECT m.id, m.address, m.review_frequency, m.review_frequency_days, m.last_review_at, m.onboarded_at, m.next_review_at
      FROM investors m
     WHERE m.tenant_id = ${args.tenantId}::uuid
       AND m.family_id = ${args.familyId}::uuid
       AND m.deleted_at IS NULL AND m.merged_into_id IS NULL${only}`)).rows as Array<{
    id: string; address: any; review_frequency: string | null; review_frequency_days: number | null;
    last_review_at: string | null; onboarded_at: string | null; next_review_at: string | null;
  }>;

  let changed = 0;
  for (const m of members) {
    const set: Record<string, unknown> = {};
    const isHead = m.id === shared.headId;
    if (!isHead && shared.address && JSON.stringify(m.address ?? null) !== JSON.stringify(shared.address)) set.address = shared.address;
    if (shared.reviewFrequency && (m.review_frequency !== shared.reviewFrequency || m.review_frequency_days)) {
      set.reviewFrequency = shared.reviewFrequency;
      set.reviewFrequencyDays = null;
      const base = m.last_review_at ? new Date(m.last_review_at) : m.onboarded_at ? new Date(m.onboarded_at) : new Date();
      set.nextReviewAt = computeNextReview(base, shared.reviewFrequency, null);
    }
    if (!Object.keys(set).length) continue;
    await tx.execute(sql`
      UPDATE investors SET
        ${set.address !== undefined ? sql`address = ${JSON.stringify(set.address)}::jsonb,` : sql``}
        ${set.reviewFrequency !== undefined
          ? sql`review_frequency = ${set.reviewFrequency as string}, review_frequency_days = NULL,
                next_review_at = ${set.nextReviewAt ? (set.nextReviewAt as Date).toISOString() : null}::timestamptz,`
          : sql``}
        updated_at = now()
       WHERE id = ${m.id}::uuid AND tenant_id = ${args.tenantId}::uuid`);
    await recordAudit(tx, {
      tenantId: args.tenantId,
      actorUserId: args.actorUserId,
      action: "investor.details_from_family",
      entityType: "investor",
      entityId: m.id,
      before: { address: m.address, reviewFrequency: m.review_frequency, reviewFrequencyDays: m.review_frequency_days, nextReviewAt: m.next_review_at },
      after: { ...set, familyId: args.familyId, reason: args.reason },
      ...(args.clientMeta ?? {}),
    } as any);
    changed++;
  }
  return changed;
}

/** The family a client heads, if any — their address is the family's. */
export async function familyHeadedBy(tx: any, tenantId: string, investorId: string): Promise<string | null> {
  const r = (await tx.execute(sql`
    SELECT id FROM families WHERE tenant_id = ${tenantId}::uuid AND primary_investor_id = ${investorId}::uuid LIMIT 1`)).rows[0] as { id: string } | undefined;
  return r?.id ?? null;
}
