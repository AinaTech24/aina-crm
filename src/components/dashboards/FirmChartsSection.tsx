/**
 * The analytics band of the owner cockpit: AUM breakup · client mix ·
 * compliance gaps, then SIP business · monthly flows.
 *
 * Server component. All five loaders run in ONE transaction under Promise.all,
 * so the whole band costs a single round-trip's latency rather than five.
 */

import Link from "next/link";
import { Building2, LineChart, PieChart, Repeat, Users } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import {
  loadAumBreakup,
  loadClientStats,
  loadMonthlyFlows,
  loadSipBusiness,
} from "@/lib/dashboard/firm-charts";
import { AumBreakupDonut, MonthlyFlowChart, SipBusinessChart } from "./FirmCharts";

/**
 * Client-mix tiles were six different pastels — emerald, cyan, violet, blue,
 * amber, rose — which made "In a family" look as significant as "Redemption
 * risk" and turned a six-tile grid into a paintbox. Colour now means ONE thing:
 * this needs attention. Everything else is a neutral fact.
 */
const NEEDS_ATTENTION: Record<string, "warning" | "destructive"> = {
  amber: "warning",
  rose: "destructive",
};

function mixTone(tone: string, count: number): string {
  // A zero is good news for both warning tiles, so it stays neutral — painting
  // "0 dormant" amber trains people to ignore the colour.
  const sev = count > 0 ? NEEDS_ATTENTION[tone] : undefined;
  if (sev === "destructive") return "border-destructive/30 bg-destructive/5 text-destructive";
  if (sev === "warning") return "border-warning/30 bg-warning/5 text-warning";
  return "border-border bg-secondary/40 text-foreground";
}

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
    <div className={`card-surface p-4 ${className}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="section-title flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" /> {title}
        </h3>
        {href && (
          <Link
            href={href}
            className="text-2xs text-muted-foreground hover:text-foreground shrink-0"
          >
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
      // loadComplianceGaps is NOT called: the panel that used it was removed
      // (see the note below) but the query stayed, so every dashboard load ran
      // an eleven-way aggregate over the client master and threw the result
      // away.
      const [aum, clients, flows, sips] = await Promise.all([
        loadAumBreakup(tx),
        loadClientStats(tx),
        loadMonthlyFlows(tx, 6),
        loadSipBusiness(tx, 6),
      ]);
      return { aum, clients, flows, sips };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );


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
                className={`rounded-lg border p-3 transition-colors hover:border-foreground/25 ${mixTone(c.tone, c.count)}`}
              >
                <div className="text-xl font-bold tabular-nums leading-none">{c.count.toLocaleString("en-IN")}</div>
                <div className="mt-1 text-2xs font-medium text-muted-foreground">{c.label}</div>
              </Link>
            ))}
          </div>
        </Panel>

        {/* The "Compliance gaps" panel that stood here listed the same eleven
            client-master gaps the "Action centre — data hygiene" tile below already
            shows (identical numbers, sourced from the same columns) — but as a
            read-only table, while that tile groups them by compliance vs
            engagement impact and lets you click a chip to inspect or bulk-remind.
            Two views of one dataset on one screen, only one of them actionable. */}
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
