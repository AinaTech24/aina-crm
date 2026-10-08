/**
 * Owner dependency — could the firm run a month without its owner?
 * (The E-Myth Revisited: a business that depends on its owner is a job.)
 *
 * Owner = every ACTIVE user of the firm with the `owner` role (there may be
 * several partners; they are one set). Four shares, each "of the whole":
 *
 *   clients     live clients (aliveClient, via clientWhere) whose RM is an owner
 *   tasks       open tasks (TASK_OPEN, not deleted) assigned to an owner
 *   positions   positions whose only active holders are owners. The Owner /
 *               Director position is the owner's by design and is left out
 *               of both sides; a vacant position is not counted as the
 *               owner's (it is nobody's — the Positions page says so).
 *   processes   core processes (lib/practice/catalog) given to a position
 *               whose only active holders are owners, of the processes given
 *               to any position.
 *
 * Clients follow the client (rm_id / branch_id); tasks follow the assignee —
 * the usual MetricScope rules. Positions and processes are firm facts.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { PRACTICE_PROCESSES } from "@/lib/practice/catalog";
import { clientWhere, staffWhere, textList, type MetricScope } from "./scope";
import { TASK_OPEN } from "./tasks";

export type OwnerDependency = {
  ownerCount: number;
  clientsOwnedByOwner: number;
  totalLiveClients: number;
  openTasksAssignedToOwner: number;
  totalOpenTasks: number;
  positionsFilledOnlyByOwner: number;
  totalPositions: number;
  processesOwnedByOwnerOnly: number;
  totalProcesses: number;
};

/** The position that is the owner's by design — not a dependency. */
export const OWNER_POSITION_KEY = "owner_director";

export async function getOwnerDependency(tx: Tx, scope: MetricScope): Promise<OwnerDependency> {
  const t = scope.tenantId;
  const owners = sql`(SELECT id FROM users WHERE tenant_id = ${t}::uuid AND status = 'active' AND 'owner' = ANY(roles))`;

  const r = (await tx.execute(sql`
    WITH holders AS (
      SELECT h.position_id,
             COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE 'owner' = ANY(u.roles))::int AS owners
        FROM practice_position_holders h
        JOIN users u ON u.id = h.user_id AND u.tenant_id = h.tenant_id AND u.status = 'active'
       WHERE h.tenant_id = ${t}::uuid
       GROUP BY h.position_id
    ),
    pos AS (
      SELECT p.id, (hd.n > 0 AND hd.n = hd.owners) AS owner_only
        FROM practice_positions p
        LEFT JOIN holders hd ON hd.position_id = p.id
       WHERE p.tenant_id = ${t}::uuid
    )
    SELECT
      (SELECT COUNT(*)::int FROM users WHERE tenant_id = ${t}::uuid AND status = 'active' AND 'owner' = ANY(roles)) AS owner_count,
      (SELECT COUNT(*)::int FROM investors i WHERE ${clientWhere(scope, "i")}) AS clients,
      (SELECT COUNT(*)::int FROM investors i WHERE ${clientWhere(scope, "i")} AND i.rm_id IN ${owners}) AS clients_owner,
      (SELECT COUNT(*)::int FROM tasks tk
        WHERE tk.tenant_id = ${t}::uuid AND tk.deleted_at IS NULL
          AND tk.status IN (${textList([...TASK_OPEN])})
          AND ${staffWhere(scope, sql`tk.assignee_id`)}) AS tasks,
      (SELECT COUNT(*)::int FROM tasks tk
        WHERE tk.tenant_id = ${t}::uuid AND tk.deleted_at IS NULL
          AND tk.status IN (${textList([...TASK_OPEN])})
          AND ${staffWhere(scope, sql`tk.assignee_id`)}
          AND tk.assignee_id IN ${owners}) AS tasks_owner,
      (SELECT COUNT(*)::int FROM practice_positions p
        WHERE p.tenant_id = ${t}::uuid AND p.key <> ${OWNER_POSITION_KEY}) AS positions,
      (SELECT COUNT(*)::int FROM practice_positions p JOIN pos ON pos.id = p.id
        WHERE p.tenant_id = ${t}::uuid AND p.key <> ${OWNER_POSITION_KEY} AND pos.owner_only) AS positions_owner,
      (SELECT COUNT(*)::int FROM practice_process_settings s JOIN pos ON pos.id = s.owner_position_id
        WHERE s.tenant_id = ${t}::uuid AND s.process_key IN (${textList(PRACTICE_PROCESSES.map((p) => p.key))})) AS processes,
      (SELECT COUNT(*)::int FROM practice_process_settings s JOIN pos ON pos.id = s.owner_position_id
        WHERE s.tenant_id = ${t}::uuid AND s.process_key IN (${textList(PRACTICE_PROCESSES.map((p) => p.key))})
          AND pos.owner_only) AS processes_owner
  `)).rows[0] as Record<string, number | string | null> | undefined;

  const n = (k: string) => Number(r?.[k] ?? 0);
  return {
    ownerCount: n("owner_count"),
    clientsOwnedByOwner: n("clients_owner"),
    totalLiveClients: n("clients"),
    openTasksAssignedToOwner: n("tasks_owner"),
    totalOpenTasks: n("tasks"),
    positionsFilledOnlyByOwner: n("positions_owner"),
    totalPositions: n("positions"),
    processesOwnedByOwnerOnly: n("processes_owner"),
    totalProcesses: n("processes"),
  };
}

export type DependencyLevel = "high" | "medium" | "low";

/** The four shares (0–1) that have a whole to be a share of. */
export function dependencyShares(d: OwnerDependency): number[] {
  const pairs: Array<[number, number]> = [
    [d.clientsOwnedByOwner, d.totalLiveClients],
    [d.openTasksAssignedToOwner, d.totalOpenTasks],
    [d.positionsFilledOnlyByOwner, d.totalPositions],
    [d.processesOwnedByOwnerOnly, d.totalProcesses],
  ];
  return pairs.filter(([, total]) => total > 0).map(([part, total]) => Math.min(1, Math.max(0, part / total)));
}

/**
 * How much of the firm hangs on the owner.
 *   high    the average share is half or more, or any one share is 75%+
 *   medium  the average share is a quarter or more, or any one share is 50%+
 *   low     otherwise, and when nothing has a whole to measure against
 */
export function dependencyLevel(d: OwnerDependency): DependencyLevel {
  const shares = dependencyShares(d);
  if (!shares.length) return "low";
  const avg = shares.reduce((a, s) => a + s, 0) / shares.length;
  const max = Math.max(...shares);
  if (avg >= 0.5 || max >= 0.75) return "high";
  if (avg >= 0.25 || max >= 0.5) return "medium";
  return "low";
}
