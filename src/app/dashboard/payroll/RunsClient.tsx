"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { notify } from "@/components/ui/Toast";
import { RUN_STATUS } from "@/lib/payroll/labels";

export type RunRow = { id: string; period: string; status: string; employees: number; gross: number; net: number; cost: number };

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const monthLabel = (p: string) => new Date(`${p.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

const STATUS = RUN_STATUS;

/** Pick a month — this one, the two before, or the next — and open its pay run. */
export function StartRun({ defaultMonth }: { defaultMonth: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const months = [-2, -1, 0, 1].map((k) => {
    const [y, m] = defaultMonth.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + k, 1));
    return d.toISOString().slice(0, 7);
  });
  const [month, setMonth] = useState(defaultMonth);

  async function start() {
    setBusy(true);
    try {
      const res = await fetch("/api/payroll/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ month }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not start the pay run");
      router.push(`/dashboard/payroll/runs/${j.id}`);
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not start the pay run");
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="run-month" className="sr-only">Month</label>
      <select id="run-month" className="input-base" value={month} onChange={(e) => setMonth(e.target.value)}>
        {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
      </select>
      <Button variant="primary" onClick={start} disabled={busy}>{busy ? "Working…" : "Run payroll"}</Button>
    </div>
  );
}

export function RunsTable({ rows }: { rows: RunRow[] }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.id}
      empty="No pay runs yet. Set salaries under Employees, then run payroll for a month."
      columns={[
        { key: "month", header: "Month", cell: (r) => <Link href={`/dashboard/payroll/runs/${r.id}`} className="font-medium hover:underline">{monthLabel(r.period)}</Link> },
        { key: "status", header: "Status", cell: (r) => <Badge tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</Badge> },
        { key: "people", header: "People", cell: (r) => r.employees, align: "right", hideOnMobile: true },
        { key: "gross", header: "Gross", cell: (r) => rupees(r.gross), align: "right", hideOnMobile: true },
        { key: "net", header: "Net pay", cell: (r) => rupees(r.net), align: "right" },
        { key: "cost", header: "Cost to firm", cell: (r) => rupees(r.cost), align: "right", hideOnMobile: true },
      ]}
    />
  );
}
