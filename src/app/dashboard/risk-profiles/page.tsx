import Link from "next/link";
import { sql } from "drizzle-orm";
import { ShieldCheck, AlertTriangle, Plus, ArrowRight } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const CATEGORY_TONE: Record<string, string> = {
  conservative: "bg-blue-50 text-blue-700",
  moderate: "bg-emerald-50 text-emerald-700",
  aggressive: "bg-amber-50 text-amber-700",
  very_aggressive: "bg-rose-50 text-rose-700",
};

export default async function RiskProfilesPage() {
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const stats = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total_clients,
        COUNT(*) FILTER (WHERE risk_profile IS NOT NULL)::int AS profiled,
        COUNT(*) FILTER (WHERE risk_profile IS NULL)::int AS not_profiled,
        COUNT(*) FILTER (WHERE risk_profile_signed_at IS NOT NULL
          AND risk_profile_signed_at < now() - interval '1 year')::int AS expired,
        COUNT(*) FILTER (WHERE risk_profile_signed_at IS NOT NULL
          AND risk_profile_signed_at >= now() - interval '1 year'
          AND risk_profile_signed_at < now() - interval '11 months')::int AS due_soon
      FROM investors WHERE status = 'active'
    `);
    const s = stats.rows[0] as any;

    // Latest profile per investor — joined with the new responses table
    const recent = await tx.execute(sql`
      SELECT DISTINCT ON (i.id)
        i.id, i.name, i.pan, i.risk_profile, i.risk_profile_signed_at, i.risk_profile_score,
        rp.id AS profile_id, rp.total_score, rp.next_review_at, rp.signed_at AS latest_signed_at
      FROM investors i
      LEFT JOIN risk_profile_responses rp ON rp.investor_id = i.id
      WHERE i.status = 'active'
      ORDER BY i.id, rp.signed_at DESC NULLS LAST
    `);

    return {
      total: Number(s.total_clients),
      profiled: Number(s.profiled),
      notProfiled: Number(s.not_profiled),
      expired: Number(s.expired),
      dueSoon: Number(s.due_soon),
      recent: recent.rows as any[],
    };
  });

  // Split for the two tables
  const needsAttention = data.recent.filter((r) => {
    if (!r.risk_profile_signed_at) return true;
    const signed = new Date(r.risk_profile_signed_at);
    return Date.now() - signed.getTime() > 11 * 30 * 24 * 60 * 60 * 1000;
  });
  const current = data.recent.filter((r) => !needsAttention.includes(r));

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="size-6 text-brand-cyan" /> Risk profiles
          </h1>
          <p className="text-muted-foreground text-sm">
            SEBI requires annual review. Tracks Conservative · Moderate · Aggressive bands per investor.
          </p>
        </div>
        <Link
          href="/dashboard/risk-profiles/new"
          className="btn-primary"
        >
          <Plus className="size-4" /> New Risk Profile
        </Link>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-5 gap-3">
        <Stat label="Active clients" value={data.total} />
        <Stat label="Profiled" value={data.profiled} tone="emerald" />
        <Stat label="Not yet profiled" value={data.notProfiled} tone={data.notProfiled > 0 ? "amber" : "muted"} />
        <Stat label="Due soon (<30d)" value={data.dueSoon} tone={data.dueSoon > 0 ? "amber" : "muted"} />
        <Stat label="Expired (>12mo)" value={data.expired} tone={data.expired > 0 ? "rose" : "muted"} />
      </div>

      {/* Needs attention */}
      <div className="card-surface">
        <div className="border-b border-border px-4 py-2.5 font-semibold flex items-center justify-between">
          <span>Profiles needing review ({needsAttention.length})</span>
          <span className="text-xs text-muted-foreground">Un-profiled + expired + due-soon</span>
        </div>
        {needsAttention.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <ShieldCheck className="size-8 mx-auto text-emerald-500" />
            <div className="mt-2 font-medium">All profiles current ✓</div>
            <div className="text-xs mt-1">Every active client has a valid risk profile.</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Investor</th>
                <th className="text-left py-2 font-medium">Last category</th>
                <th className="text-left py-2 font-medium">Score</th>
                <th className="text-left py-2 font-medium">Last signed</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {needsAttention.map((r: any) => {
                const signed = r.risk_profile_signed_at ? new Date(r.risk_profile_signed_at) : null;
                const expired = signed && Date.now() - signed.getTime() > 365 * 24 * 60 * 60 * 1000;
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-secondary/40">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/investors/${r.id}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                      <div className="text-xs text-muted-foreground font-mono">{r.pan}</div>
                    </td>
                    <td className="py-3">
                      {r.risk_profile ? (
                        <span className={`chip ${CATEGORY_TONE[r.risk_profile] ?? ""} capitalize`}>
                          {r.risk_profile.replace(/_/g, " ")}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 tabular-nums">{r.risk_profile_score ?? "—"}</td>
                    <td className="py-3 text-xs text-muted-foreground">
                      {signed ? formatDate(signed) : "Never"}
                    </td>
                    <td className="py-3">
                      {!signed ? (
                        <span className="chip bg-amber-50 text-amber-700">
                          <AlertTriangle className="size-3" /> Not profiled
                        </span>
                      ) : expired ? (
                        <span className="chip bg-rose-50 text-rose-700">Expired</span>
                      ) : (
                        <span className="chip bg-amber-50 text-amber-700">Due soon</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/risk-profiles/new?investorId=${r.id}`}
                        className="btn-accent text-xs px-3 py-1"
                      >
                        Start <ArrowRight className="size-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Current profiles */}
      {current.length > 0 && (
        <div className="card-surface">
          <div className="border-b border-border px-4 py-2.5 font-semibold">
            Current profiles ({current.length})
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Investor</th>
                <th className="text-left py-2 font-medium">Category</th>
                <th className="text-left py-2 font-medium">Score</th>
                <th className="text-left py-2 font-medium">Signed</th>
                <th className="text-left py-2 font-medium">Next review</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {current.map((r: any) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-secondary/40">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/investors/${r.id}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    <div className="text-xs text-muted-foreground font-mono">{r.pan}</div>
                  </td>
                  <td className="py-3">
                    <span className={`chip ${CATEGORY_TONE[r.risk_profile] ?? ""} capitalize`}>
                      {(r.risk_profile ?? "").replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="py-3 tabular-nums">
                    {r.total_score ?? r.risk_profile_score ?? "—"}{r.total_score ? "/40" : ""}
                  </td>
                  <td className="py-3 text-xs text-muted-foreground">
                    {r.latest_signed_at
                      ? formatDate(r.latest_signed_at)
                      : r.risk_profile_signed_at
                      ? formatDate(r.risk_profile_signed_at)
                      : "—"}
                  </td>
                  <td className="py-3 text-xs">
                    {r.next_review_at ? formatDate(r.next_review_at) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/dashboard/risk-profiles/new?investorId=${r.id}`}
                      className="text-xs text-muted-foreground hover:text-brand-cyan hover:underline"
                    >
                      Re-profile →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "rose" | "amber" | "muted";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "rose"
      ? "text-rose-600"
      : tone === "amber"
      ? "text-amber-600"
      : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
