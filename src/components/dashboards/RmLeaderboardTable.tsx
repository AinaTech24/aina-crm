import Link from "next/link";
import { Trophy, Users } from "lucide-react";

import { hasLeaderboardSignal, type RmRow } from "@/lib/dashboard/rm-leaderboard";
import { formatINRShort } from "@/lib/utils";
import { EmptySection } from "./EmptySection";

/**
 * RM leaderboard for the selected period.
 *
 * Columns follow a competitor's, because they are the right ones: money moved,
 * clients gained, leads worked, conversion and reviews held. Two departures:
 *
 *  - The sort axis is STATED ("ranked by net flows"), not implied by a podium.
 *    An RM can top this board on one large inflow while converting nothing, and
 *    a medal that doesn't say what it measures invites exactly that misreading.
 *  - Net flow is signed and coloured both ways. Outflow is not a failure — it
 *    is a redemption, and it needs to be visible, not hidden behind an absolute
 *    value like the AUM column this replaces.
 */
function NetFlow({ v }: { v: number }) {
  if (v === 0) return <span className="text-muted-foreground tabular-nums">—</span>;
  return (
    <span className={`tabular-nums font-semibold ${v > 0 ? "text-success" : "text-destructive"}`}>
      {v > 0 ? "+" : "−"}
      {formatINRShort(Math.abs(v))}
    </span>
  );
}

export function RmLeaderboardTable({
  rows,
  periodLabel,
  periodQuery = "",
}: {
  rows: RmRow[];
  periodLabel: string;
  periodQuery?: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptySection
        icon={Users}
        title="RM leaderboard"
        note="No relationship managers configured yet."
        href="/dashboard/settings/team"
        linkLabel="Manage team"
      />
    );
  }
  if (!hasLeaderboardSignal(rows)) {
    return (
      <EmptySection
        icon={Trophy}
        title="RM leaderboard"
        note={`No RM activity in ${periodLabel} — try a wider period.`}
        href={`/dashboard/reports/rm_business${periodQuery}`}
        linkLabel="Full report"
      />
    );
  }

  return (
    <div className="card-surface p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Trophy className="size-4 text-muted-foreground" />
            <span className="section-title">RM leaderboard</span>
            <span className="text-2xs text-muted-foreground truncate">{periodLabel}</span>
          </div>
          <p className="text-2xs text-muted-foreground mt-0.5">
            Ranked by net flows — money in minus money out across each RM&apos;s book.
          </p>
        </div>
        <Link
          href={`/dashboard/reports/rm_business${periodQuery}`}
          className="text-2xs text-muted-foreground hover:text-foreground shrink-0"
        >
          Full report →
        </Link>
      </div>

      <div className="table-scroll">
          <table className="w-full text-xs table-modern">
            <thead>
              <tr>
                <th className="text-left py-1.5 px-2 w-8">#</th>
                <th className="text-left py-1.5 px-2">RM</th>
                <th className="text-left py-1.5 px-2">Branch</th>
                <th className="text-right py-1.5 px-2">Net flows</th>
                <th className="text-right py-1.5 px-2">New clients</th>
                <th className="text-right py-1.5 px-2">Leads</th>
                <th className="text-right py-1.5 px-2">Conversion</th>
                <th className="text-right py-1.5 px-2">Reviews</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.id}>
                  <td className="py-2 px-2 tabular-nums text-muted-foreground">{idx + 1}</td>
                  <td className="py-2 px-2 font-medium whitespace-nowrap">{r.name}</td>
                  <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
                    {r.branch ?? "—"}
                  </td>
                  <td className="py-2 px-2 text-right whitespace-nowrap">
                    <NetFlow v={r.netFlow} />
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">{r.newClients}</td>
                  <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">
                    {r.leadsTotal === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <>
                        {r.leadsConverted}
                        <span className="text-muted-foreground">/{r.leadsTotal}</span>
                      </>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {/* No leads worked is not 0% conversion — it is no
                        denominator. Printing "0%" would rank an RM who was
                        given nothing below one who lost everything. */}
                    {r.leadsTotal === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      `${Math.round(r.conversionPct)}%`
                    )}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">{r.reviewsDone}</td>
                </tr>
              ))}
            </tbody>
          </table>
      </div>
    </div>
  );
}
