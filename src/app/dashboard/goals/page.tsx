import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { ExportButton } from "@/components/export/ExportButton";
import Link from "next/link";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { Target, Plus } from "lucide-react";
import { withTenant } from "@/db/client";
import { goals, investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { GoalsBulkTable, type GoalLive } from "@/components/goals/GoalsBulkTable";
import { Pager } from "@/components/common/Pager";
import { EmptyState, InlineEmpty } from "@/components/common/EmptyState";
import { buttonClass } from "@/components/ui/button-class";
import { computeStoredGoal } from "@/lib/goal-planning/stored";
import { goalClientScopeSql, visibleGoalInvestorIdsSql } from "@/lib/goal-planning/access";

export const dynamic = "force-dynamic";

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  // Client financial goals — require an investor-view capability and scope
  // non-managers to their own clients (the page previously showed every client's
  // goals to any role).
  requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
  const canViewAll = can(session.roles, "investor.view.all", session.permissions);
  const sp = await searchParams;
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  // Sort the list — by target date or target amount, ascending or descending.
  const sortKey = (["target_date_asc", "target_date_desc", "target_amount_desc", "target_amount_asc"] as const).includes(
    (sp.sort ?? "") as any
  )
    ? (sp.sort as "target_date_asc" | "target_date_desc" | "target_amount_desc" | "target_amount_asc")
    : "target_date_asc";
  const orderBy =
    sortKey === "target_date_desc" ? desc(goals.targetDate)
      : sortKey === "target_amount_desc" ? desc(goals.targetAmount)
        : sortKey === "target_amount_asc" ? asc(goals.targetAmount)
          : asc(goals.targetDate);

  const { rows, stats } = await withTenant(session.tenantId, async (tx) => {
    // Owner slice for non-managers — only goals whose client is assigned to them.
    // Exclude goals whose client is soft-deleted (consistent with the list below).
    // The shared client scope (firm switch / customised "assigned only" /
    // branch) is applied on top of that, here and on the list.
    const statsScope = sql` WHERE investor_id IN ${await visibleGoalInvestorIdsSql(tx, session)}`;
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
          COUNT(*) FILTER (WHERE status = 'not_started')::int AS not_started,
          COUNT(*) FILTER (WHERE next_review_at IS NOT NULL AND next_review_at < now() AND status NOT IN ('achieved','abandoned'))::int AS reviews_overdue
        FROM goals${statsScope}
      `)
    ).rows[0] as any;

    const r = await tx
      .select({ goal: goals, investorName: investors.name, investorAvatarUrl: investors.avatarUrl })
      .from(goals)
      .leftJoin(investors, eq(investors.id, goals.investorId))
      // Exclude goals whose client has been soft-deleted (they live in Trash) —
      // they were showing here with links that 404'd on the deleted client.
      .where(and(
        isNull(investors.deletedAt),
        canViewAll ? undefined : eq(investors.rmId, session.userId),
        await goalClientScopeSql(tx, session, "investors"),
      ))
      .orderBy(orderBy)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);

    const now = new Date();
    return {
      // Flatten for BulkTable (needs a top-level `id`). Status, required SIP,
      // gap and the projection are computed from the goal's own inputs, the
      // same way the nightly recompute does — never read from that cache,
      // which is a day behind a rule change or a month ticking over.
      rows: r.map(({ goal, investorName, investorAvatarUrl }) => {
        const c = computeStoredGoal(goal, { now });
        const live: GoalLive = {
          tier: c.tier,
          projected: c.projectedTotalFV,
          projectedPct: c.projectedPct,
          requiredSip: c.requiredMonthlySipTotal,
          existingSip: Number(goal.existingMonthlySip ?? goal.monthlyContribution ?? 0),
          gap: c.gapAmount,
          expectedReturnPct: Math.round(c.expectedReturnPct * 10) / 10,
        };
        return { ...goal, investorName, investorAvatarUrl, live };
      }),
      stats: {
        total: Number(s.total),
        onTrack: Number(s.on_track),
        behind: Number(s.behind),
        achieved: Number(s.achieved),
        notStarted: Number(s.not_started),
        reviewsOverdue: Number(s.reviews_overdue),
      },
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      {/* With no goals at all the empty state carries the one primary action,
          so the header does not repeat it. */}
      <PageHeaderCard
        title={<><Target className="size-6 text-muted-foreground" /> Goals</>}
        actions={
          stats.total > 0 ? (
            <>
              <ExportButton module="goals" />
              <Link href="/dashboard/goals/new" className={buttonClass("primary")}>
                <Plus className="size-4" /> New goal
              </Link>
            </>
          ) : undefined
        }
      />

      <CompactFilterBar
        totalCount={stats.total}
        rightSlot={<CustomViews viewsKey="views:goals" />}
        filters={[
          {
            type: "sort",
            key: "sort",
            label: "Sort",
            options: [
              { value: "target_date_asc", label: "Target date — soonest" },
              { value: "target_date_desc", label: "Target date — latest" },
              { value: "target_amount_desc", label: "Target ₹ — high to low" },
              { value: "target_amount_asc", label: "Target ₹ — low to high" },
            ],
          },
        ]}
      />

      {stats.total === 0 ? (
        <EmptyState
          icon={Target}
          title="No goals yet"
          description="Pick a client, then the goal — retirement, a child's education, a home — and see the SIP it needs and whether their investments will get there."
          primary={{ href: "/dashboard/goals/new", label: "+ New goal" }}
        />
      ) : (
      <div className="card-surface">
        {rows.length === 0 ? (
          <InlineEmpty message="No goals on this page." action={{ href: "/dashboard/goals", label: "Back to the first page" }} />
        ) : (
          <GoalsBulkTable rows={rows} />
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
      )}
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
