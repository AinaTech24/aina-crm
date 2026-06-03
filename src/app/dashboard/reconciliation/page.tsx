import Link from "next/link";
import { sql } from "drizzle-orm";
import { Scale } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatINR } from "@/lib/utils";
import { FilterBar } from "@/components/common/FilterBar";
import { RunReconButton, ReconRowActions } from "@/components/reconciliation/ReconActions";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  unit_mismatch: "Unit mismatch",
  missing_in_crm: "Missing in CRM",
  missing_in_feed: "Missing in feed",
  value_drift: "Value drift",
};
const SEV_TONE: Record<string, string> = {
  high: "bg-rose-50 text-rose-700 border-rose-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-slate-50 text-slate-600 border-slate-200",
};

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const statusFilter = (sp.status ?? "open,investigating").split(",").filter(Boolean);
  const sevFilter = (sp.severity ?? "").split(",").filter(Boolean);
  const typeFilter = (sp.type ?? "").split(",").filter(Boolean);

  const data = await withTenant(session.tenantId, async (tx) => {
    const conds: any[] = [sql`e.tenant_id = ${session.tenantId}::uuid`];
    if (statusFilter.length)
      conds.push(sql`e.status IN (${sql.join(statusFilter.map((v) => sql`${v}`), sql`, `)})`);
    if (sevFilter.length)
      conds.push(sql`e.severity IN (${sql.join(sevFilter.map((v) => sql`${v}`), sql`, `)})`);
    if (typeFilter.length)
      conds.push(sql`e.exception_type IN (${sql.join(typeFilter.map((v) => sql`${v}`), sql`, `)})`);
    const whereSql = sql.join(conds, sql` AND `);

    const rows = await tx.execute(sql`
      SELECT e.id, e.investor_id, i.name AS investor_name, e.scheme_code, e.scheme_name,
             e.exception_type, e.severity, e.status,
             e.crm_units, e.feed_units, e.delta_units, e.delta_value, e.detected_at
      FROM reconciliation_exceptions e
      LEFT JOIN investors i ON i.id = e.investor_id
      WHERE ${whereSql}
      ORDER BY (e.severity = 'high') DESC, ABS(COALESCE(e.delta_value,0)) DESC, e.detected_at DESC
      LIMIT 500
    `);

    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('open','investigating'))::int AS open,
        COUNT(*) FILTER (WHERE status IN ('open','investigating') AND severity = 'high')::int AS high,
        COALESCE(SUM(ABS(delta_value)) FILTER (WHERE status IN ('open','investigating')), 0)::numeric AS exposure,
        COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved
      FROM reconciliation_exceptions WHERE tenant_id = ${session.tenantId}::uuid
    `);
    const lastRun = await tx.execute(sql`
      SELECT run_at, exceptions_found FROM reconciliation_runs
      WHERE tenant_id = ${session.tenantId}::uuid ORDER BY run_at DESC LIMIT 1
    `);

    return { rows: rows.rows as any[], stats: stats.rows[0] as any, lastRun: lastRun.rows[0] as any };
  });

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Scale className="size-6 text-brand-cyan" /> Reconciliation
          </h1>
          <p className="text-muted-foreground text-sm">
            Three-way holdings match — CRM ledger vs RTA/CAS feed vs live NAV. Breaks below are the
            discrepancies to investigate.
            {data.lastRun?.run_at && (
              <> Last run {new Date(data.lastRun.run_at).toLocaleString("en-IN")}.</>
            )}
          </p>
        </div>
        <RunReconButton />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Open breaks" value={data.stats?.open ?? 0} />
        <Kpi label="High severity" value={data.stats?.high ?? 0} tone="rose" />
        <Kpi label="Exposure (₹ |Δ value|)" value={formatINR(Number(data.stats?.exposure ?? 0))} />
        <Kpi label="Resolved" value={data.stats?.resolved ?? 0} tone="emerald" />
      </div>

      <FilterBar
        totalCount={data.rows.length}
        filters={[
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "open", label: "Open" },
              { value: "investigating", label: "Investigating" },
              { value: "resolved", label: "Resolved" },
              { value: "ignored", label: "Ignored" },
            ],
          },
          {
            type: "multi",
            key: "severity",
            label: "Severity",
            options: [
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
              { value: "low", label: "Low" },
            ],
          },
          {
            type: "multi",
            key: "type",
            label: "Type",
            options: [
              { value: "unit_mismatch", label: "Unit mismatch" },
              { value: "missing_in_crm", label: "Missing in CRM" },
              { value: "missing_in_feed", label: "Missing in feed" },
            ],
          },
        ]}
      />

      <div className="card-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b">
              <th className="px-3 py-2">Client</th>
              <th className="px-3 py-2">Scheme</th>
              <th className="px-3 py-2">Break</th>
              <th className="px-3 py-2 text-right">CRM units</th>
              <th className="px-3 py-2 text-right">Feed units</th>
              <th className="px-3 py-2 text-right">Δ units</th>
              <th className="px-3 py-2 text-right">Δ value</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  No reconciliation breaks for this filter. Run reconciliation, or import an RTA/CAS feed first.
                </td>
              </tr>
            )}
            {data.rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2">
                  {r.investor_id ? (
                    <Link href={`/dashboard/investors/${r.investor_id}`} className="text-brand-cyan hover:underline">
                      {r.investor_name ?? "—"}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{r.scheme_name ?? r.scheme_code ?? "—"}</div>
                  <div className="text-[11px] text-muted-foreground font-mono">{r.scheme_code}</div>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] ${SEV_TONE[r.severity] ?? SEV_TONE.low}`}>
                    {TYPE_LABEL[r.exception_type] ?? r.exception_type}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtUnits(r.crm_units)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtUnits(r.feed_units)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtUnits(r.delta_units)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatINR(Math.abs(Number(r.delta_value ?? 0)))}</td>
                <td className="px-3 py-2">
                  <ReconRowActions id={r.id} status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: "rose" | "emerald" }) {
  const color = tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : "";
  return (
    <div className="card-surface p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function fmtUnits(n: any): string {
  const v = Number(n ?? 0);
  if (!isFinite(v)) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}
