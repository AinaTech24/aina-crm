"use client";

/**
 * GoalsBulkTable — the goal-planning list rendered through the generic
 * BulkTable so rows can be selected and bulk-archived (select-all → Archive →
 * clear). Per-row edit/archive stays available via RowActions in the last
 * column.
 *
 * Status, required SIP, gap and the projection come from `live`, computed by
 * the page from each goal's own inputs (lib/goal-planning/stored) — not from
 * the nightly cache, which can be a day behind a rule change or a month tick.
 */

import Link from "next/link";
import { Archive } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { categoryLabel, GOAL_TIER_LABEL, type GoalTier } from "@/lib/goal-planning/calc";
import { RowActions } from "@/components/common/RowActions";
import { BulkTable, type BulkColumn, type BulkAction } from "@/components/common/BulkTable";
import { Avatar } from "@/components/ui/Avatar";

/** What the page computed for this row (see computeStoredGoal). */
export type GoalLive = {
  tier: GoalTier;
  projected: number;
  projectedPct: number;
  requiredSip: number;
  existingSip: number;
  gap: number;
  expectedReturnPct: number;
};

const TIER_TONE: Record<GoalTier, string> = {
  achieved: "bg-blue-50 text-blue-700",
  on_track: "bg-emerald-50 text-emerald-700",
  behind: "bg-amber-50 text-amber-700",
  off_track: "bg-rose-50 text-rose-700",
};

const BAR_TONE: Record<GoalTier, string> = {
  achieved: "bg-blue-500",
  on_track: "bg-emerald-500",
  behind: "bg-amber-500",
  off_track: "bg-rose-500",
};

/** Statuses a person set by hand; they stand in for the computed one. */
const LIFECYCLE: Record<string, { label: string; tone: string }> = {
  on_hold: { label: "On hold", tone: "bg-secondary text-foreground" },
  abandoned: { label: "Abandoned", tone: "bg-rose-50 text-rose-700" },
};

type Row = Record<string, any> & { id: string; live: GoalLive };

const actions: BulkAction[] = [{ kind: "delete", label: "Archive" }];

/** Compact rupees for a table: ₹17.7 Cr · ₹71.4 Lakh · ₹5,000 · ₹0. */
const money = (v: number) => formatMoney(v, { decimals: 1 });
const pctLabel = (p: number) => (p > 999 ? "999%+" : `${Math.round(p)}%`);

export function GoalsBulkTable({ rows }: { rows: Row[] }) {
  const columns: BulkColumn<Row>[] = [
    {
      key: "goal", header: "Goal", tdClass: "px-4 py-3",
      render: (g) => (
        <>
          <Link href={`/dashboard/goals/${g.id}`} className="font-medium hover:underline">{g.name}</Link>
          <div className="text-xs text-muted-foreground">{categoryLabel(g.category)}</div>
        </>
      ),
    },
    {
      key: "investor", header: "Investor", tdClass: "py-3",
      render: (g) => (
        <div className="flex items-center gap-2">
          <Avatar src={g.investorAvatarUrl && g.investorId ? `/api/investors/${g.investorId}/avatar` : null} name={g.investorName} size={26} />
          <Link href={`/dashboard/investors/${g.investorId}`} className="hover:underline">{g.investorName ?? "—"}</Link>
        </div>
      ),
    },
    { key: "target", header: "Target", thClass: "text-right py-2 font-medium", tdClass: "py-3 text-right tabular-nums whitespace-nowrap", render: (g) => money(Number(g.targetAmount)) },
    { key: "linked", header: "Linked", thClass: "text-right py-2 font-medium", tdClass: "py-3 text-right tabular-nums whitespace-nowrap text-muted-foreground", render: (g) => money(Number(g.currentValue ?? 0)) },
    {
      key: "progress", header: "Projected", thClass: "py-2 font-medium", tdClass: "py-3",
      render: (g) => {
        const { tier, projectedPct, projected } = g.live;
        return (
          <div className="w-28" title={`Projected ${money(projected)} by ${new Date(g.targetDate).getFullYear()} at ${g.live.expectedReturnPct}% a year: ${pctLabel(projectedPct)} of the target.`}>
            <div className="flex items-center gap-2">
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary"
                role="progressbar"
                aria-label="Projected value as a share of the target"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, Math.round(projectedPct))}
                aria-valuetext={`${pctLabel(projectedPct)} of target`}
              >
                <div className={`h-full rounded-full ${BAR_TONE[tier]}`} style={{ width: `${Math.min(100, Math.max(0, projectedPct))}%` }} />
              </div>
              <span className="w-10 text-right text-xs tabular-nums">{pctLabel(projectedPct)}</span>
            </div>
            <div className="mt-0.5 text-2xs text-muted-foreground tabular-nums whitespace-nowrap">{money(projected)}</div>
          </div>
        );
      },
    },
    { key: "reqsip", header: "Req. SIP", thClass: "text-right py-2 font-medium", tdClass: "py-3 text-right tabular-nums whitespace-nowrap", render: (g) => money(g.live.requiredSip) },
    { key: "exsip", header: "Existing SIP", thClass: "text-right py-2 font-medium", tdClass: "py-3 text-right tabular-nums whitespace-nowrap text-muted-foreground", render: (g) => money(g.live.existingSip) },
    {
      key: "gap", header: "Gap", thClass: "text-right py-2 font-medium", tdClass: "py-3 text-right tabular-nums whitespace-nowrap",
      render: (g) =>
        g.live.gap > 0
          ? <span className="text-rose-600 font-medium">{money(g.live.gap)}</span>
          : <span className="text-muted-foreground">{money(0)}</span>,
    },
    { key: "year", header: "Target yr", tdClass: "py-3 text-xs text-muted-foreground tabular-nums", render: (g) => new Date(g.targetDate).getFullYear() },
    {
      key: "status", header: "Status", tdClass: "py-3",
      render: (g) => {
        const manual = LIFECYCLE[String(g.status)];
        return manual ? (
          <span className={`chip ${manual.tone}`}>{manual.label}</span>
        ) : (
          <span className={`chip whitespace-nowrap ${TIER_TONE[g.live.tier]}`}>{GOAL_TIER_LABEL[g.live.tier]}</span>
        );
      },
    },
    {
      key: "actions", header: "", thClass: "px-4 py-2", tdClass: "px-4 py-3 text-right",
      render: (g) => (
        <RowActions inline deleteIcon={Archive} editHref={`/dashboard/goals/${g.id}`} deleteUrl={`/api/goals/${g.id}`} itemLabel="goal" itemName={g.name} verb="Archive" />
      ),
    },
  ];

  return <BulkTable rows={rows} columns={columns} endpoint="/api/goals/bulk" actions={actions} itemLabel="goal" rowHref={(g) => `/dashboard/goals/${g.id}`} />;
}
