"use client";

/**
 * The Service Promise page's two lists (client side because DataTable takes
 * cell renderers): promise kept by RM, and the clients behind a gap.
 */

import Link from "next/link";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { InlineEmpty } from "@/components/common/EmptyState";

export type RmRowView = {
  rmId: string | null;
  rmName: string;
  clients: number;
  keptPct: number | null;
  worstKey: string | null;
  worstLabel: string | null;
  worstPct: number | null;
};

export type GapRowView = {
  id: string;
  name: string;
  rmName: string | null;
  tier: string;
  missed: string[];
  daysSince: number | null;
  detail: string;
};

const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

function gapsHref(params: Record<string, string | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return `/dashboard/practice/promise?${qs.toString()}#gaps`;
}

export function RmKeptTable({ rows }: { rows: RmRowView[] }) {
  const rmParam = (r: RmRowView) => r.rmId ?? "none";
  const columns: Column<RmRowView>[] = [
    {
      key: "rm",
      header: "RM",
      cell: (r) => (
        <Link className="font-medium hover:underline" href={gapsHref({ rm: rmParam(r), item: "all" })}>
          {r.rmName}
        </Link>
      ),
    },
    { key: "clients", header: "Clients", align: "right", cell: (r) => r.clients.toLocaleString("en-IN") },
    {
      key: "kept",
      header: "Promise kept",
      align: "right",
      cell: (r) =>
        r.keptPct == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Link className="hover:underline" href={gapsHref({ rm: rmParam(r), item: "all" })}>{pct(r.keptPct)}</Link>
        ),
    },
    {
      key: "worst",
      header: "Worst kept",
      cell: (r) =>
        r.worstKey ? (
          <Link className="hover:underline" href={gapsHref({ rm: rmParam(r), item: r.worstKey })}>
            {r.worstLabel} · {pct(r.worstPct)}
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.rmId ?? "none"}
      caption="Service promise kept, by relationship manager"
      empty={<InlineEmpty message="No client with a service tier yet." />}
    />
  );
}

export function GapsTable({ rows, itemLabels }: { rows: GapRowView[]; itemLabels: Record<string, string> }) {
  const columns: Column<GapRowView>[] = [
    {
      key: "client",
      header: "Client",
      cell: (r) => (
        <Link className="font-medium hover:underline" href={`/dashboard/investors/${r.id}`}>
          {r.name}
        </Link>
      ),
    },
    { key: "tier", header: "Tier", cell: (r) => <Badge tone="neutral" raw>{r.tier}</Badge> },
    { key: "rm", header: "RM", hideOnMobile: true, cell: (r) => r.rmName ?? "No RM" },
    {
      key: "missed",
      header: "Missed",
      cell: (r) => r.missed.map((m) => itemLabels[m] ?? m).join(", "),
    },
    {
      key: "days",
      header: "Days since",
      align: "right",
      cell: (r) => (r.daysSince == null ? "Never" : r.daysSince.toLocaleString("en-IN")),
    },
    { key: "detail", header: "Why", hideOnMobile: true, cell: (r) => <span className="text-muted-foreground">{r.detail}</span> },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      caption="Clients the promise was not kept for"
      empty={<InlineEmpty message="Every client here got this part of the promise." />}
    />
  );
}
