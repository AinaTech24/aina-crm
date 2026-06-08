import React, { Suspense } from "react";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { ArrowDownRight, ArrowUpRight, TrendingUp, Users, UserPlus, AlertOctagon, Sparkles, ClipboardList, AlertCircle } from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";
import { GettingStartedChecklist } from "./GettingStartedChecklist";
import { DataGapsTile } from "./DataGapsTile";
import { SipPersistencyTile } from "./SipPersistencyTile";
import { PeriodSelector } from "./PeriodSelector";
import { resolvePeriodDates, type Period } from "@/lib/dashboard/period";
import { loadTenantLicense } from "@/lib/auth/license";
import { isDashboardWidgetVisible } from "@/config/dashboard-widgets";

// Async parts streamed via Suspense
import { GrowthRetentionSection } from "./GrowthRetentionSection";
import { AttentionQueuesSection } from "./AttentionQueuesSection";
import { RmLeaderboard } from "./RmLeaderboard";
import { LeadFunnelSection } from "./LeadFunnelSection";
import { AumSegmentSection } from "./AumSegmentSection";
import { NetSalesSection } from "./NetSalesSection";
import { CardSkeleton, ChartSkeleton, LeaderboardSkeleton } from "./DashboardSkeletons";

/**
 * MFD Owner Cockpit — spec § 6, Module 2.
 *
 * The hero + period selector render INSTANTLY; the data-heavy body (5 sequential
 * KPI queries + streamed sections) is wrapped in Suspense so switching the date
 * filter feels immediate — you get the shell + a skeleton straight away instead
 * of waiting for every query to resolve before the page paints.
 *
 * Body renders all 20 cards/charts the spec calls out:
 *   1. Headline (4) — Total Leads, Total Clients, Active SIP Book, Net Business
 *   2. Monthly business (5) — SIP added, Lumpsum, Redemption, SIP rejected, stopped
 *   3. Attention queues (5) — Reviews due, Pending SR, Open complaints, High-AUM, Dormant
 *   4. Team & health (4) — Team tasks, DDQ score, Data quality score, Campaigns
 *   5. Trends — Lead conversion %, RM-wise business, 30-day net sales chart
 */
export async function OwnerCockpit({
  session,
  period = "mtd",
  customStart,
}: {
  session: SessionUser;
  period?: Period;
  customStart?: string;
}) {
  const now = new Date();
  const { label: periodLabel } = resolvePeriodDates(period, now, customStart);
  const today = now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Hero — renders immediately so the date filter is responsive even while
          the body below is still resolving its queries. */}
      <div className="card-elevated overflow-hidden">
        <div className="brand-mesh px-6 py-5 text-white">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/70 font-semibold">
                Owner cockpit
              </div>
              <h1 className="text-2xl font-bold tracking-tight mt-1">
                Welcome back, {session.name.split(" ")[0]}
              </h1>
              <p className="text-white/80 text-sm mt-1">
                {today} · Showing data for{" "}
                <span className="font-semibold">{periodLabel}</span>.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <PeriodSelector current={period} />
              <span className="chip bg-white/10 text-white backdrop-blur-sm border border-white/20 text-xs">
                <span className="pulse-dot" /> Live
              </span>
            </div>
          </div>
        </div>
      </div>

      <Suspense fallback={<CockpitBodySkeleton />}>
        <OwnerCockpitBody session={session} period={period} customStart={customStart} />
      </Suspense>
    </div>
  );
}

function CockpitBodySkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-11 rounded-xl bg-card border border-border/50 animate-pulse" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-card border border-border/50 animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-card border border-border/50 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

async function OwnerCockpitBody({
  session,
  period = "mtd",
  customStart,
}: {
  session: SessionUser;
  period?: Period;
  customStart?: string;
}) {
  const now = new Date();
  // Resolve period → start date. All "MTD" aggregates in the queries below
  // use startOfPeriodISO instead of the hard-coded startOfMonth.
  const { startISO: startOfPeriodISO, label: periodLabel } = resolvePeriodDates(period, now, customStart);
  // Keep the original variable name so existing SQL template literals stay unchanged.
  const startOfMonthISO = startOfPeriodISO;
  const dormantCutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      // Streamlined main cockpit query: only fetch core KPIs immediately
      // These queries share the single transaction connection, so Promise.all
      // can't parallelize them — pg runs one query per connection at a time (it
      // queued them and logged a deprecation warning that pg@9 turns into an
      // error). Sequential await is correct, warning-free, and connection-efficient.
      // ---------- 1. Headline counts (+ period trajectory deltas) ----------
      const headline = await tx.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active') AS total_clients,
          (SELECT COUNT(*)::int FROM leads WHERE tenant_id = ${session.tenantId}::uuid AND converted_investor_id IS NULL AND stage NOT IN ('lost', 'cold', 'not_interested')) AS total_leads,
          (SELECT COALESCE(SUM(active_sip_amount::numeric), 0)::numeric FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active') AS sip_book,
          (SELECT COALESCE(SUM(aum::numeric), 0)::numeric FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active') AS total_aum,
          -- trajectory: clients onboarded this period
          (SELECT COUNT(*)::int FROM investors
            WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND onboarded_at >= ${startOfMonthISO}) AS new_clients_period,
          -- trajectory: net new SIPs this period (registered minus stopped)
          (SELECT COUNT(*)::int FROM sips
            WHERE tenant_id = ${session.tenantId}::uuid AND created_at >= ${startOfMonthISO}) AS new_sips_period,
          (SELECT COUNT(*)::int FROM sips
            WHERE tenant_id = ${session.tenantId}::uuid AND status IN ('stopped','paused','cancelled') AND updated_at >= ${startOfMonthISO}) AS stopped_sips_period,
          (SELECT COALESCE(SUM(amount::numeric), 0)::numeric FROM sips
            WHERE tenant_id = ${session.tenantId}::uuid AND created_at >= ${startOfMonthISO})::numeric AS new_sip_amt_period
      `);

      // ---------- 2. Monthly business breakdown ----------
      const business = await tx.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE type = 'sip' AND status IN ('processed', 'successful')
              AND order_date >= ${startOfMonthISO}::date)::int AS sip_added_count,
          COALESCE(SUM(amount::numeric) FILTER (WHERE type = 'sip' AND status IN ('processed', 'successful')
              AND order_date >= ${startOfMonthISO}::date), 0)::numeric AS sip_added_amt,
          COUNT(*) FILTER (WHERE type = 'lumpsum' AND status IN ('processed', 'successful')
              AND order_date >= ${startOfMonthISO}::date)::int AS lumpsum_count,
          COALESCE(SUM(amount::numeric) FILTER (WHERE type = 'lumpsum' AND status IN ('processed', 'successful')
              AND order_date >= ${startOfMonthISO}::date), 0)::numeric AS lumpsum_amt,
          COALESCE(SUM(amount::numeric) FILTER (WHERE direction = 'outflow' AND status IN ('processed', 'successful')
              AND order_date >= ${startOfMonthISO}::date), 0)::numeric AS redemption_amt,
          COUNT(*) FILTER (WHERE type = 'sip' AND status = 'rejected'
              AND created_at >= ${startOfMonthISO})::int AS sip_rejected_count
        FROM transactions
        WHERE tenant_id = ${session.tenantId}::uuid
          -- Bound the scan to this period's rows so it uses the
          -- transactions(tenant_id, order_date)/(tenant_id, created_at) indexes
          -- instead of seq-scanning the tenant's entire transaction history.
          -- Result-preserving: every FILTER above needs order_date >= start
          -- (5 aggregates) or created_at >= start (sip_rejected), so a row
          -- failing BOTH can't contribute to any aggregate.
          AND (order_date >= ${startOfMonthISO}::date OR created_at >= ${startOfMonthISO})
      `);

      // NB: "SIP stopped this period" is already computed as stopped_sips_period
      // in the headline query above — reuse it instead of a second round-trip.

      // ---------- 3. Attention queues (fast stats for summary bar) ----------
      const queues = await tx.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM investors
              WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND next_review_at IS NOT NULL
                AND next_review_at <= now()) AS reviews_due,
          (SELECT COUNT(*)::int FROM service_requests
              WHERE tenant_id = ${session.tenantId}::uuid AND status IN ('open', 'in_progress')) AS sr_pending,
          (SELECT COUNT(*)::int FROM service_requests
              WHERE tenant_id = ${session.tenantId}::uuid AND status IN ('open', 'in_progress') AND type = 'complaint') AS complaints_open,
          (SELECT COUNT(*)::int FROM investors
              WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND service_tier = 'A'
                AND (last_review_at IS NULL OR last_review_at < now() - interval '120 days')) AS hni_not_reviewed,
          (SELECT COUNT(*)::int FROM investors
              WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
                AND (last_transaction_at IS NULL OR last_transaction_at < ${dormantCutoff})) AS dormant_clients
      `);

      // ---------- 4. Team & health ----------
      const team = await tx.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM tasks WHERE tenant_id = ${session.tenantId}::uuid AND status = 'open') AS team_tasks,
          (SELECT COUNT(*)::int FROM campaigns WHERE tenant_id = ${session.tenantId}::uuid AND status IN ('sending', 'scheduled')) AS campaigns_running,
          (SELECT overall_score::numeric FROM ddq_scores WHERE tenant_id = ${session.tenantId}::uuid ORDER BY computed_at DESC LIMIT 1) AS ddq_score,
          (SELECT (
              100.0 * COUNT(*) FILTER (WHERE pan IS NOT NULL AND pan <> ''
                AND email IS NOT NULL AND email <> ''
                AND phone IS NOT NULL AND phone <> ''
                AND dob IS NOT NULL
                AND nominee_name IS NOT NULL AND nominee_name <> ''
                AND bank_account_masked IS NOT NULL AND bank_account_masked <> '')
              / NULLIF(COUNT(*), 0)
            )::numeric FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active') AS data_quality_score
      `);

      // ---------- 5. Lead conversion (fast stats for KPI delta) ----------
      const leadFunnel = await tx.execute(sql`
        SELECT
          COUNT(*)::int AS total_leads_mtd,
          COUNT(*) FILTER (WHERE converted_investor_id IS NOT NULL)::int AS converted_mtd
        FROM leads
        WHERE tenant_id = ${session.tenantId}::uuid
          AND created_at >= ${startOfMonthISO}
      `);

      // Unpack the results into the shape the JSX expects.
      const h = headline.rows[0] as any;
      const b = business.rows[0] as any;
      const q = queues.rows[0] as any;
      const t = team.rows[0] as any;
      const lf = leadFunnel.rows[0] as any;
      const netBusiness =
        Number(b.sip_added_amt) + Number(b.lumpsum_amt) - Number(b.redemption_amt);
      const conversionPct =
        Number(lf.total_leads_mtd) > 0
          ? (Number(lf.converted_mtd) / Number(lf.total_leads_mtd)) * 100
          : 0;

      return {
        // headline
        totalClients: Number(h.total_clients),
        totalLeads: Number(h.total_leads),
        sipBook: Number(h.sip_book),
        totalAum: Number(h.total_aum),
        // trajectory deltas (this period)
        newClientsPeriod: Number(h.new_clients_period ?? 0),
        newSipsPeriod: Number(h.new_sips_period ?? 0),
        stoppedSipsPeriod: Number(h.stopped_sips_period ?? 0),
        newSipAmtPeriod: Number(h.new_sip_amt_period ?? 0),
        // business
        sipAddedCount: Number(b.sip_added_count),
        sipAddedAmt: Number(b.sip_added_amt),
        lumpsumCount: Number(b.lumpsum_count),
        lumpsumAmt: Number(b.lumpsum_amt),
        redemptionAmt: Number(b.redemption_amt),
        sipRejectedCount: Number(b.sip_rejected_count),
        sipStoppedCount: Number(h.stopped_sips_period ?? 0),
        netBusiness,
        // queues
        reviewsDue: Number(q.reviews_due),
        srPending: Number(q.sr_pending),
        complaintsOpen: Number(q.complaints_open),
        hniNotReviewed: Number(q.hni_not_reviewed),
        dormantClients: Number(q.dormant_clients),
        // team
        teamTasks: Number(t.team_tasks),
        campaignsRunning: Number(t.campaigns_running),
        ddqScore: t.ddq_score != null ? Number(t.ddq_score) : null,
        dataQualityScore: t.data_quality_score != null ? Number(t.data_quality_score) : null,
        // conversion
        conversionPct,
        leadsMtd: Number(lf.total_leads_mtd),
        convertedMtd: Number(lf.converted_mtd),
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  // Admin → MFD dashboard-widget access. `allow` is the platform admin's grant
  // (null = show everything). `show(key)` decides per widget. loadTenantLicense
  // is request-cached, so this is the same read the layout already did.
  const license = await loadTenantLicense(session.tenantId, session.roles);
  const allow = license.allowedDashboardWidgets;
  const show = (key: string) => isDashboardWidgetVisible(allow, key);

  const anyHeadline =
    show("kpi.total_clients") ||
    show("kpi.open_leads") ||
    show("kpi.active_sip_book") ||
    show("kpi.net_business");
  const anyBusiness =
    show("kpi.sip_added") ||
    show("kpi.lumpsum") ||
    show("kpi.redemption") ||
    show("kpi.sip_rejected") ||
    show("kpi.sip_stopped");
  const anyAnalytics =
    show("section.lead_funnel") ||
    show("section.aum_segment") ||
    show("section.rm_leaderboard");

  return (
    <div className="space-y-6">
      {/* Getting-started checklist — auto-hides when all steps complete */}
      {show("section.getting_started") && <GettingStartedChecklist tenantId={session.tenantId} />}

      {/* ---------- State of the firm — daily brief strip ---------- */}
      {show("section.firm_brief") && <FirmBriefStrip data={data} period={period} />}

      {/* ---------- 1. Headline KPIs — hero tiles (with period trajectory) ---------- */}
      {anyHeadline && (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {show("kpi.total_clients") && <Kpi
          href="/dashboard/investors"
          icon={Users}
          label="Total Clients"
          value={String(data.totalClients)}
          sub={formatINR(data.totalAum) + " AUM"}
          delta={data.newClientsPeriod > 0 ? `+${data.newClientsPeriod} ${period.toUpperCase()}` : undefined}
          deltaTone="up"
          accent="cyan"
        />}
        {show("kpi.open_leads") && <Kpi
          href="/dashboard/leads"
          icon={UserPlus}
          label="Open Leads"
          value={String(data.totalLeads)}
          sub={`${data.conversionPct.toFixed(1)}% conversion ${period.toUpperCase()}`}
          accent="violet"
        />}
        {show("kpi.active_sip_book") && <Kpi
          href="/dashboard/sips"
          icon={TrendingUp}
          label="Active SIP Book"
          value={formatINR(data.sipBook)}
          sub="per month"
          delta={
            data.newSipsPeriod - data.stoppedSipsPeriod !== 0
              ? `${data.newSipsPeriod - data.stoppedSipsPeriod >= 0 ? "+" : ""}${data.newSipsPeriod - data.stoppedSipsPeriod} net SIPs`
              : undefined
          }
          deltaTone={data.newSipsPeriod - data.stoppedSipsPeriod >= 0 ? "up" : "down"}
          accent="emerald"
        />}
        {show("kpi.net_business") && <Kpi
          href="/dashboard/reports/net_sales"
          icon={TrendingUp}
          label={`Net Business ${period.toUpperCase()}`}
          value={formatINR(data.netBusiness)}
          sub={`Gross ${formatINR(data.sipAddedAmt + data.lumpsumAmt)}`}
          trend={data.netBusiness >= 0 ? "up" : "down"}
          hero
        />}
      </div>
      )}

      {/* ---------- 2. Monthly business breakdown ---------- */}
      {anyBusiness && (
      <Group title={`Business — ${periodLabel}`} link={{ href: "/dashboard/reports/net_sales", label: "Open report" }}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {show("kpi.sip_added") && <Stat href="/dashboard/sips" label="SIP Added" value={String(data.sipAddedCount)} sub={formatINR(data.sipAddedAmt)} />}
          {show("kpi.lumpsum") && <Stat href="/dashboard/transactions" label="Lumpsum" value={String(data.lumpsumCount)} sub={formatINR(data.lumpsumAmt)} />}
          {show("kpi.redemption") && <Stat href="/dashboard/transactions?type=redemption" label="Redemption" value={formatINR(data.redemptionAmt)} tone={data.redemptionAmt > 0 ? "rose" : "muted"} />}
          {show("kpi.sip_rejected") && <Stat href="/dashboard/sip-rejections" label="SIP Rejected" value={String(data.sipRejectedCount)} tone={data.sipRejectedCount > 0 ? "rose" : "muted"} />}
          {show("kpi.sip_stopped") && <Stat href="/dashboard/sips?status=stopped" label="SIP Stopped" value={String(data.sipStoppedCount)} tone={data.sipStoppedCount > 0 ? "amber" : "muted"} />}
        </div>
      </Group>
      )}

      {/* ---------- Growth & retention — churn, tax-harvest, referrals, regulatory (streamed) ---------- */}
      {show("section.growth_retention") && (
      <Suspense fallback={<CardSkeleton />}>
        <GrowthRetentionSection session={session} />
      </Suspense>
      )}

      {/* ---------- 2b. Data gaps — fixes from MFD ops checklist ---------- */}
      {show("section.data_gaps") && <DataGapsTile />}

      {/* ---------- 3. Attention queues (streamed via Suspense) ---------- */}
      {show("section.attention_queues") && (
      <Suspense fallback={<CardSkeleton />}>
        <AttentionQueuesSection session={session} />
      </Suspense>
      )}

      {/* ---------- 5. Conversion + RM-wise + chart (streamed via Suspense) ---------- */}
      {anyAnalytics && (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {show("section.lead_funnel") && (
        <Suspense fallback={<ChartSkeleton />}>
          <LeadFunnelSection session={session} period={period} />
        </Suspense>
        )}

        {show("section.aum_segment") && (
        <Suspense fallback={<ChartSkeleton />}>
          <AumSegmentSection session={session} />
        </Suspense>
        )}

        {show("section.rm_leaderboard") && (
        <Suspense fallback={<LeaderboardSkeleton />}>
          <RmLeaderboard session={session} />
        </Suspense>
        )}
      </div>
      )}

      {/* ---------- Net-sales chart (streamed via Suspense) ---------- */}
      {show("section.net_sales") && (
      <Suspense fallback={<ChartSkeleton height="h-64" />}>
        <NetSalesSection session={session} />
      </Suspense>
      )}

      {/* ---------- SIP Persistency — franchise health metric ---------- */}
      {show("section.sip_persistency") && <SipPersistencyTile session={session} />}
    </div>
  );
}

/* -------------------- State of the firm — daily brief -------------------- */

function FirmBriefStrip({
  data,
  period,
}: {
  data: {
    totalClients: number;
    totalAum: number;
    sipBook: number;
    sipRejectedCount: number;
    reviewsDue: number;
    complaintsOpen: number;
    netBusiness: number;
    sipAddedCount: number;
    sipStoppedCount: number;
  };
  period: string;
}) {
  const netSipFlow = data.sipAddedCount - data.sipStoppedCount;
  const signals: Array<{ text: string; tone: "rose" | "amber" | "emerald" | "muted" }> = [];

  if (data.sipRejectedCount > 0) {
    signals.push({
      text: `${data.sipRejectedCount} SIP rejection${data.sipRejectedCount > 1 ? "s" : ""} this period`,
      tone: data.sipRejectedCount >= 5 ? "rose" : "amber",
    });
  }
  if (data.reviewsDue > 0) {
    signals.push({
      text: `${data.reviewsDue} review${data.reviewsDue > 1 ? "s" : ""} overdue`,
      tone: data.reviewsDue >= 10 ? "rose" : "amber",
    });
  }
  if (data.complaintsOpen > 0) {
    signals.push({
      text: `${data.complaintsOpen} complaint${data.complaintsOpen > 1 ? "s" : ""} open`,
      tone: "rose",
    });
  }
  if (netSipFlow > 0) {
    signals.push({ text: `net +${netSipFlow} SIPs ${period.toUpperCase()}`, tone: "emerald" });
  } else if (netSipFlow < 0) {
    signals.push({ text: `net ${netSipFlow} SIPs ${period.toUpperCase()}`, tone: "rose" });
  }

  const colorMap = {
    rose: "text-rose-700 bg-rose-50 border-rose-200",
    amber: "text-amber-700 bg-amber-50 border-amber-200",
    emerald: "text-emerald-700 bg-emerald-50 border-emerald-200",
    muted: "text-muted-foreground bg-secondary border-border/40",
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50 flex-wrap">
      <span className="text-xs text-muted-foreground font-semibold">Today:</span>
      <span className="text-xs font-semibold text-foreground">
        {data.totalClients.toLocaleString("en-IN")} clients ·{" "}
        <span className="text-emerald-700">₹</span>
        {(data.totalAum / 10_000_000).toFixed(2)} Cr AUM ·{" "}
        {(data.sipBook / 100_000).toFixed(1)}L SIP/mo
      </span>
      {signals.length > 0 && (
        <span className="text-muted-foreground text-xs">·</span>
      )}
      {signals.map((s, i) => (
        <span
          key={i}
          className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full border ${colorMap[s.tone]}`}
        >
          {s.text}
        </span>
      ))}
      {signals.length === 0 && (
        <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full border text-emerald-700 bg-emerald-50 border-emerald-200">
          ✓ No alerts today
        </span>
      )}
    </div>
  );
}

/* ------------------------- presentational helpers ------------------------- */

function Group({
  title,
  link,
  children,
}: {
  title: string;
  link?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/70">
            {title}
          </h2>
        </div>
        {link && (
          <Link
            href={link.href}
            className="text-xs text-brand-cyan-deep hover:underline font-medium"
          >
            {link.label} →
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function Kpi({
  href,
  icon: Icon,
  label,
  value,
  sub,
  trend,
  accent,
  hero,
  delta,
  deltaTone,
}: {
  href?: string;
  icon?: any;
  label: string;
  value: string;
  sub?: string;
  trend?: "up" | "down";
  accent?: "cyan" | "violet" | "emerald" | "amber";
  hero?: boolean;
  /** Small period-trajectory pill, e.g. "+23 MTD". */
  delta?: string;
  deltaTone?: "up" | "down";
}) {
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : null;

  if (hero) {
    const inner = (
      <div className="kpi-hero relative overflow-hidden">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-white/80">
            {label}
          </span>
          {Icon && (
            <div className="size-8 rounded-lg bg-white/15 grid place-items-center backdrop-blur-sm">
              <Icon className="size-4 text-white" />
            </div>
          )}
        </div>
        <div className="text-3xl font-extrabold mt-2 tabular-nums tracking-tight">{value}</div>
        {sub && (
          <div className="text-xs mt-2 flex items-center gap-1 text-white/85">
            {TrendIcon && (
              <TrendIcon
                className={`size-3.5 ${trend === "up" ? "text-emerald-300" : "text-rose-300"}`}
              />
            )}
            <span>{sub}</span>
          </div>
        )}
      </div>
    );
    return href ? <Link href={href}>{inner}</Link> : inner;
  }

  const iconBg: Record<string, string> = {
    cyan: "bg-brand-cyan-light text-brand-cyan-deep",
    violet: "bg-violet-50 text-violet-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    default: "bg-secondary text-foreground",
  };
  const bg = iconBg[accent ?? "default"];
  const trendColor =
    trend === "up"
      ? "text-emerald-600"
      : trend === "down"
      ? "text-rose-600"
      : "text-muted-foreground";

  const inner = (
    <div className="kpi-card glass-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <div className={`size-8 rounded-lg grid place-items-center ${bg}`}>
            <Icon className="size-4" />
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-2 mt-2 flex-wrap">
        <div className="text-2xl font-bold tabular-nums tracking-tight">{value}</div>
        {delta && (
          <span
            className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              deltaTone === "down"
                ? "bg-rose-50 text-rose-700"
                : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {deltaTone === "down" ? (
              <ArrowDownRight className="size-2.5" />
            ) : (
              <ArrowUpRight className="size-2.5" />
            )}
            {delta}
          </span>
        )}
      </div>
      {sub && (
        <div className={`text-xs mt-2 flex items-center gap-1 ${trendColor}`}>
          {TrendIcon && <TrendIcon className="size-3" />}
          <span>{sub}</span>
        </div>
      )}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Stat({
  href,
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  href?: string;
  icon?: any;
  label: string;
  value: string;
  sub?: string;
  tone?: "rose" | "amber" | "emerald" | "muted";
}) {
  const color =
    tone === "rose"
      ? "text-rose-600"
      : tone === "amber"
      ? "text-amber-600"
      : tone === "emerald"
      ? "text-emerald-600"
      : "text-foreground";
  const iconBg =
    tone === "rose"
      ? "bg-rose-50 text-rose-600"
      : tone === "amber"
      ? "bg-amber-50 text-amber-600"
      : tone === "emerald"
      ? "bg-emerald-50 text-emerald-600"
      : "bg-brand-cyan-light text-brand-cyan-deep";

  const inner = (
    <div className="kpi-card glass-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <div className={`size-7 rounded-lg grid place-items-center ${iconBg}`}>
            <Icon className="size-3.5" />
          </div>
        )}
      </div>
      <div className={`text-xl font-bold mt-2 tabular-nums tracking-tight ${color}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
