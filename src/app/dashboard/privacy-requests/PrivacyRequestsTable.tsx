"use client";

import Link from "next/link";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/format";
import { REQUEST_TYPES, daysLeft, type RequestType } from "@/lib/privacy/requests-core";

export type RequestRow = {
  id: string;
  reference: string;
  requesterName: string;
  type: string;
  status: string;
  receivedAt: string;
  dueAt: string;
  closedAt: string | null;
};

function Deadline({ dueAt }: { dueAt: string }) {
  const d = daysLeft(new Date(dueAt));
  const text = d < 0 ? `${-d} day${d === -1 ? "" : "s"} overdue` : d === 0 ? "Due today" : `${d} day${d === 1 ? "" : "s"} left`;
  return (
    <span className="whitespace-nowrap">
      {formatDate(dueAt)}{" "}
      <Badge tone={d < 0 ? "danger" : d <= 15 ? "warning" : "neutral"}>{text}</Badge>
    </span>
  );
}

export function PrivacyRequestsTable({ rows, closed }: { rows: RequestRow[]; closed: boolean }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.id}
      empty={closed ? "No closed requests yet." : "No open privacy requests."}
      columns={[
        {
          key: "ref",
          header: "Reference",
          cell: (r) => <Link href={`/dashboard/privacy-requests/${r.id}`} className="font-medium hover:underline">{r.reference}</Link>,
        },
        { key: "who", header: "Requested by", cell: (r) => r.requesterName },
        { key: "type", header: "Request", cell: (r) => (REQUEST_TYPES[r.type as RequestType] ?? r.type).split(" —")[0], hideOnMobile: true },
        { key: "received", header: "Received", cell: (r) => formatDate(r.receivedAt), hideOnMobile: true },
        closed
          ? {
              key: "closed",
              header: "Closed",
              cell: (r) => (
                <span className="whitespace-nowrap">
                  {r.closedAt ? formatDate(r.closedAt) : "—"}{" "}
                  <Badge tone={r.status === "completed" ? "success" : "neutral"}>{r.status === "completed" ? "Answered" : "Refused"}</Badge>
                </span>
              ),
            }
          : { key: "due", header: "Answer by", cell: (r) => <Deadline dueAt={r.dueAt} /> },
      ]}
    />
  );
}
