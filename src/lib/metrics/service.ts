/**
 * Service requests — the counts the dashboard, the operations page and the
 * Service Requests page all show, with the page's own tab definitions:
 *
 *   Open               open + in progress           (the page's "Open" tab)
 *   Escalated          escalated                    ("Escalated" tab)
 *   Waiting on client  waiting_customer             ("Waiting on client" tab)
 *   Open on us         open + in progress + escalated — the ball is with us
 *   Past SLA           not resolved/closed and past the resolution SLA —
 *                      the page's `?breached=1`, so a count opens onto the
 *                      same tickets
 *
 * A ticket about a client follows the client (rm / branch). With no RM or
 * branch restriction, tickets with no client are counted too.
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientRecordWhere, cleanIds, hasClientFilter, type MetricScope } from "./scope";

export const SR_OPEN = ["open", "in_progress"] as const;
export const SR_ESCALATED = ["escalated"] as const;
export const SR_WAITING_CLIENT = ["waiting_customer"] as const;
export const SR_OPEN_ON_US = ["open", "in_progress", "escalated"] as const;
export const SR_CLOSED = ["resolved", "closed"] as const;

/** Past the resolution SLA and not closed — the SR page's `breached` filter. */
export function srPastSlaSql(alias = "sr"): SQL {
  const a = sql.raw(alias.replace(/[^a-zA-Z0-9_]/g, ""));
  return sql`${a}.status NOT IN ('resolved', 'closed') AND ${a}.sla_resolution_at < now()`;
}

/** Tenant + the client scope on a service_requests alias `sr` (investor alias `i`, LEFT JOINed). */
export function srWhere(scope: MetricScope): SQL {
  const restricted = cleanIds(scope.rmIds).length || cleanIds(scope.branchIds).length || hasClientFilter(scope);
  // Unrestricted = every ticket of the firm, exactly as the Service Requests
  // page counts them (it neither joins nor filters on the client).
  return restricted
    ? sql`sr.tenant_id = ${scope.tenantId}::uuid AND ${clientRecordWhere(scope, "i")}`
    : sql`sr.tenant_id = ${scope.tenantId}::uuid`;
}

export type ServiceRequestCounts = {
  open: number;
  escalated: number;
  waiting: number;
  onUs: number;
  pastSla: number;
};

export async function getOpenServiceRequests(tx: Tx, scope: MetricScope): Promise<ServiceRequestCounts> {
  const r = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE sr.status IN ('open', 'in_progress'))::int AS open,
      COUNT(*) FILTER (WHERE sr.status = 'escalated')::int AS escalated,
      COUNT(*) FILTER (WHERE sr.status = 'waiting_customer')::int AS waiting,
      COUNT(*) FILTER (WHERE ${srPastSlaSql("sr")})::int AS past_sla
      FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id
     WHERE ${srWhere(scope)}
  `)).rows[0] as Record<string, number> | undefined;
  const open = Number(r?.open ?? 0);
  const escalated = Number(r?.escalated ?? 0);
  return {
    open,
    escalated,
    waiting: Number(r?.waiting ?? 0),
    onUs: open + escalated,
    pastSla: Number(r?.past_sla ?? 0),
  };
}
