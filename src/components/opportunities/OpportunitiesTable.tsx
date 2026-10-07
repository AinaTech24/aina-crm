"use client";

/** The Opportunities list view — the same rows as the board, one per line. */

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { formatDate, formatMoney } from "@/lib/format";
import type { BoardRow } from "@/lib/opportunities/board";
import { daysInStage, followUpState } from "@/components/opportunities/OpportunityBoard";
import { cn } from "@/lib/utils";

const COLUMNS: Column<BoardRow>[] = [
  {
    key: "client", header: "Client",
    cell: (r) => <span className="font-medium text-foreground">{r.investorName}</span>,
  },
  { key: "product", header: "Product", cell: (r) => r.productLabel },
  {
    key: "stage", header: "Step",
    cell: (r) => r.status === "won" ? <Badge tone="success" raw>Won</Badge>
      : r.status === "lost" ? <Badge tone="neutral" raw>Lost</Badge>
      : r.later ? <span title={r.later.reason ?? undefined}>Later · back {formatDate(r.later.revisitOn)}</span>
      : <span className={cn(r.delayed && "font-medium text-warning-foreground")}>{r.stageName}</span>,
  },
  {
    key: "value", header: "Expected", align: "right", hideWhenEmpty: true,
    cell: (r) => r.expectedValue == null ? null : (
      <span className="tabular-nums">{formatMoney(r.expectedValue)}{r.investmentMode === "sip" ? <span className="text-muted-foreground">/mo</span> : null}</span>
    ),
  },
  {
    key: "followUp", header: "Next follow-up",
    cell: (r) => {
      const fu = followUpState(r);
      if (!fu) return null;
      return <span className={cn(fu.tone === "danger" && "font-medium text-destructive", fu.tone === "warning" && "font-medium text-warning-foreground")}>{fu.label}</span>;
    },
  },
  {
    key: "days", header: "In this step", hideOnMobile: true,
    cell: (r) => {
      const d = r.status === "open" ? daysInStage(r) : null;
      return d == null ? null : <span className="tabular-nums text-muted-foreground">{d === 0 ? "Today" : `${d} day${d === 1 ? "" : "s"}`}</span>;
    },
  },
  { key: "owner", header: "Owner", hideOnMobile: true, cell: (r) => r.ownerName },
  { key: "opened", header: "Opened", hideOnMobile: true, cell: (r) => <span className="tabular-nums text-muted-foreground">{formatDate(r.createdAt)}</span> },
];

export function OpportunitiesTable({ rows }: { rows: BoardRow[] }) {
  const router = useRouter();
  return (
    <DataTable
      rows={rows}
      columns={COLUMNS}
      rowKey={(r) => r.id}
      onRowClick={(r) => router.push(`/dashboard/opportunities/${r.id}`)}
      empty={<p className="dash-empty">No opportunity matches these filters.</p>}
    />
  );
}
