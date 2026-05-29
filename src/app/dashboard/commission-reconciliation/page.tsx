import Link from "next/link";
import { sql } from "drizzle-orm";
import { Coins, AlertTriangle, TrendingDown, TrendingUp, HeartHandshake } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatINR } from "@/lib/utils";
import { ReconcileButton } from "@/components/commission/ReconcileButton";
import { computeSubDistributorPayouts } from "@/lib/commission/sub_distributor_payouts";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-50 text-gray-700",
  matched: "bg-emerald-50 text-emerald-700",
  anomaly: "bg-rose-50 text-rose-700",
  investigating: "bg-amber-50 text-amber-700",
  resolved: "bg-emerald-50 text-emerald-700",
  written_off: "bg-slate-50 text-slate-700",
};

export const dynamic = "force-dynamic";

export default async function CommissionReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const now = new Date();
  const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const period = sp.period ?? defaultPeriod;

  const data = await withTenant(session.tenantId, async (tx) => {
    const rows = await tx.execute(sql`
      SELECT * FROM commission_records
      WHERE period = ${period}
      ORDER BY ABS(variance::numeric) DESC LIMIT 200
    `);

    const stats = await tx.execute(sql`
      SELECT
        COALESCE(SUM(expected_amount::numeric), 0) AS total_expected,
        COALESCE(SUM(received_amount::numeric), 0) AS total_received,
        COALESCE(SUM(variance::numeric), 0) AS total_variance,
        COUNT(*) FILTER (WHERE status = 'anomaly')::int AS anomalies,
        COUNT(*)::int AS total_lines
      FROM commission_records WHERE period = ${period}
    `);

    const ytd = await tx.execute(sql`
      SELECT
        COALESCE(SUM(expected_amount::numeric), 0) AS expected_ytd,
        COALESCE(SUM(received_amount::numeric), 0) AS received_ytd,
        COALESCE(SUM(variance::numeric), 0) AS variance_ytd
      FROM commission_records
      WHERE period >= ${`${now.getFullYear()}-04`}
    `);

    const availablePeriods = await tx.execute(sql`
      SELECT DISTINCT period FROM commission_records ORDER BY period DESC LIMIT 24
    `);

    // Sub-distributor payouts due for the same period.
    const subDistPayouts = await computeSubDistributorPayouts(
      tx,
      session.tenantId,
      period
    );

    return {
      rows: rows.rows as any[],
      stats: stats.rows[0] as any,
      ytd: ytd.rows[0] as any,
      availablePeriods: (availablePeriods.rows as any[]).map((r) => r.period),
      subDistPayouts,
    };
  });

  const totalExpected = Number(data.stats.total_expected ?? 0);
  const totalReceived = Number(data.stats.total_received ?? 0);
  const totalVariance = Number(data.stats.total_variance ?? 0);

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Coins className="size-6" /> Brokerage reconciliation
          </h1>
          <p className="text-muted-foreground text-sm max-w-2xl">
            Compare what AMCs paid vs what your folios should have earned, scheme by scheme. Trail leakage from
            wrong-ARN-mapping and missed installments routinely costs 1–2% of regular AUM — easy money to recover.
          </p>
        </div>
        <ReconcileButton period={period} />
      </div>

      <form className="flex items-center gap-2 text-sm">
        <label className="text-muted-foreground">Period:</label>
        <select
          name="period"
          defaultValue={period}
          className="border rounded-md px-2 py-1 bg-background"
        >
          {[period, ...data.availablePeriods.filter((p) => p !== period)].map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <button className="rounded-md border px-3 py-1">Load</button>
      </form>

      <div className="grid grid-cols-4 gap-3">
        <Kpi label="Expected" value={formatINR(totalExpected)} icon={TrendingUp} />
        <Kpi label="Received" value={formatINR(totalReceived)} />
        <Kpi
          label="Variance"
          value={formatINR(totalVariance)}
          tone={totalVariance < -0.02 * totalExpected ? "rose" : totalVariance > 0 ? "emerald" : "muted"}
          icon={totalVariance < 0 ? TrendingDown : TrendingUp}
        />
        <Kpi label="Anomalies" value={String(data.stats.anomalies)} tone={data.stats.anomalies > 0 ? "rose" : "muted"} icon={AlertTriangle} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Kpi label="YTD expected" value={formatINR(Number(data.ytd.expected_ytd))} />
        <Kpi label="YTD received" value={formatINR(Number(data.ytd.received_ytd))} />
        <Kpi
          label="YTD leakage"
          value={formatINR(Number(data.ytd.variance_ytd))}
          tone={Number(data.ytd.variance_ytd) < 0 ? "rose" : "emerald"}
        />
      </div>

      <div className="border rounded-lg bg-card">
        <div className="border-b px-4 py-2.5 font-medium">
          Scheme-wise lines · {period}
        </div>
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No reconciliation data for this period yet. Click <strong>Recompute reconciliation</strong> above to
            generate it from existing folio + payout data.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">AMC</th>
                <th className="text-left py-2 font-medium">Scheme</th>
                <th className="text-right py-2 font-medium">Expected</th>
                <th className="text-right py-2 font-medium">Received</th>
                <th className="text-right py-2 font-medium">Variance</th>
                <th className="text-right py-2 font-medium">Variance %</th>
                <th className="text-left py-2 font-medium pl-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const v = Number(r.variance);
                const vPct = Number(r.variance_pct) * 100;
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-3 font-mono text-xs">{r.amc_code}</td>
                    <td className="py-3">
                      <div className="text-sm">{r.scheme_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground font-mono">{r.scheme_code || "(no scheme code)"}</div>
                    </td>
                    <td className="py-3 text-right tabular-nums">{formatINR(Number(r.expected_amount))}</td>
                    <td className="py-3 text-right tabular-nums">{formatINR(Number(r.received_amount))}</td>
                    <td className={`py-3 text-right tabular-nums ${v < 0 ? "text-rose-600" : v > 0 ? "text-emerald-600" : ""}`}>
                      {v >= 0 ? "+" : ""}{formatINR(v)}
                    </td>
                    <td className="py-3 text-right tabular-nums text-xs">
                      {Math.abs(vPct) > 0.01 ? `${vPct >= 0 ? "+" : ""}${vPct.toFixed(1)}%` : "—"}
                    </td>
                    <td className="py-3 pl-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status] ?? ""}`}>
                        {r.status.replace(/_/g, " ")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Sub-distributor payouts due (period) */}
      {data.subDistPayouts.length > 0 && (
        <div className="card-surface p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-base flex items-center gap-2">
                <HeartHandshake className="size-4 text-violet-600" />
                Sub-distributor payouts due — {period}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Computed from this period's blended trail rate × each
                partner's attributed AUM × their commission split %.
                Estimate — confirm with the AMC payout before disbursing.
              </p>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Total payable
              </div>
              <div className="text-lg font-semibold text-violet-700">
                {formatINR(
                  data.subDistPayouts.reduce(
                    (s, r) => s + r.estimatedPartnerShare,
                    0
                  )
                )}
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[860px]">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Partner</th>
                  <th className="px-3 py-2 text-left">ARN</th>
                  <th className="px-3 py-2 text-right">Clients</th>
                  <th className="px-3 py-2 text-right">Attributed AUM</th>
                  <th className="px-3 py-2 text-right">Split %</th>
                  <th className="px-3 py-2 text-right">Est. monthly trail</th>
                  <th className="px-3 py-2 text-right">Partner share</th>
                </tr>
              </thead>
              <tbody>
                {data.subDistPayouts.map((p) => (
                  <tr key={p.subDistributorId} className="border-t">
                    <td className="px-3 py-2">
                      <Link
                        href={`/dashboard/sub-distributors/${p.subDistributorId}`}
                        className="font-medium hover:underline"
                      >
                        {p.name}
                      </Link>
                      {p.code && (
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {p.code}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {p.arnNumber ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {p.attributedInvestorCount}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatINR(p.attributedAum)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {p.commissionSplitPct.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {formatINR(p.estimatedMonthlyTrail)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-violet-700">
                      {formatINR(p.estimatedPartnerShare)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="border rounded-lg bg-blue-50 border-blue-200 p-4 text-sm text-blue-900">
        <strong>How it works:</strong> The reconciler pulls payouts from CAMS / KFintech distributor feeds
        (configured under Settings → Integrations) and computes expected trail per scheme using
        empanelment rates × average folio AUM. Variance &gt; 2% is flagged as an anomaly — chase the AMC, fix
        the ARN mapping, or write off. YTD leakage is the headline number that justifies this SaaS by itself.
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon?: any;
  tone?: "rose" | "emerald" | "muted";
}) {
  const color = tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : "text-foreground";
  return (
    <div className="border rounded-lg p-5 bg-card">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {Icon && <Icon className="size-3.5" />}
      </div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
