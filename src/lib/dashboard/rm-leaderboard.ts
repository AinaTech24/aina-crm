/**
 * RM leaderboard for a period.
 *
 * The version this replaces showed each RM's CURRENT client count and AUM and
 * ignored the dashboard's period filter entirely — its own comment admitted as
 * much. So picking "last quarter" silently produced an all-time snapshot, and
 * the board never moved: an RM who did nothing all quarter still sat at the top
 * on the strength of a book they inherited. A leaderboard that cannot change is
 * not a leaderboard.
 *
 * Everything here is therefore scoped to the window, and the columns are the
 * ones a branch head actually compares people on: money moved, clients gained,
 * leads worked and reviews held.
 *
 * On ranking: sorted by net flows, because that is the money. That single axis
 * is stated in the UI rather than implied — an RM can top this board on one
 * large inflow while converting nothing, and a rank badge that doesn't say what
 * it measures invites exactly that misreading.
 */
import { sql, type SQL } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof import("@/db/client").withTenant>[1]>[0];

export type RmRow = {
  id: string;
  name: string;
  branch: string | null;
  /** Inflow minus outflow across the RM's book, in the window. */
  netFlow: number;
  newClients: number;
  leadsTotal: number;
  leadsConverted: number;
  conversionPct: number;
  reviewsDone: number;
};

export async function loadRmLeaderboard(
  tx: Tx,
  opts: { from: Date; to: Date; branchId?: string | null; limit?: number }
): Promise<RmRow[]> {
  const { from, to, branchId, limit = 10 } = opts;
  const bBranch: SQL = branchId ? sql`u.branch_id = ${branchId}::uuid` : sql`TRUE`;

  // One pass per fact, joined on the RM. Correlated subqueries rather than a
  // chain of LEFT JOINs: joining investors, transactions, leads and
  // review_meetings in one query multiplies the rows and every SUM comes out
  // inflated by the other tables' fan-out.
  const res = await tx.execute(sql`
    SELECT u.id,
           u.name,
           b.name AS branch,
           COALESCE((
             SELECT SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric
                             ELSE -t.amount::numeric END)
               FROM transactions t
               JOIN investors i2 ON i2.id = t.investor_id
              WHERE i2.rm_id = u.id
                AND t.status IN ('successful','processed')
                AND t.order_date >= ${from} AND t.order_date < ${to}
           ), 0)::numeric AS net_flow,
           COALESCE((
             SELECT COUNT(*) FROM investors i3
              WHERE i3.rm_id = u.id AND i3.deleted_at IS NULL
                AND i3.onboarded_at >= ${from} AND i3.onboarded_at < ${to}
           ), 0)::int AS new_clients,
           COALESCE((
             SELECT COUNT(*) FROM leads l
              WHERE l.owner_id = u.id
                AND l.created_at >= ${from} AND l.created_at < ${to}
           ), 0)::int AS leads_total,
           COALESCE((
             SELECT COUNT(*) FROM leads l2
              WHERE l2.owner_id = u.id
                AND l2.converted_investor_id IS NOT NULL
                AND l2.created_at >= ${from} AND l2.created_at < ${to}
           ), 0)::int AS leads_converted,
           COALESCE((
             SELECT COUNT(*) FROM review_meetings rm
              WHERE rm.rm_id = u.id AND rm.status = 'completed'
                AND rm.meeting_date >= ${from} AND rm.meeting_date < ${to}
           ), 0)::int AS reviews_done
      FROM users u
      LEFT JOIN branches b ON b.id = u.branch_id
     WHERE 'rm' = ANY(u.roles) AND u.status = 'active'
       AND ${bBranch}
     ORDER BY net_flow DESC NULLS LAST, new_clients DESC
     LIMIT ${limit}`);

  return (res.rows as Array<Record<string, unknown>>).map((r) => {
    const leadsTotal = Number(r.leads_total) || 0;
    const leadsConverted = Number(r.leads_converted) || 0;
    return {
      id: String(r.id),
      name: String(r.name ?? ""),
      branch: r.branch == null ? null : String(r.branch),
      netFlow: Number(r.net_flow) || 0,
      newClients: Number(r.new_clients) || 0,
      leadsTotal,
      leadsConverted,
      conversionPct: leadsTotal > 0 ? (leadsConverted / leadsTotal) * 100 : 0,
      reviewsDone: Number(r.reviews_done) || 0,
    };
  });
}

/** True when nobody did anything in the window — a board of zeroes is an empty state. */
export function hasLeaderboardSignal(rows: RmRow[]): boolean {
  return rows.some(
    (r) => r.netFlow !== 0 || r.newClients > 0 || r.leadsTotal > 0 || r.reviewsDone > 0
  );
}
