/**
 * A client's branch follows its RM by default (the client master and the
 * branch dashboards scope client facts by `investors.branch_id`). Creating a
 * client, changing their RM on the record, bulk Assign RM and the family RM
 * cascade all move the branch to the new RM's branch; an RM with no branch
 * (an owner, a head-office user) leaves the client's branch as it was. The
 * single-client edit can still set a branch explicitly, which wins.
 */
import { sql } from "drizzle-orm";

/** The RM's branch, or null (no RM, unknown RM, or an RM with no branch). */
export async function rmBranchId(tx: any, tenantId: string, rmId: string | null | undefined): Promise<string | null> {
  if (!rmId) return null;
  const r = await tx.execute(sql`
    SELECT branch_id FROM users WHERE id = ${rmId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`);
  return ((r.rows ?? [])[0] as { branch_id: string | null } | undefined)?.branch_id ?? null;
}

/**
 * SET-clause value for `investors.branch_id` when `rm_id` becomes `rmId`:
 * the RM's branch, else the row's current branch. Use inside an UPDATE of
 * investors (the bare `branch_id` is the row being updated).
 */
export function branchFollowingRmSql(tenantId: string, rmId: string) {
  return sql`COALESCE((SELECT u.branch_id FROM users u WHERE u.id = ${rmId}::uuid AND u.tenant_id = ${tenantId}::uuid), branch_id)`;
}
