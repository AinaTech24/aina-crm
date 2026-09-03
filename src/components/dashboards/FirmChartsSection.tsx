/**
 * The analytics band of the owner cockpit: AUM breakup · client mix ·
 * compliance gaps, then SIP business · monthly flows.
 *
 * Server component. All five loaders run in ONE transaction under Promise.all,
 * so the whole band costs a single round-trip's latency rather than five.
 */

import Link from "next/link";
import { AlertTriangle, Building2, LineChart, PieChart, Repeat, Users } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import {
  loadAumBreakup,
  loadClientStats,
  loadComplianceGaps,
  loadMonthlyFlows,
  loadSipBusiness,
} from "@/lib/dashboard/firm-charts";
import { AumBreakupDonut, MonthlyFlowChart, SipBusinessChart } from "./FirmCharts";

const TONE: Record<string, string> = {
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cyan: "bg-cyan-50 text-cyan-700 border-cyan-200",
  violet: "bg-violet-50 text-violet-700 border-violet-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
};

function Panel({
  title,
  icon: Icon,
  href,
  children,
  className = "",
}: {
  title: string;
  icon: React.ElementType;
  href?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-card p-4 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Icon className="size-4 text-brand-cyan" /> {title}
        </h3>
        {href && (
          <Link href={href} className="text-[11px] text-muted-foreground hover:text-brand-cyan hover:underline">
            View →
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

export async function FirmChartsSection({ session }: { session: SessionUser }) {
  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const [aum, clients, compliance, flows, sips] = await Promise.all([
        loadAumBreakup(tx),
        loadClientStats(tx),
        loadComplianceGaps(tx),
        loadMonthlyFlows(tx, 6),
        loadSipBusiness(tx, 6),
      ]);
      return { aum, clients, compliance, flows, sips };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const worst = data.compliance.filter((r) => r.missing > 0).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="AUM breakup" icon={PieChart} href="/dashboard/portfolio-intelligence">
          <AumBreakupDonut data={data.aum} />
        </Panel>

        <Panel title="Client mix" icon={Users} href="/dashboard/investors">
          {/* A stat grid rather than the overlapping-bubble diagram: circle areas
              can't be compared accurately by eye, and overlaps imply set
              intersections these categories don't actually have. Same data,
              readable in one pass, and every tile is a filtered drill-through. */}
          <div className="grid grid-cols-2 gap-2.5">
            {data.clients.map((c) => (
              <Link
                key={c.label}
                href={c.href}
                className={`rounded-lg border p-3 transition hover:shadow-sm ${TONE[c.tone] ?? TONE.cyan}`}
              >
                <div className="text-xl font-bold tabular-nums leading-none">{c.count.toLocaleString("en-IN")}</div>
                <div className="mt-1 text-[11px] font-medium opacity-80">{c.label}</div>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title="Compliance gaps" icon={AlertTriangle} href="/dashboard/compliance">
          {data.compliance[0]?.total === 0 ? (
            <div className="h-56 grid place-items-center text-xs text-muted-foreground">No clients yet.</div>
          ) : (
            <>
              <p className="text-[11px] text-muted-foreground -mt-1 mb-2">
                Clients still missing each field — {worst} of {data.compliance.length} have a gap.
              </p>
              <div className="max-h-[19rem] overflow-y-auto pr-1">
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0 bg-card">
                    <tr>
                      <th className="text-left font-medium py-1.5">Field</th>
                      <th className="text-right font-medium py-1.5 w-20">Missing</th>
                      <th className="text-right font-medium py-1.5 w-14">of</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.compliance.map((r) => {
                      const pct = r.total > 0 ? (r.missing / r.total) * 100 : 0;
                      return (
                        <tr key={r.label} className="border-t border-border/60">
                          <td className="py-1.5">{r.label}</td>
                          <td className="py-1.5 text-right">
                            <span
                              className={`chip text-[10px] tabular-nums ${
                                r.missing === 0
                                  ? "bg-emerald-50 text-emerald-700"
                                  : pct >= 50
                                    ? "bg-rose-50 text-rose-700"
                                    : "bg-amber-50 text-amber-700"
                              }`}
                            >
                              {r.missing.toLocaleString("en-IN")}
                            </span>
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                            {r.total.toLocaleString("en-IN")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="SIP business" icon={Repeat} href="/dashboard/sips">
          <SipBusinessChart data={data.sips} />
        </Panel>
        <Panel title="Monthly flows" icon={LineChart} href="/dashboard/transactions">
          <MonthlyFlowChart data={data.flows} />
        </Panel>
      </div>
    </div>
  );
}

export function FirmChartsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-[26rem] rounded-xl bg-card border border-border/50 animate-pulse" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-80 rounded-xl bg-card border border-border/50 animate-pulse" />
        ))}
      </div>
    </div>
  );
}
