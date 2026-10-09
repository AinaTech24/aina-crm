/**
 * A family is served by ONE relationship manager by default: the RM of its
 * head (the firm's rule, 2026-10-09). Mapping a client into a family gives
 * them the head's RM; making someone else head gives every member the new
 * head's RM. It is a default, not a lock — a member's RM can still be changed
 * on their own record afterwards.
 *
 * Only `investors.rm_id` changes, the same thing the client page's and the
 * bulk "Assign RM" do (the branch is untouched). The family's own rm_id
 * follows the head too, so the family page and the members agree. Every
 * reassignment is audited per client.
 */
import { sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";

/** The head's RM, or null when the family has no head or the head has no RM. */
export async function familyHeadRmId(tx: any, familyId: string): Promise<string | null> {
  const r = await tx.execute(sql`
    SELECT h.rm_id
      FROM families f
      JOIN investors h ON h.id = f.primary_investor_id AND h.tenant_id = f.tenant_id
     WHERE f.id = ${familyId}::uuid
       AND h.deleted_at IS NULL AND h.merged_into_id IS NULL
     LIMIT 1`);
  return ((r.rows ?? [])[0] as any)?.rm_id ?? null;
}

export interface HeadRmResult {
  headRmId: string | null;
  /** Members whose RM was changed to the head's. */
  reassigned: number;
}

/**
 * Give the family's members the head's RM.
 * `onlyInvestorIds` limits it to those members (the ones just mapped);
 * without it every member follows (the head changed).
 */
export async function applyHeadRmToMembers(
  tx: any,
  args: {
    tenantId: string;
    familyId: string;
    onlyInvestorIds?: string[];
    actorUserId: string | null;
    reason: "mapped_to_family" | "head_changed" | "families_merged";
    clientMeta?: Record<string, unknown>;
  }
): Promise<HeadRmResult> {
  const headRmId = await familyHeadRmId(tx, args.familyId);
  if (!headRmId) return { headRmId: null, reassigned: 0 };
  if (args.onlyInvestorIds && !args.onlyInvestorIds.length) return { headRmId, reassigned: 0 };

  const only = args.onlyInvestorIds
    ? sql` AND m.id = ANY(ARRAY[${sql.join(args.onlyInvestorIds.map((id) => sql`${id}`), sql`, `)}]::uuid[])`
    : sql``;
  const before = await tx.execute(sql`
    SELECT m.id, m.rm_id
      FROM investors m
      JOIN families f ON f.id = m.family_id AND f.tenant_id = m.tenant_id
     WHERE m.family_id = ${args.familyId}::uuid
       AND m.tenant_id = ${args.tenantId}::uuid
       AND m.id IS DISTINCT FROM f.primary_investor_id
       AND m.deleted_at IS NULL AND m.merged_into_id IS NULL
       AND m.rm_id IS DISTINCT FROM ${headRmId}::uuid${only}`);
  const rows = (before.rows ?? []) as Array<{ id: string; rm_id: string | null }>;

  if (rows.length) {
    await tx.execute(sql`
      UPDATE investors SET rm_id = ${headRmId}::uuid, updated_at = now()
       WHERE tenant_id = ${args.tenantId}::uuid
         AND id = ANY(ARRAY[${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)}]::uuid[])`);
    for (const r of rows) {
      await recordAudit(tx, {
        tenantId: args.tenantId,
        actorUserId: args.actorUserId,
        action: "investor.rm_from_family_head",
        entityType: "investor",
        entityId: r.id,
        before: { rmId: r.rm_id },
        after: { rmId: headRmId, familyId: args.familyId, reason: args.reason },
        ...(args.clientMeta ?? {}),
      } as any);
    }
  }

  // The family's own RM is the head's too.
  await tx.execute(sql`
    UPDATE families SET rm_id = ${headRmId}::uuid, updated_at = now()
     WHERE id = ${args.familyId}::uuid AND tenant_id = ${args.tenantId}::uuid
       AND rm_id IS DISTINCT FROM ${headRmId}::uuid`);

  return { headRmId, reassigned: rows.length };
}
