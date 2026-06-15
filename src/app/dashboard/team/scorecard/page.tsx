/**
 * Team Performance — KRA scorecard. A per-person leaderboard for the Sales and
 * Operations teams: weighted KRA score + RAG, with each KRA's KPIs (target-free
 * V1 — count KPIs ranked vs the team best, %-KPIs on their own value). Owners /
 * branch heads only.
 */

import Link from "next/link";
import { Trophy, ArrowLeft, TrendingUp, Headphones } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { withTenant } from "@/db/client";
import { loadScorecard, type MemberRow, type Kpi } from "@/lib/team/scorecard";
import { resolvePeriodDates, type Period } from "@/lib/dashboard/period";
import { PeriodSelector } from "@/components/dashboards/PeriodSelector";

export const dynamic = "force-dynamic";

const inr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;
const BAND: Record<string, string> = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-rose-500" };

function fmt(k: Kpi | undefined): string {
  if (!k) return "—";
  if (k.unit === "inr") return inr(k.actual);
  if (k.unit === "pct") return `${Math.round(k.actual)}%`;
  return String(k.actual);
}
const kpi = (r: MemberRow, key: string) => r.kpis.find((k) => k.key === key);

export default async function ScorecardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  if (!can(session.roles, "dashboard.view.owner", session.permissions)) {
    return (
      <div className="card-surface p-12 text-center max-w-lg mx-auto">
        <Trophy className="size-10 text-amber-500 mx-auto mb-3" />
        <div className="font-semibold text-lg">Managers only</div>
        <p className="text-sm text-muted-foreground mt-1">The team scorecard is for owners and branch heads.</p>
      </div>
    );
  }
  const sp = await searchParams;
  const period = (sp.period ?? "mtd") as Period;
  const pstart = sp.pstart;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const { startISO, label } = resolvePeriodDates(period, new Date(), pstart);
  const from = startISO.slice(0, 10);

  const data = await withTenant(session.tenantId, async (tx) => loadScorecard(tx as any, session.tenantId, from, today));

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/dashboard/team" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1 mb-1">
            <ArrowLeft className="size-3" /> Team
          </Link>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="size-6 text-brand-cyan" /> Team Scorecard
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">KRA performance · {label}</p>
        </div>
        <PeriodSelector current={period} variant="light" />
      </div>

      <ScoreTable
        title="Sales team"
        icon="sales"
        rows={data.sales}
        cols={[
          { key: "net_sales", label: "Net sales" },
          { key: "new_clients", label: "Clients" },
          { key: "meetings", label: "Meetings" },
          { key: "converted", label: "Converted" },
        ]}
      />
      <ScoreTable
        title="Operations team"
        icon="ops"
        rows={data.ops}
        cols={[
          { key: "sla", label: "SLA" },
          { key: "resolved", label: "Resolved" },
          { key: "overdue", label: "Overdue" },
          { key: "attendance", label: "Attendance" },
        ]}
      />

      <p className="text-[11px] text-muted-foreground">
        KRA score is a weighted blend of each KPI. Count KPIs (sales, clients, tickets) are scored against the team&apos;s
        top performer this period; %-KPIs (SLA, attendance) on their own value; overdue tasks invert (fewer is better).
        Per-person targets can be layered on next.
      </p>
    </div>
  );
}

function ScoreTable({
  title,
  icon,
  rows,
  cols,
}: {
  title: string;
  icon: "sales" | "ops";
  rows: MemberRow[];
  cols: { key: string; label: string }[];
}) {
  const Icon = icon === "sales" ? TrendingUp : Headphones;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold uppercase tracking-wide flex items-center gap-1.5">
        <Icon className="size-4 text-brand-cyan" /> {title}
        <span className="text-muted-foreground font-medium normal-case">· {rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <div className="card-surface p-6 text-sm text-muted-foreground text-center">
          No active {title.toLowerCase()} members (by role).
        </div>
      ) : (
        <div className="card-surface overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left font-medium px-3 py-2">#</th>
                <th className="text-left font-medium px-3 py-2">Member</th>
                <th className="text-left font-medium px-3 py-2">KRA score</th>
                {cols.map((c) => (
                  <th key={c.key} className="text-right font-medium px-3 py-2">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={r.userId}>
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{r.name}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-2 font-bold tabular-nums">
                      <span className={`size-2 rounded-full ${BAND[r.band]}`} /> {r.kraScore}
                    </span>
                  </td>
                  {cols.map((c) => (
                    <td key={c.key} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{fmt(kpi(r, c.key))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
