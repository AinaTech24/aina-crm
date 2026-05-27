import Link from "next/link";
import { sql } from "drizzle-orm";
import { XOctagon, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatINR, formatDate, formatRelative } from "@/lib/utils";
import { RecoveryStatusUpdater } from "@/components/sip-rejections/RecoveryStatusUpdater";
import { RemarkEditor } from "@/components/sip-rejections/RemarkEditor";
import { FilterBar } from "@/components/common/FilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { ColumnManager } from "@/components/common/ColumnManager";

const SIP_REJ_COLUMNS = [
  { key: "rejected_on", label: "Rejected on", required: true },
  { key: "investor", label: "Investor", required: true },
  { key: "sip", label: "SIP details" },
  { key: "amount", label: "Amount" },
  { key: "reason", label: "Reason" },
  { key: "rm", label: "RM", defaultHidden: true },
  { key: "follow_up", label: "Follow-up" },
  { key: "recovery_date", label: "Recovery date", defaultHidden: true },
  { key: "recovery_status", label: "Recovery status" },
  { key: "remarks", label: "Remarks" },
];

export const dynamic = "force-dynamic";

export default async function SipRejectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const recoveryFilter = (sp.recovery ?? "").split(",").filter(Boolean);
  const overdueOnly = sp.overdue === "1";
  const mtdOnly = sp.mtd === "1";

  const data = await withTenant(session.tenantId, async (tx) => {
    const filters: any[] = [];
    if (q) {
      filters.push(
        sql`(i.name ILIKE ${`%${q}%`} OR r.scheme_name ILIKE ${`%${q}%`} OR r.amc_name ILIKE ${`%${q}%`} OR r.folio_number ILIKE ${`%${q}%`} OR r.rejection_reason ILIKE ${`%${q}%`})`
      );
    }
    if (recoveryFilter.length) {
      filters.push(
        sql`r.recovery_status IN (${sql.join(recoveryFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (overdueOnly) {
      filters.push(
        sql`((now() - r.status_changed_at) > interval '2 days' AND r.recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue'))`
      );
    }
    if (mtdOnly) {
      filters.push(sql`r.rejection_date >= date_trunc('month', now())`);
    }
    const whereSql = filters.length ? sql` WHERE ${sql.join(filters, sql` AND `)}` : sql``;

    const rows = await tx.execute(sql`
      SELECT r.id, r.investor_id, r.rejection_date, r.rejection_amount,
             r.rejection_reason, r.scheme_name, r.folio_number, r.amc_name,
             r.assigned_rm_id, r.follow_up_date, r.recovery_date,
             r.recovery_status, r.status_changed_at, r.remarks, r.created_at,
             i.name AS investor_name, i.pan AS investor_pan,
             u.name AS rm_name,
             ((now() - r.status_changed_at) > interval '2 days'
               AND r.recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue'))
               AS escalation_overdue
      FROM sip_rejections r
      LEFT JOIN investors i ON i.id = r.investor_id
      LEFT JOIN users u ON u.id = r.assigned_rm_id
      ${whereSql}
      ORDER BY r.rejection_date DESC, r.created_at DESC
      LIMIT 200
    `);

    const stats = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE recovery_status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE recovery_status IN ('client_contacted','bank_issue','mandate_issue','reprocessed'))::int AS in_progress,
        COUNT(*) FILTER (WHERE recovery_status = 'recovered')::int AS recovered,
        COUNT(*) FILTER (WHERE recovery_status = 'not_recoverable')::int AS lost,
        COUNT(*) FILTER (WHERE (now() - status_changed_at) > interval '2 days'
          AND recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue'))::int AS overdue,
        COUNT(*) FILTER (WHERE rejection_date >= date_trunc('month', now()))::int AS rejected_mtd,
        COALESCE(SUM(CASE WHEN rejection_date >= date_trunc('month', now())
          THEN rejection_amount::numeric ELSE 0 END), 0)::numeric AS rejected_amt_mtd,
        COALESCE(SUM(CASE WHEN recovery_status = 'recovered'
          AND recovery_date >= date_trunc('month', now())
          THEN rejection_amount::numeric ELSE 0 END), 0)::numeric AS recovered_amt_mtd
      FROM sip_rejections
    `);
    const s = stats.rows[0] as any;
    const recoveryRate =
      Number(s.rejected_amt_mtd) > 0
        ? (Number(s.recovered_amt_mtd) / Number(s.rejected_amt_mtd)) * 100
        : 0;

    return {
      total: Number(s.total),
      pending: Number(s.pending),
      inProgress: Number(s.in_progress),
      recovered: Number(s.recovered),
      lost: Number(s.lost),
      overdue: Number(s.overdue),
      rejectedMtd: Number(s.rejected_mtd),
      rejectedAmtMtd: Number(s.rejected_amt_mtd),
      recoveredAmtMtd: Number(s.recovered_amt_mtd),
      recoveryRate,
      rows: rows.rows as any[],
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <XOctagon className="size-6 text-brand-cyan" /> SIP Rejections
          </h1>
          <p className="text-muted-foreground text-sm">
            Recovery pipeline · 2-day SLA · auto-task on every new rejection.
          </p>
        </div>
        <Link href="/dashboard/reports/sip_recovery_monthly" className="btn-secondary text-xs">
          Monthly recovery report →
        </Link>
      </div>

      <div className="grid grid-cols-6 gap-3">
        <Stat icon={AlertTriangle} label="Total" value={data.total} />
        <Stat icon={Clock} label="Pending" value={data.pending} tone={data.pending > 0 ? "amber" : "muted"} />
        <Stat icon={Clock} label="In progress" value={data.inProgress} />
        <Stat
          icon={AlertTriangle}
          label="SLA breached (>2d)"
          value={data.overdue}
          tone={data.overdue > 0 ? "rose" : "muted"}
        />
        <Stat icon={CheckCircle2} label="Recovered" value={data.recovered} tone="emerald" />
        <Stat
          label="Recovery rate MTD"
          value={`${data.recoveryRate.toFixed(0)}%`}
          tone={data.recoveryRate >= 60 ? "emerald" : data.recoveryRate >= 30 ? "amber" : "rose"}
        />
      </div>

      <div className="card-surface p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Recovery summary — this month</h3>
          <span className="text-xs text-muted-foreground">
            {data.rejectedMtd} rejections · {formatINR(data.rejectedAmtMtd)} value
          </span>
        </div>
        <div className="h-3 bg-rose-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${Math.min(100, data.recoveryRate)}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-emerald-700 font-medium">
            Recovered {formatINR(data.recoveredAmtMtd)}
          </span>
          <span className="text-rose-700">
            Outstanding {formatINR(data.rejectedAmtMtd - data.recoveredAmtMtd)}
          </span>
        </div>
      </div>

      <FilterBar
        totalCount={data.rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search by investor, scheme, AMC, reason…" },
          {
            type: "multi",
            key: "recovery",
            label: "Recovery status",
            options: [
              { value: "pending", label: "Pending" },
              { value: "client_contacted", label: "Client contacted" },
              { value: "bank_issue", label: "Bank issue" },
              { value: "mandate_issue", label: "Mandate issue" },
              { value: "reprocessed", label: "Reprocessed" },
              { value: "recovered", label: "Recovered" },
              { value: "not_recoverable", label: "Not recoverable" },
            ],
          },
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            <ColumnManager moduleKey="sip-rejections" columns={SIP_REJ_COLUMNS} />
            <CustomViews
              viewsKey="views:sip-rejections"
              presets={[
                { id: "open", name: "Open (recovery pending)", params: "recovery=pending,client_contacted,bank_issue,mandate_issue" },
                { id: "breached", name: "SLA breached (>2d)", params: "overdue=1" },
                { id: "recovered", name: "Recovered", params: "recovery=recovered" },
                { id: "this-month", name: "Rejected this month", params: "mtd=1" },
              ]}
            />
          </div>
        }
      />

      <div className="card-surface">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <XOctagon className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No SIP rejections tracked. ✓</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              When a SIP gets rejected, this list auto-populates and creates a high-priority task for the RM.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-table="sip-rejections">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th data-col="rejected_on" className="text-left px-4 py-2 font-medium">Rejected on</th>
                  <th data-col="investor" className="text-left py-2 font-medium">Investor</th>
                  <th data-col="sip" className="text-left py-2 font-medium">SIP details</th>
                  <th data-col="amount" className="text-right py-2 font-medium">Amount</th>
                  <th data-col="reason" className="text-left py-2 font-medium">Reason</th>
                  <th data-col="rm" className="text-left py-2 font-medium">RM</th>
                  <th data-col="follow_up" className="text-left py-2 font-medium">Follow-up</th>
                  <th data-col="recovery_date" className="text-left py-2 font-medium">Recovery</th>
                  <th data-col="recovery_status" className="text-left py-2 font-medium">Recovery Status</th>
                  <th data-col="remarks" className="text-left py-2 font-medium pr-4">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`border-b last:border-0 hover:bg-secondary/40 ${
                      r.escalation_overdue ? "bg-rose-50/30" : ""
                    }`}
                  >
                    <td data-col="rejected_on" className="px-4 py-3 text-xs whitespace-nowrap">
                      <div className="font-medium tabular-nums">{formatDate(r.rejection_date)}</div>
                      <div className="text-muted-foreground">{formatRelative(r.created_at)}</div>
                    </td>
                    <td data-col="investor" className="py-3 whitespace-nowrap">
                      <Link href={`/dashboard/investors/${r.investor_id}`} className="hover:underline font-medium">
                        {r.investor_name ?? "—"}
                      </Link>
                      <div className="text-xs text-muted-foreground font-mono">{r.investor_pan}</div>
                    </td>
                    <td data-col="sip" className="py-3 max-w-[200px]">
                      <div className="text-sm truncate">{r.scheme_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {r.amc_name ?? "—"}
                        {r.folio_number ? <> · <span className="font-mono">{r.folio_number}</span></> : null}
                      </div>
                    </td>
                    <td data-col="amount" className="py-3 text-right tabular-nums font-medium text-rose-600">
                      {formatINR(Number(r.rejection_amount))}
                    </td>
                    <td data-col="reason" className="py-3 text-xs max-w-[180px]">
                      <div className="font-mono text-xs">{r.rejection_reason ?? "—"}</div>
                    </td>
                    <td data-col="rm" className="py-3 text-xs whitespace-nowrap">{r.rm_name ?? "—"}</td>
                    <td data-col="follow_up" className="py-3 text-xs whitespace-nowrap">
                      {r.follow_up_date ? formatDate(r.follow_up_date) : "—"}
                      {r.escalation_overdue && (
                        <div className="text-[10px] text-rose-600 font-semibold">SLA breached</div>
                      )}
                    </td>
                    <td data-col="recovery_date" className="py-3 text-xs whitespace-nowrap">
                      {r.recovery_date ? (
                        <span className="text-emerald-600 font-medium">
                          {formatDate(r.recovery_date)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td data-col="recovery_status" className="py-3 whitespace-nowrap">
                      <RecoveryStatusUpdater rejectionId={r.id} currentStatus={r.recovery_status} />
                    </td>
                    <td data-col="remarks" className="py-3 pr-4">
                      <RemarkEditor rejectionId={r.id} initial={r.remarks ?? null} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  tone?: "rose" | "amber" | "emerald" | "muted";
  icon?: any;
}) {
  const color =
    tone === "rose"
      ? "text-rose-600"
      : tone === "amber"
      ? "text-amber-600"
      : tone === "emerald"
      ? "text-emerald-600"
      : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
