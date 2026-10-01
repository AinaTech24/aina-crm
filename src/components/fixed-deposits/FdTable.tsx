"use client";

/** The fixed-deposit list — the module page and the client page share it. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { formatDate, formatMoney } from "@/lib/format";
import type { FdRow } from "@/lib/fixed-deposits/service";
import { ISSUER_TYPE_LABELS, PAYOUT_SHORT, STATUS_LABELS, daysToMaturity, indiaToday, isLive, tenureLabel } from "@/lib/fixed-deposits/terms";

const STATUS_TONE: Record<string, BadgeTone> = {
  applied: "info", active: "success", matured: "neutral", renewed: "neutral", closed_early: "neutral", cancelled: "neutral",
};

export function FdStatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"} raw>{STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status}</Badge>;
}

/** "in 12 days" · "today" · "passed 3 days ago" — amber inside 30 days, red once a live FD has passed it. */
export function MaturityNote({ maturityDate, status }: { maturityDate: string; status: string }) {
  if (!isLive(status)) return null;
  const d = daysToMaturity(maturityDate, indiaToday());
  if (d < 0) return <span className="text-xs font-medium text-destructive">Passed {-d} day{d === -1 ? "" : "s"} ago — update status</span>;
  if (d === 0) return <span className="text-xs font-medium text-warning-foreground">Matures today</span>;
  if (d <= 30) return <span className="text-xs font-medium text-warning-foreground">In {d} day{d === 1 ? "" : "s"}</span>;
  return <span className="text-xs text-muted-foreground">In {d} days</span>;
}

export function FdTable({ rows, showClient = true, empty }: { rows: FdRow[]; showClient?: boolean; empty?: React.ReactNode }) {
  const router = useRouter();
  const columns: Column<FdRow>[] = [
    ...(showClient ? [{
      key: "client", header: "Client",
      cell: (r: FdRow) => (
        <div className="min-w-0">
          <Link href={`/dashboard/investors/${r.investorId}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{r.investorName}</Link>
          {r.rmName && <div className="text-xs text-muted-foreground">{r.rmName}</div>}
        </div>
      ),
    }] : []),
    {
      key: "issuer", header: "Bank / company",
      cell: (r) => (
        <div className="min-w-0">
          <div className="font-medium">{r.issuer}</div>
          <div className="text-xs text-muted-foreground">
            {[ISSUER_TYPE_LABELS[r.issuerType], r.fdNumber && `No. ${r.fdNumber}`].filter(Boolean).join(" · ")}
          </div>
        </div>
      ),
    },
    { key: "principal", header: "Amount", align: "right", cell: (r) => <span className="tabular-nums">{formatMoney(r.principal, { scale: "full" })}</span> },
    {
      key: "rate", header: "Rate", align: "right", hideOnMobile: true,
      cell: (r) => <span className="tabular-nums">{r.interestRate.toFixed(2)}%<span className="block text-xs text-muted-foreground">{PAYOUT_SHORT[r.payout]}</span></span>,
    },
    { key: "deposit", header: "Deposited", hideOnMobile: true, cell: (r) => (
      <span className="whitespace-nowrap">{formatDate(r.depositDate)}<span className="block text-xs text-muted-foreground">{tenureLabel(r.tenureMonths, r.tenureDays)}</span></span>
    ) },
    { key: "maturity", header: "Matures", cell: (r) => (
      <span className="whitespace-nowrap">{formatDate(r.maturityDate)}<span className="block"><MaturityNote maturityDate={r.maturityDate} status={r.status} /></span></span>
    ) },
    { key: "maturityAmount", header: "Maturity value", align: "right", hideOnMobile: true,
      cell: (r) => <span className="tabular-nums">{formatMoney(r.maturityAmount ?? r.principal, { scale: "full" })}</span> },
    { key: "status", header: "Status", cell: (r) => <FdStatusBadge status={r.status} /> },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      onRowClick={(r) => router.push(`/dashboard/fixed-deposits/${r.id}`)}
      caption="Fixed deposits"
      empty={empty}
    />
  );
}
