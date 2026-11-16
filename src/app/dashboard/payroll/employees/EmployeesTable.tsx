"use client";

import Link from "next/link";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";

export type EmpRow = { userId: string; name: string; code: string | null; gross: number | null; state: string; pf: boolean; esi: boolean; bank: boolean };

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function EmployeesTable({ rows }: { rows: EmpRow[] }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.userId}
      empty="No active team members."
      columns={[
        { key: "name", header: "Employee", cell: (r) => <Link href={`/dashboard/payroll/employees/${r.userId}`} className="font-medium hover:underline">{r.name}</Link> },
        { key: "code", header: "Code", cell: (r) => r.code ?? "", hideWhenEmpty: true, hideOnMobile: true },
        { key: "gross", header: "Monthly gross", cell: (r) => (r.gross == null ? <Badge tone="warning">Not set</Badge> : rupees(r.gross)), align: "right" },
        { key: "state", header: "Works in", cell: (r) => r.state, hideOnMobile: true },
        { key: "stat", header: "PF / ESI", cell: (r) => [r.pf ? "PF" : null, r.esi ? "ESI if eligible" : null].filter(Boolean).join(" · ") || "None", hideOnMobile: true },
        { key: "bank", header: "Bank", cell: (r) => (r.bank ? "Set" : <Badge tone="warning">Missing</Badge>) },
      ]}
    />
  );
}
