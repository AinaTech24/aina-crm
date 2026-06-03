import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { Target, Plus } from "lucide-react";
import { withTenant } from "@/db/client";
import { goals, investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatINR } from "@/lib/utils";
import { categoryLabel } from "@/lib/goal-planning/calc";
import { RowActions } from "@/components/common/RowActions";
import { Pager } from "@/components/common/Pager";

const STATUS_TONE: Record<string, string> = {
  not_started: "bg-gray-100 text-gray-700",
  on_track: "bg-emerald-50 text-emerald-700",
  behind_track: "bg-amber-50 text-amber-700",
  achieved: "bg-blue-50 text-blue-700",
  // Legacy values display in muted tones
  active: "bg-secondary text-foreground",
  on_hold: "bg-slate-50 text-slate-700",
  abandoned: "bg-rose-50 text-rose-700",
};

export const dynamic = "force-dynamic";

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const { rows, stats } = await withTenant(session.tenantId, async (tx) => {
    // KPIs from a single aggregate over ALL goals — not the paginated slice
    // (the old code derived counts from a LIMIT 200 page, so they capped/lied
    // once a firm had more than 200 goals).
    const s = (
      await tx.execute(sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'on_track')::int AS on_track,
          COUNT(*) FILTER (WHERE status = 'behind_track')::int AS behind,
          COUNT(*) FILTER (WHERE status = 'achieved')::int AS achieved,
          COUNT(*) FILTER (WHERE status = 'not_started')::int AS not_started
        FROM goals
      `)
    ).rows[0] as any;

    const r = await tx
      .select({ goal: goals, investorName: investors.name })
      .from(goals)
      .leftJoin(investors, eq(investors.id, goals.investorId))
      .orderBy(goals.targetDate)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);

    return {
      rows: r,
      stats: {
        total: Number(s.total),
        onTrack: Number(s.on_track),
        behind: Number(s.behind),
        achieved: Number(s.achieved),
        notStarted: Number(s.not_started),
      },
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Target className="size-6 text-brand-cyan" /> Goal planning
          </h1>
          <p className="text-muted-foreground text-sm">
            Track every client's financial goals — required SIP, gap analysis, on-track status.
          </p>
        </div>
        <Link href="/dashboard/goals/new" className="btn-primary">
          <Plus className="size-4" /> Add Goal
        </Link>
      </div>

      {/* KPI row — 5 spec statuses */}
      <div className="grid grid-cols-5 gap-3">
        <Stat label="Total goals" value={stats.total} />
        <Stat label="On Track" value={stats.onTrack} tone="emerald" />
        <Stat label="Behind Track" value={stats.behind} tone={stats.behind > 0 ? "amber" : "muted"} />
        <Stat label="Achieved" value={stats.achieved} tone="emerald" />
        <Stat label="Not Started" value={stats.notStarted} tone={stats.notStarted > 0 ? "amber" : "muted"} />
      </div>

      <div className="card-surface">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Target className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No goals tracked yet.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              Click <strong>Add Goal</strong> above to start. The wizard computes required SIP and
              gap analysis live as you type.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Goal</th>
                <th className="text-left py-2 font-medium">Investor</th>
                <th className="text-right py-2 font-medium">Target</th>
                <th className="text-right py-2 font-medium">Linked</th>
                <th className="text-right py-2 font-medium">Req. SIP</th>
                <th className="text-right py-2 font-medium">Existing SIP</th>
                <th className="text-right py-2 font-medium">Gap</th>
                <th className="text-left py-2 font-medium">Target</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ goal: g, investorName }) => {
                const targetYr = new Date(g.targetDate).getFullYear();
                return (
                  <tr key={g.id} className="border-b last:border-0 hover:bg-secondary/40">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/goals/${g.id}`} className="font-medium hover:underline">
                        {g.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{categoryLabel(g.category)}</div>
                    </td>
                    <td className="py-3">
                      <Link href={`/dashboard/investors/${g.investorId}`} className="hover:underline">
                        {investorName ?? "—"}
                      </Link>
                    </td>
                    <td className="py-3 text-right tabular-nums">{formatINR(Number(g.targetAmount))}</td>
                    <td className="py-3 text-right tabular-nums text-muted-foreground">
                      {formatINR(Number(g.currentValue ?? 0))}
                    </td>
                    <td className="py-3 text-right tabular-nums">
                      {g.requiredMonthlySip ? formatINR(Number(g.requiredMonthlySip)) : "—"}
                    </td>
                    <td className="py-3 text-right tabular-nums text-muted-foreground">
                      {g.existingMonthlySip ? formatINR(Number(g.existingMonthlySip)) : "—"}
                    </td>
                    <td className="py-3 text-right tabular-nums">
                      {g.gapAmount && Number(g.gapAmount) > 0 ? (
                        <span className="text-rose-600 font-medium">{formatINR(Number(g.gapAmount))}</span>
                      ) : (
                        <span className="text-emerald-600">—</span>
                      )}
                    </td>
                    <td className="py-3 text-xs text-muted-foreground tabular-nums">{targetYr}</td>
                    <td className="py-3">
                      <span className={`chip capitalize ${STATUS_TONE[g.status] ?? ""}`}>
                        {g.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RowActions
                        editHref={`/dashboard/goals/${g.id}`}
                        deleteUrl={`/api/goals/${g.id}`}
                        itemLabel="goal"
                        itemName={g.name}
                        verb="Archive"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {rows.length > 0 && (
          <div className="px-4 pb-3">
            <Pager
              page={page}
              totalPages={Math.ceil(stats.total / PAGE_SIZE)}
              total={stats.total}
              pageSize={PAGE_SIZE}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "rose" | "amber" | "muted";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "rose"
      ? "text-rose-600"
      : tone === "amber"
      ? "text-amber-600"
      : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
