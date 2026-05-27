import Link from "next/link";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { TrendingUp, AlertTriangle, CheckCircle2, Calendar } from "lucide-react";
import { withTenant } from "@/db/client";
import { sips, investors, mandates, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatINR, formatDate } from "@/lib/utils";
import { FilterBar } from "@/components/common/FilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { ColumnManager } from "@/components/common/ColumnManager";

const SIPS_COLUMNS = [
  { key: "investor", label: "Investor", required: true },
  { key: "folio", label: "Folio", defaultHidden: true },
  { key: "scheme", label: "AMC / Scheme" },
  { key: "amount", label: "Amount" },
  { key: "frequency", label: "Frequency" },
  { key: "start", label: "Start date", defaultHidden: true },
  { key: "end", label: "End date", defaultHidden: true },
  { key: "next_due", label: "Next due" },
  { key: "mandate", label: "Mandate", defaultHidden: true },
  { key: "status", label: "Status" },
  { key: "rm", label: "RM" },
  { key: "remarks", label: "Remarks", defaultHidden: true },
];

/** Spec § Module 10 — visual palette */
const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  paused: "bg-amber-50 text-amber-700",
  stopped: "bg-rose-50 text-rose-700",
  rejected: "bg-rose-50 text-rose-700",
  completed: "bg-blue-50 text-blue-700",
  pending: "bg-amber-50 text-amber-700",
  expired: "bg-orange-50 text-orange-700",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  stopped: "Stopped",
  rejected: "Rejected",
  completed: "Completed",
  pending: "Pending",
  expired: "Completed", // legacy → display as Completed per spec
};

const FREQ_LABEL: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  yearly: "Yearly",
};

export const dynamic = "force-dynamic";

export default async function SipsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const statusFilter = (sp.status ?? "").split(",").filter(Boolean);
  const freqFilter = (sp.frequency ?? "").split(",").filter(Boolean);

  const data = await withTenant(session.tenantId, async (tx) => {
    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active')::int AS active_sips,
        COALESCE(SUM(CASE WHEN status = 'active' THEN amount::numeric ELSE 0 END), 0) AS active_amount,
        COUNT(*) FILTER (WHERE status = 'active' AND created_at >= date_trunc('month', now()))::int AS added_mtd,
        COUNT(*) FILTER (WHERE status IN ('stopped', 'rejected') AND updated_at >= date_trunc('month', now()))::int AS lost_mtd,
        COUNT(*) FILTER (WHERE status = 'active' AND end_date IS NOT NULL
          AND end_date <= current_date + interval '90 days')::int AS expiring_soon
      FROM sips
    `);
    const s = stats.rows[0] as any;

    const conds: any[] = [];
    if (q) {
      conds.push(
        or(
          ilike(sips.schemeName, `%${q}%`),
          ilike(sips.amcName, `%${q}%`),
          ilike(sips.folioNumber, `%${q}%`),
          ilike(investors.name, `%${q}%`)
        )!
      );
    }
    if (statusFilter.length) conds.push(inArray(sips.status, statusFilter as any));
    if (freqFilter.length) conds.push(inArray(sips.frequency, freqFilter as any));
    const where = conds.length ? and(...conds) : undefined;

    const rowsQuery = tx
      .select({
        s: sips,
        investorName: investors.name,
        investorRmId: investors.rmId,
        mandateRef: mandates.mandateRefNo,
        mandateStatus: mandates.status,
        rmName: users.name,
      })
      .from(sips)
      .leftJoin(investors, eq(investors.id, sips.investorId))
      .leftJoin(mandates, eq(mandates.id, sips.mandateId))
      .leftJoin(users, eq(users.id, sips.rmId));
    const rows = await (where
      ? rowsQuery.where(where as any).orderBy(desc(sips.updatedAt)).limit(200)
      : rowsQuery.orderBy(desc(sips.updatedAt)).limit(200));

    return {
      activeSips: Number(s.active_sips),
      activeAmount: Number(s.active_amount),
      addedMtd: Number(s.added_mtd),
      lostMtd: Number(s.lost_mtd),
      expiringSoon: Number(s.expiring_soon),
      rows,
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <TrendingUp className="size-6 text-brand-cyan" /> SIP Tracker
        </h1>
        <p className="text-muted-foreground text-sm">
          Active SIP book · month-on-month inflow · mandate-linked installments.
        </p>
      </div>

      <div className="grid grid-cols-5 gap-3">
        <Stat icon={CheckCircle2} label="Active SIPs" value={String(data.activeSips)} tone="emerald" />
        <Stat icon={TrendingUp} label="Active book / mo" value={formatINR(data.activeAmount)} />
        <Stat icon={TrendingUp} label="Added MTD" value={String(data.addedMtd)} tone={data.addedMtd > 0 ? "emerald" : "muted"} />
        <Stat icon={AlertTriangle} label="Stopped MTD" value={String(data.lostMtd)} tone={data.lostMtd > 0 ? "rose" : "muted"} />
        <Stat icon={Calendar} label="Expiring (90d)" value={String(data.expiringSoon)} tone={data.expiringSoon > 0 ? "amber" : "muted"} />
      </div>

      <FilterBar
        totalCount={data.rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search by scheme, AMC, folio, investor…" },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "active", label: "Active" },
              { value: "paused", label: "Paused" },
              { value: "stopped", label: "Stopped" },
              { value: "rejected", label: "Rejected" },
              { value: "completed", label: "Completed" },
              { value: "pending", label: "Pending" },
              { value: "expired", label: "Expired" },
            ],
          },
          {
            type: "multi",
            key: "frequency",
            label: "Frequency",
            options: [
              { value: "monthly", label: "Monthly" },
              { value: "quarterly", label: "Quarterly" },
              { value: "weekly", label: "Weekly" },
              { value: "fortnightly", label: "Fortnightly" },
              { value: "yearly", label: "Yearly" },
            ],
          },
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            <ColumnManager moduleKey="sips" columns={SIPS_COLUMNS} />
            <CustomViews
              viewsKey="views:sips"
              presets={[
                { id: "active", name: "Active SIPs", params: "status=active" },
                { id: "stopped", name: "Stopped / Rejected", params: "status=stopped,rejected" },
                { id: "monthly", name: "Monthly SIPs", params: "frequency=monthly&status=active" },
                { id: "paused", name: "Paused", params: "status=paused" },
              ]}
            />
          </div>
        }
      />

      <div className="card-surface">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <TrendingUp className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No SIPs yet.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              SIPs flow in from AMC feeds (CAMS / KFintech) once registered. Imports populate from Excel too.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-table="sips">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th data-col="investor" className="text-left px-4 py-2 font-medium">Investor</th>
                  <th data-col="folio" className="text-left py-2 font-medium">Folio</th>
                  <th data-col="scheme" className="text-left py-2 font-medium">AMC / Scheme</th>
                  <th data-col="amount" className="text-right py-2 font-medium">Amount</th>
                  <th data-col="frequency" className="text-left py-2 font-medium">Frequency</th>
                  <th data-col="start" className="text-left py-2 font-medium">Start</th>
                  <th data-col="end" className="text-left py-2 font-medium">End</th>
                  <th data-col="next_due" className="text-left py-2 font-medium">Next due</th>
                  <th data-col="mandate" className="text-left py-2 font-medium">Mandate</th>
                  <th data-col="status" className="text-left py-2 font-medium">Status</th>
                  <th data-col="rm" className="text-left py-2 font-medium">RM</th>
                  <th data-col="remarks" className="text-left py-2 font-medium pr-4">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(({ s: sip, investorName, mandateRef, mandateStatus, rmName }) => (
                  <tr key={sip.id} className="border-b last:border-0 hover:bg-secondary/40">
                    <td data-col="investor" className="px-4 py-3 whitespace-nowrap">
                      {investorName ? (
                        <Link href={`/dashboard/investors/${sip.investorId}`} className="hover:underline">
                          {investorName}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td data-col="folio" className="py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {sip.folioNumber ?? "—"}
                    </td>
                    <td data-col="scheme" className="py-3 max-w-[220px]">
                      <div className="text-sm truncate">{sip.schemeName ?? sip.schemeCode ?? "—"}</div>
                      <div className="text-xs text-muted-foreground truncate">{sip.amcName ?? sip.amcCode ?? "—"}</div>
                    </td>
                    <td data-col="amount" className="py-3 text-right tabular-nums">{formatINR(Number(sip.amount))}</td>
                    <td data-col="frequency" className="py-3 text-xs">
                      {FREQ_LABEL[sip.frequency] ?? sip.frequency}
                      {sip.sipDate && <span className="text-muted-foreground"> · day {sip.sipDate}</span>}
                    </td>
                    <td data-col="start" className="py-3 text-xs text-muted-foreground tabular-nums">
                      {sip.startDate ? formatDate(sip.startDate) : "—"}
                    </td>
                    <td data-col="end" className="py-3 text-xs text-muted-foreground tabular-nums">
                      {sip.endDate ? formatDate(sip.endDate) : "—"}
                    </td>
                    <td data-col="next_due" className="py-3 text-xs tabular-nums">
                      {sip.nextInstallmentAt ? formatDate(sip.nextInstallmentAt) : "—"}
                    </td>
                    <td data-col="mandate" className="py-3 text-xs">
                      {mandateRef ? (
                        <div>
                          <div className="font-mono text-muted-foreground truncate max-w-[100px]">{mandateRef}</div>
                          <span
                            className={`text-[10px] ${
                              mandateStatus === "active" ? "text-emerald-600" : "text-rose-600"
                            }`}
                          >
                            {mandateStatus ?? "—"}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td data-col="status" className="py-3">
                      <span className={`chip ${STATUS_TONE[sip.status] ?? ""}`}>
                        {STATUS_LABEL[sip.status] ?? sip.status}
                      </span>
                    </td>
                    <td data-col="rm" className="py-3 text-xs">{rmName ?? "—"}</td>
                    <td data-col="remarks" className="py-3 pr-4 text-xs text-muted-foreground max-w-[160px] truncate">
                      {sip.remarks ?? "—"}
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
  value: string;
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
