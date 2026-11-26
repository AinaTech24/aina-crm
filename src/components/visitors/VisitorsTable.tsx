"use client";

/** The Visitor Register's list. A row opens the visit. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { formatDate } from "@/lib/format";
import { VISITOR_LABELS, formatVisitTime } from "@/lib/visitors/entry";
import type { VisitorRow } from "@/lib/visitors/service";

export function VisitorsTable({ rows, empty }: { rows: VisitorRow[]; empty?: React.ReactNode }) {
  const router = useRouter();
  const columns: Column<VisitorRow>[] = [
    {
      key: "visitor", header: "Visitor",
      cell: (r) => (
        <div className="min-w-0">
          <Link href={`/dashboard/visitors/${r.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
            {r.visitorName}
          </Link>
          {r.companyName && <div className="text-xs text-muted-foreground">{r.companyName}</div>}
        </div>
      ),
    },
    {
      key: "contact", header: "Contact", hideOnMobile: true, hideWhenEmpty: true,
      cell: (r) => (r.mobile || r.email ? (
        <div className="min-w-0">
          {r.mobile && <div className="whitespace-nowrap tabular-nums">{r.mobile}</div>}
          {r.email && <div className="text-xs text-muted-foreground">{r.email}</div>}
        </div>
      ) : null),
    },
    { key: "date", header: VISITOR_LABELS.visitDate, cell: (r) => <span className="whitespace-nowrap">{formatDate(r.visitDate)}</span> },
    { key: "entry", header: VISITOR_LABELS.entryTime, hideWhenEmpty: true, cell: (r) => (r.entryTime ? <span className="whitespace-nowrap">{formatVisitTime(r.entryTime)}</span> : null) },
    { key: "exit", header: VISITOR_LABELS.exitTime, hideOnMobile: true, hideWhenEmpty: true, cell: (r) => (r.exitTime ? <span className="whitespace-nowrap">{formatVisitTime(r.exitTime)}</span> : null) },
    { key: "meeting", header: VISITOR_LABELS.meetingWithUserId, hideWhenEmpty: true, cell: (r) => r.meetingWithName },
    {
      key: "purpose", header: VISITOR_LABELS.purpose, hideOnMobile: true, hideWhenEmpty: true,
      cell: (r) => (r.purpose ? <span className="line-clamp-2 max-w-xs">{r.purpose}</span> : null),
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      onRowClick={(r) => router.push(`/dashboard/visitors/${r.id}`)}
      caption="Visitors"
      empty={empty}
    />
  );
}
