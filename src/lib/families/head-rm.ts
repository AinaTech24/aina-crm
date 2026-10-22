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
    reason: "mapped_to_family" | "head_changed" | "families_merged" | "head_rm_changed" | "family_mapping_stage";
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

/**
 * Bring one client's family in line with its head's RM:
 *   - the client heads a family  → every member takes the head's RM (the head's
 *     RM was just changed, or the head reached the Family Mapping step);
 *   - the client is a member     → only this client takes the head's RM (they
 *     reached the Family Mapping step);
 *   - no family                  → nothing to do.
 * A plain edit of a MEMBER's RM never comes through here — a member's RM stays
 * a default, not a lock (see the header).
 */
export async function syncFamilyRmForInvestor(
  tx: any,
  args: {
    tenantId: string;
    investorId: string;
    actorUserId: string | null;
    reason: "head_rm_changed" | "family_mapping_stage";
    /** `head` limits it to a client who heads their family (an RM change on a member must not pull them back). */
    only?: "head";
    clientMeta?: Record<string, unknown>;
  }
): Promise<HeadRmResult | null> {
  const r = await tx.execute(sql`
    SELECT i.family_id, (f.primary_investor_id = i.id) AS is_head
      FROM investors i
      JOIN families f ON f.id = i.family_id AND f.tenant_id = i.tenant_id
     WHERE i.id = ${args.investorId}::uuid AND i.tenant_id = ${args.tenantId}::uuid
     LIMIT 1`);
  const row = ((r.rows ?? [])[0] ?? null) as { family_id: string; is_head: boolean } | null;
  if (!row) return null;
  if (row.is_head) {
    return applyHeadRmToMembers(tx, { ...args, familyId: row.family_id });
  }
  if (args.only === "head") return null;
  return applyHeadRmToMembers(tx, { ...args, familyId: row.family_id, onlyInvestorIds: [args.investorId] });
}

/**
 * A family has ONE RM (the firm's rule, 2026-10-22): when the RM of any member —
 * the head or anyone else — is changed on a client's record or by bulk Assign RM,
 * the head and every other member take the same RM, and so does the family itself.
 * (Before this a member's own change stayed theirs; the member-follows-head rule
 * of mapping, head change and merge is unchanged.)
 *
 * Call after the changed client's own rm_id is written. No family → nothing to do.
 */
export async function setFamilyRmFromClient(
  tx: any,
  args: {
    tenantId: string;
    investorId: string;
    rmId: string;
    actorUserId: string | null;
    clientMeta?: Record<string, unknown>;
  }
): Promise<{ familyId: string | null; reassigned: number }> {
  const f = await tx.execute(sql`
    SELECT family_id FROM investors
     WHERE id = ${args.investorId}::uuid AND tenant_id = ${args.tenantId}::uuid`);
  const familyId = ((f.rows ?? [])[0] as { family_id: string | null } | undefined)?.family_id ?? null;
  if (!familyId) return { familyId: null, reassigned: 0 };

  const before = await tx.execute(sql`
    SELECT id, rm_id FROM investors
     WHERE family_id = ${familyId}::uuid AND tenant_id = ${args.tenantId}::uuid
       AND deleted_at IS NULL AND merged_into_id IS NULL
       AND rm_id IS DISTINCT FROM ${args.rmId}::uuid`);
  const rows = (before.rows ?? []) as Array<{ id: string; rm_id: string | null }>;
  if (rows.length) {
    await tx.execute(sql`
      UPDATE investors SET rm_id = ${args.rmId}::uuid, updated_at = now()
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
        after: { rmId: args.rmId, familyId, reason: "family_rm_changed", changedOn: args.investorId },
        ...(args.clientMeta ?? {}),
      });
    }
  }
  await tx.execute(sql`
    UPDATE families SET rm_id = ${args.rmId}::uuid, updated_at = now()
     WHERE id = ${familyId}::uuid AND tenant_id = ${args.tenantId}::uuid
       AND rm_id IS DISTINCT FROM ${args.rmId}::uuid`);
  return { familyId, reassigned: rows.length };
}
