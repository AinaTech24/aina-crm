"use client";

import Link from "next/link";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/format";
import { hoursLeft } from "@/lib/privacy/breaches-core";

export type BreachRow = {
  id: string;
  reference: string;
  title: string;
  detectedAt: string;
  reportDueAt: string;
  boardReportAt: string | null;
  peopleNotifiedAt: string | null;
  status: string;
};

function State({ r }: { r: BreachRow }) {
  if (r.status === "closed") return <Badge tone="neutral">Closed</Badge>;
  if (!r.boardReportAt) {
    const h = hoursLeft(new Date(r.reportDueAt));
    return <Badge tone={h < 0 ? "danger" : "warning"}>{h < 0 ? `Board report ${-h}h late` : `Board report due in ${h}h`}</Badge>;
  }
  if (!r.peopleNotifiedAt) return <Badge tone="warning">People not yet told</Badge>;
  return <Badge tone="success">Reported</Badge>;
}

export function BreachesTable({ rows }: { rows: BreachRow[] }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.id}
      empty="No breaches logged."
      columns={[
        { key: "ref", header: "Reference", cell: (r) => <Link href={`/dashboard/data-breaches/${r.id}`} className="font-medium hover:underline">{r.reference}</Link> },
        { key: "title", header: "What happened", cell: (r) => r.title },
        { key: "detected", header: "Became aware", cell: (r) => formatDate(r.detectedAt), hideOnMobile: true },
        { key: "state", header: "Status", cell: (r) => <State r={r} /> },
      ]}
    />
  );
}
