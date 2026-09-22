import React, { Suspense } from "react";
import { SetupChecklist } from "./SetupChecklist";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { MetricTile } from "./MetricTile";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { TrendingUp, UserPlus } from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";
import { DataGapsTile } from "./DataGapsTile";
import { SipPersistencyTile } from "./SipPersistencyTile";
import { resolvePeriodRange, type Period } from "@/lib/dashboard/period";
import { getDashboardThresholds } from "@/lib/dashboard/thresholds";
import { Sparkline } from "./Sparkline";
import { FirmPulseStrip } from "./FirmPulseStrip";
import { FirmChartsSection, FirmChartsSkeleton } from "./FirmChartsSection";
import { FirmTrackerSections } from "./FirmTrackerSections";
import { NetSalesSection } from "./NetSalesSection";
import { TopMoversPanel } from "./TopMoversPanel";
import { OwnerInsightsSection } from "./OwnerInsightsSection";
import { ExpiryPipeline } from "./ExpiryPipeline";
import { TargetAchievement } from "./TargetAchievement";
import { LeadPipeline } from "./LeadPipeline";
import { loadLeadPipeline } from "@/lib/dashboard/lead-pipeline";
import { fyElapsedFraction, loadTargetProgress } from "@/lib/dashboard/target-progress";
import { currentFyLabel, fyStartYear } from "@/lib/finance/fiscal-year";
import { loadExpiryPipeline } from "@/lib/dashboard/expiry-pipeline";
import type { DashboardTab } from "@/lib/dashboard/tabs";
import { loadFirmTracker } from "@/lib/dashboard/firm-tracker";
import { ClientMomentsStrip } from "./ClientMomentsStrip";
import { loadFirmPulse, loadActivityTiles, type ActivityRange } from "@/lib/dashboard/firm-pulse";
import { loadTenantLicense } from "@/lib/auth/license";
import { isDashboardWidgetVisible } from "@/config/dashboard-widgets";

// Async parts streamed via Suspense
import { GrowthRetentionSection } from "./GrowthRetentionSection";
import { AttentionQueuesSection } from "./AttentionQueuesSection";
import { RmLeaderboardTable } from "./RmLeaderboardTable";
import { loadRmLeaderboard } from "@/lib/dashboard/rm-leaderboard";
import { LeadFunnelSection } from "./LeadFunnelSection";
import { AumSegmentSection } from "./AumSegmentSection";
import { CardSkeleton, ChartSkeleton, LeaderboardSkeleton } from "./DashboardSkeletons";

/** Build a "?period=…(&pstart=…)" query suffix so drill-down links open scoped
 *  to the same window the cockpit is showing. Returns "" for the default (mtd,
 *  no custom start) so plain links stay clean. */
function buildPeriodQuery(period: Period, customStart?: string, customFrom?: string, customTo?: string): string {
  const params = new URLSearchParams();
  if (period !== "mtd") params.set("period", period);
  if (period === "custom") {
    if (customFrom) params.set("pfrom", customFrom);
    if (customTo) params.set("pto", customTo);
    if (!customFrom && customStart) params.set("pstart", customStart);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Append the period query to an href, merging correctly whether the href
 *  already has its own params or not. */
function withPeriod(href: string, periodQuery: string): string {
  if (!periodQuery) return href;
  return href.includes("?") ? `${href}&${periodQuery.slice(1)}` : `${href}${periodQuery}`;
}

/**
 * MFD Owner Cockpit — spec § 6, Module 2.
 *
 * The hero + period selector render INSTANTLY; the data-heavy body (5 sequential
 * KPI queries + streamed sections) is wrapped in Suspense so switching the date
 * filter feels immediate — you get the shell + a skeleton straight away instead
 * of waiting for every query to resolve before the page paints.
 *
 * Body renders all 20 cards/charts the spec calls out:
 *   1. Headline (3) — Total Leads, Total Clients, Net Business
 *      (SIP book lives in the Firm Pulse strip above, not here)
 *   2. Monthly business (5) — SIP added, Lumpsum, Redemption, SIP rejected, stopped
 *   3. Attention queues (5) — Reviews due, Pending SR, Open complaints, High-AUM, Dormant
 *   4. Team & health (4) — Team tasks, DDQ score, Data quality score, Campaigns
 *   5. Trends — Lead conversion %, RM-wise business, 30-day net sales chart
 */
export async function OwnerCockpit({
  session,
  period = "mtd",
  customStart,
  customFrom,
  customTo,
  activityDays = 7,
  branchId = null,
  rmId = null,
  tab = "overview",
  controls,
}: {
  session: SessionUser;
  period?: Period;
  customStart?: string;
  customFrom?: string;
  customTo?: string;
  /** Window for the activity tiles (the ?act= chips). */
  activityDays?: ActivityRange;
  /** Branch filter from `?branch=`; null means the whole firm. */
  branchId?: string | null;
  /** Team-member filter from `?rm=`; null means the whole firm. Sibling of
   *  branchId: picking a member FILTERS this cockpit, it does not swap the
   *  page for a different dashboard. */
  rmId?: string | null;
  /** Tabs + filter toolbar, rendered directly under the header card so the
   *  page opens the way the reference does: title first, controls second. */
  controls?: React.ReactNode;
  /** Active tab from `?tab=`. Only this tab's sections are rendered — and
   *  therefore only its queries run. */
  tab?: DashboardTab;
}) {
  // The breadcrumb names the tab, so "Dashboard › Insights" is meaningful
  // rather than "Dashboard › Dashboard".
  const tabLabel =
    tab === "insights" ? "Insights" : tab === "tracker" ? "Tracker" : "Overview";
  const now = new Date();
  const today = now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Page header. This used to be a full-width red gradient slab carrying
          nothing but a greeting and today's date — the loudest thing on the
          landing page, in the colour the rest of the app reserves for "needs
          attention", and it pushed the numbers people actually open this page
          for below the fold. Same words, same information, as an ordinary
          page header like every other screen. */}
      <PageHeaderCard
        title={tab === "insights" ? "Business insights" : tab === "tracker" ? "Practice tracker" : "Practice overview"}
        subtitle={
          <>
            Welcome back, {session.name.split(" ")[0]}. Here’s your practice at a glance.
          </>
        }
        breadcrumb={[{ label: tabLabel }]}
        actions={<span className="text-xs text-muted-foreground">{today}</span>}
      />
      {controls}

      {/* First-run setup checklist — data-verified steps; vanishes when done. */}
      <Suspense fallback={null}>
        <SetupChecklist tenantId={session.tenantId} />
      </Suspense>

      {/* ════════════════════════════════════════════════════════════════
          OVERVIEW — five sections.

          It carried fourteen. B2B finance dashboards cap the default view at
          nine and lead with the one number that answers the reader's first
          question; for an MFD owner that is AUM, and whether it is growing.
          The nine that left are on Insights and Tracker — nothing was deleted,
          and every `show()` gate still applies wherever its section now lives.

            1  metric strip        AUM · investment · SIP book · clients
            2  needs you           ranked, actionable, worst first
            3  targets + pipeline
            4  team

          Firm pulse keeps its own Suspense boundary so the heavier body below
          never delays the numbers people open this page for.
          ════════════════════════════════════════════════════════════════ */}
      <Suspense fallback={<FirmPulseSkeleton />}>
        <FirmPulse
          tenantId={session.tenantId}
          session={session}
          days={activityDays}
          showActivity={tab === "insights"}
        />
      </Suspense>

      {tab === "overview" && (
        <Suspense fallback={<CockpitBodySkeleton />}>
          <OwnerCockpitBody session={session} period={period} customStart={customStart} customFrom={customFrom} customTo={customTo} branchId={branchId} rmId={rmId} />
        </Suspense>
      )}

      {/* ── Moved off Overview, onto Insights ─────────────────────────────
          What is coming up, and the shape of the book. Real work, but not
          what an owner opens the page to find out. */}
      {tab === "insights" && (
        <>
          <Suspense fallback={null}>
            <ClientMomentsStrip session={session} />
          </Suspense>
          <Suspense fallback={<CardSkeleton />}>
            <ExpiryPipelineSection session={session} branchId={branchId} />
          </Suspense>
          {/* Churn, compliance and concentration signals. Written, and until
              now imported by nothing. */}
          <Suspense fallback={<CardSkeleton />}>
            <OwnerInsightsSection session={session} />
          </Suspense>
          <Suspense fallback={<CockpitBodySkeleton />}>
            <OwnerCockpitBody
              session={session}
              period={period}
              customStart={customStart}
              customFrom={customFrom}
              customTo={customTo}
              branchId={branchId}
              rmId={rmId}
              mode="insights"
            />
          </Suspense>
        </>
      )}

      {/* Analytics band — AUM breakup / client mix, then SIP business and
          monthly flows. Separate boundary again: five aggregate
          queries shouldn't hold up the pulse strip above them. */}
      {tab === "insights" && (
        <Suspense fallback={<FirmChartsSkeleton />}>
          <FirmChartsSection session={session} />
        </Suspense>
      )}

      {/* Firm tracker — every figure the firm asked to be able to track, under
          the Date / Branch / Team-member filters. Its own boundary so ~25
          aggregate queries never hold up anything above it. */}
      {tab === "tracker" && (
        <Suspense fallback={<CardSkeleton />}>
          <FirmTracker session={session} period={period} customStart={customStart} customFrom={customFrom} customTo={customTo} branchId={branchId} rmId={rmId} />
        </Suspense>
      )}
    </div>
  );
}

async function FirmPulse({
  showActivity = true,
  tenantId,
  session,
  days,
}: {
  showActivity?: boolean;
  tenantId: string;
  session: SessionUser;
  days: ActivityRange;
}) {
  const { metrics, tiles } = await withTenant(
    tenantId,
    async (tx) => ({
      metrics: await loadFirmPulse(tx),
      tiles: await loadActivityTiles(tx, days),
    }),
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );
  return (
    <FirmPulseStrip metrics={metrics} tiles={tiles} range={days} showActivity={showActivity} />
  );
}

function FirmPulseSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-[9.5rem] rounded-xl bg-card border border-border/50 animate-pulse" />
        ))}
      </div>
      <div className="h-48 rounded-xl bg-card border border-border/50 animate-pulse" />
    </div>
  );
}

function CockpitBodySkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-11 rounded-xl bg-card border border-border/50 animate-pulse" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 3 }).map((_, i) => (
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
  customFrom,
  customTo,
  branchId = null,
  rmId = null,
  mode = "overview",
}: {
  session: SessionUser;
  period?: Period;
  customStart?: string;
  customFrom?: string;
  customTo?: string;
  branchId?: string | null;
  rmId?: string | null;
  /** Which tab is asking. Both are served from one set of queries. */
  mode?: "overview" | "insights";
}) {
  const now = new Date();
  // Resolve period → start/end range. All "MTD" aggregates in the queries below
  // use this start instead of the hard-coded startOfMonth, and the net-sales
  // chart honours the SAME window so it matches the KPI tiles.
  const range = resolvePeriodRange(period, now, { customStart, from: customFrom, to: customTo });
  const { fromISO: startOfPeriodISO, toISO: endOfPeriodISO, label: periodLabel, days: rangeDays } = range;
  // Keep the original variable name so existing SQL template literals stay unchanged.
  const startOfMonthISO = startOfPeriodISO;

  // Business-logic thresholds — sourced from the central config, not magic numbers.
  const thresholds = getDashboardThresholds(session.tenantId);
  const dormantCutoff = new Date(
    Date.now() - thresholds.dormancyDays * 24 * 60 * 60 * 1000
  ).toISOString();

  // Drill-down links carry the active window so the destination opens scoped.
  const periodQuery = buildPeriodQuery(period, customStart, customFrom, customTo);

  // Chart bucketing: short ranges stay daily for resolution; longer ranges
  // bucket by week so the x-axis doesn't turn into a comb of 90+ ticks.
  const netSalesGranularity: "day" | "week" = rangeDays < 14 ? "day" : "week";

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
          (SELECT COUNT(*)::int FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL) AS total_clients,
          (SELECT COUNT(*)::int FROM leads WHERE tenant_id = ${session.tenantId}::uuid AND converted_investor_id IS NULL AND stage NOT IN ('lost', 'cold', 'not_interested')) AS total_leads,
          (SELECT COALESCE(SUM(active_sip_amount::numeric), 0)::numeric FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL) AS sip_book,
          (SELECT COALESCE(SUM(aum::numeric), 0)::numeric FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL) AS total_aum,
          -- trajectory: clients onboarded this period
          (SELECT COUNT(*)::int FROM investors
            WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL AND onboarded_at >= ${startOfMonthISO}) AS new_clients_period,
          -- trajectory: net new SIPs this period (registered minus stopped)
          (SELECT COUNT(*)::int FROM sips
            WHERE tenant_id = ${session.tenantId}::uuid AND created_at >= ${startOfMonthISO}) AS new_sips_period,
          (SELECT COUNT(*)::int FROM sips
            WHERE tenant_id = ${session.tenantId}::uuid AND status IN ('stopped','paused','cancelled') AND updated_at >= ${startOfMonthISO}) AS stopped_sips_period,
          (SELECT COALESCE(SUM(amount::numeric), 0)::numeric FROM sips
            WHERE tenant_id = ${session.tenantId}::uuid AND created_at >= ${startOfMonthISO})::numeric AS new_sip_amt_period
      `);

      // ---------- 2. Monthly business breakdown ----------
      // Sourced from the BUSINESS ENTRIES ledger (what the firm books), not the
      // RTA `transactions` feed — so the cards reflect manually-entered business.
      // SIP added/lumpsum/redemption/stopped map to business_entry_lines.txn_type;
      // SIP rejected has no business-entry equivalent (a rejection isn't booked
      // business) so it stays on sip_rejections.
      const business = await tx.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE l.txn_type IN ('sip','sip_topup'))::int AS sip_added_count,
          COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.txn_type IN ('sip','sip_topup')), 0)::numeric AS sip_added_amt,
          COUNT(*) FILTER (WHERE l.txn_type IN ('lumpsum','additional_purchase'))::int AS lumpsum_count,
          COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.txn_type IN ('lumpsum','additional_purchase')), 0)::numeric AS lumpsum_amt,
          COALESCE(SUM(l.amount::numeric) FILTER (WHERE l.txn_type IN ('redemption','swp')), 0)::numeric AS redemption_amt,
          COUNT(*) FILTER (WHERE l.txn_type = 'sip_stop')::int AS sip_stopped_count,
          (SELECT COUNT(*)::int FROM sip_rejections sr
             WHERE sr.tenant_id = ${session.tenantId}::uuid
               AND sr.rejection_date >= ${startOfMonthISO}::date) AS sip_rejected_count
        FROM business_entry_lines l
        JOIN business_entries e ON e.id = l.entry_id
        WHERE e.tenant_id = ${session.tenantId}::uuid
          AND e.status <> 'cancelled'
          AND e.business_date >= ${startOfMonthISO}::date
      `);

      // ---------- 2c. Business summary — net flows by asset class + product ----------
      // Detailed MIS the owner asked for: SIP (new/stop/net), Equity & Liquid
      // (purchase/redemption/net), the combined total, PMS/AIF/SIF, and new
      // insurance premium. Mutual-fund asset-class metrics are scoped to
      // product_type mutual_fund/direct_equity so PMS/AIF/SIF (whose lines may
      // carry an equity class) are counted ONCE, in their own tiles.
      const bizFlows = await tx.execute(sql`
        WITH lines AS (
          SELECT l.amount::numeric AS amt, l.txn_type, l.asset_class, l.from_asset_class,
                 (e.product_type IN ('mutual_fund','direct_equity')) AS mf
          FROM business_entry_lines l
          JOIN business_entries e ON e.id = l.entry_id
          WHERE e.tenant_id = ${session.tenantId}::uuid
            AND e.status <> 'cancelled'
            AND e.business_date >= ${startOfPeriodISO}::date
            AND e.business_date <= ${endOfPeriodISO}::date
        )
        SELECT
          COALESCE(SUM(amt) FILTER (WHERE mf AND txn_type IN ('sip','sip_topup')), 0)::numeric AS new_sip,
          COALESCE(SUM(amt) FILTER (WHERE mf AND txn_type = 'sip_stop'), 0)::numeric AS sip_stop,
          COALESCE(SUM(amt) FILTER (WHERE mf AND asset_class = 'equity' AND txn_type IN ('lumpsum','additional_purchase','switch','stp')), 0)::numeric AS eq_pur,
          COALESCE(SUM(amt) FILTER (WHERE mf AND ((txn_type IN ('redemption','swp') AND asset_class = 'equity') OR (txn_type IN ('switch','stp') AND from_asset_class = 'equity'))), 0)::numeric AS eq_red,
          COALESCE(SUM(amt) FILTER (WHERE mf AND asset_class = 'liquid' AND txn_type IN ('lumpsum','additional_purchase','switch','stp')), 0)::numeric AS liq_pur,
          COALESCE(SUM(amt) FILTER (WHERE mf AND ((txn_type IN ('redemption','swp') AND asset_class = 'liquid') OR (txn_type IN ('switch','stp') AND from_asset_class = 'liquid'))), 0)::numeric AS liq_red,
          COALESCE(SUM(amt) FILTER (WHERE mf AND txn_type IN ('lumpsum','additional_purchase','switch','stp')), 0)::numeric AS total_pur
        FROM lines
      `);
      const bizProducts = await tx.execute(sql`
        SELECT
          COALESCE(SUM(total_amount::numeric) FILTER (WHERE product_type = 'pms'), 0)::numeric AS pms,
          COALESCE(SUM(total_amount::numeric) FILTER (WHERE product_type = 'aif'), 0)::numeric AS aif,
          COALESCE(SUM(total_amount::numeric) FILTER (WHERE product_type = 'sif'), 0)::numeric AS sif
        FROM business_entries
        WHERE tenant_id = ${session.tenantId}::uuid
          AND status <> 'cancelled'
          AND business_date >= ${startOfPeriodISO}::date
          AND business_date <= ${endOfPeriodISO}::date
      `);
      const insBiz = await tx.execute(sql`
        SELECT COALESCE(SUM(annual_premium::numeric), 0)::numeric AS premium, COUNT(*)::int AS cnt
        FROM insurance_policies
        WHERE tenant_id = ${session.tenantId}::uuid
          AND status <> 'cancelled'
          AND policy_start_date IS NOT NULL
          AND policy_start_date >= ${startOfPeriodISO}::date
          AND policy_start_date <= ${endOfPeriodISO}::date
      `);

      // NB: "SIP stopped this period" is already computed as stopped_sips_period
      // in the headline query above — reuse it instead of a second round-trip.

      // ---------- 3. Attention queues (fast stats for summary bar) ----------
      const queues = await tx.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM investors
              WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL AND next_review_at IS NOT NULL
                AND next_review_at <= now()) AS reviews_due,
          (SELECT COUNT(*)::int FROM service_requests
              WHERE tenant_id = ${session.tenantId}::uuid AND status IN ('open', 'in_progress')) AS sr_pending,
          (SELECT COUNT(*)::int FROM service_requests
              WHERE tenant_id = ${session.tenantId}::uuid AND status IN ('open', 'in_progress') AND type = 'complaint') AS complaints_open,
          (SELECT COUNT(*)::int FROM investors
              WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL AND service_tier = 'A'
                AND (last_review_at IS NULL OR last_review_at < now() - make_interval(days => ${thresholds.hniReviewDays}))) AS hni_not_reviewed,
          (SELECT COUNT(*)::int FROM investors
              WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL
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
            )::numeric FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL) AS data_quality_score
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

      // ---------- 6. Net-sales series — period-scoped, day or week buckets ----------
      // Generates a continuous bucket series across the SELECTED window (so the
      // chart matches the KPI tiles), then LEFT JOINs transactions onto it so
      // gaps render as zeros rather than missing points.
      const netSeries = await tx.execute(
        netSalesGranularity === "week"
          ? sql`
              WITH buckets AS (
                SELECT generate_series(
                  date_trunc('week', ${startOfPeriodISO}::timestamptz),
                  date_trunc('week', ${endOfPeriodISO}::timestamptz),
                  interval '1 week'
                )::date AS b
              )
              SELECT buckets.b::text AS day,
                COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric END), 0)::numeric AS gross,
                COALESCE(SUM(CASE WHEN t.direction = 'outflow' THEN t.amount::numeric END), 0)::numeric AS redemption,
                COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END), 0)::numeric AS net
              FROM buckets LEFT JOIN transactions t
                ON date_trunc('week', t.order_date)::date = buckets.b
                AND t.tenant_id = ${session.tenantId}::uuid
                AND t.status IN ('processed', 'successful')
              GROUP BY buckets.b ORDER BY buckets.b
            `
          : sql`
              WITH buckets AS (
                SELECT generate_series(
                  ${startOfPeriodISO}::date,
                  ${endOfPeriodISO}::date,
                  interval '1 day'
                )::date AS b
              )
              SELECT buckets.b::text AS day,
                COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric END), 0)::numeric AS gross,
                COALESCE(SUM(CASE WHEN t.direction = 'outflow' THEN t.amount::numeric END), 0)::numeric AS redemption,
                COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END), 0)::numeric AS net
              FROM buckets LEFT JOIN transactions t
                ON t.order_date = buckets.b
                AND t.tenant_id = ${session.tenantId}::uuid
                AND t.status IN ('processed', 'successful')
              GROUP BY buckets.b ORDER BY buckets.b
            `
      );

      // ---------- 7. Hero sparkline series — per-day net business across the period ----------
      // Cheap daily roll-up from the business-entries ledger (same source the
      // Net Business KPI uses): one row per day, net = sip + lumpsum - redemption.
      const netBizDaily = await tx.execute(sql`
        WITH days AS (
          SELECT generate_series(${startOfPeriodISO}::date, ${endOfPeriodISO}::date, interval '1 day')::date AS d
        )
        SELECT days.d::text AS day,
          COALESCE(SUM(
            CASE
              WHEN l.txn_type IN ('sip','sip_topup','lumpsum','additional_purchase') THEN l.amount::numeric
              WHEN l.txn_type IN ('redemption','swp') THEN -l.amount::numeric
              ELSE 0
            END
          ), 0)::numeric AS net
        FROM days
        LEFT JOIN business_entries e
          ON e.tenant_id = ${session.tenantId}::uuid
          AND e.status <> 'cancelled'
          AND e.business_date = days.d
        LEFT JOIN business_entry_lines l ON l.entry_id = e.id
        GROUP BY days.d ORDER BY days.d
      `);

      // ---------- 8. SIP book sparkline — cumulative active SIP amount per day ----------
      // Daily registered-SIP amount across the period (the incremental adds that
      // build the book). Kept as a per-day add series — a true running balance
      // would need historical snapshots we don't store.
      const sipAddDaily = await tx.execute(sql`
        WITH days AS (
          SELECT generate_series(${startOfPeriodISO}::date, ${endOfPeriodISO}::date, interval '1 day')::date AS d
        )
        SELECT days.d::text AS day,
          COALESCE(SUM(s.amount::numeric), 0)::numeric AS amt
        FROM days
        LEFT JOIN sips s
          ON s.tenant_id = ${session.tenantId}::uuid
          AND s.created_at::date = days.d
        GROUP BY days.d ORDER BY days.d
      `);

      // Unpack the results into the shape the JSX expects.
      const h = headline.rows[0] as any;
      const b = business.rows[0] as any;
      const q = queues.rows[0] as any;
      const t = team.rows[0] as any;
      const lf = leadFunnel.rows[0] as any;
      const bf = bizFlows.rows[0] as any;
      const bp = bizProducts.rows[0] as any;
      const ib = insBiz.rows[0] as any;
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
        sipStoppedCount: Number(b.sip_stopped_count ?? 0),
        netBusiness,
        // detailed business summary (net flows by asset class + product)
        bizSummary: {
          newSip: Number(bf.new_sip), sipStop: Number(bf.sip_stop),
          eqPur: Number(bf.eq_pur), eqRed: Number(bf.eq_red),
          liqPur: Number(bf.liq_pur), liqRed: Number(bf.liq_red),
          totalPur: Number(bf.total_pur),
          pms: Number(bp.pms), aif: Number(bp.aif), sif: Number(bp.sif),
          insPremium: Number(ib.premium), insCount: Number(ib.cnt),
        },
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
        // chart + sparkline series (period-scoped)
        netSalesSeries: (netSeries.rows as any[]).map((r) => ({
          day: String(r.day),
          gross: Number(r.gross),
          redemption: Number(r.redemption),
          net: Number(r.net),
        })),
        netBizSpark: (netBizDaily.rows as any[]).map((r) => Number(r.net)),
        sipAddSpark: (sipAddDaily.rows as any[]).map((r) => Number(r.amt)),
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

  // Only the tiles this branch actually renders may gate the row. It used to
  // include `kpi.total_clients` and `kpi.active_sip_book`: the first is now the
  // pulse strip's job, the second never had a tile here at all — so a firm
  // granted only that widget rendered an empty grid.
  const anyHeadline = show("kpi.open_leads") || show("kpi.net_business");

  // The cockpit body serves BOTH tabs from one set of queries. Splitting it
  // into two components would have duplicated five sequential aggregates for
  // the sake of a layout change.
  if (mode === "insights") {
    return (
      <div className="space-y-6">
      {anyHeadline && (
      <div className="grid gap-3 sm:grid-cols-2">
        {show("kpi.open_leads") && (
          <MetricTile
            hue="violet"
            icon={<UserPlus className="size-[18px]" />}
            label="Open leads"
            value={String(data.totalLeads)}
            href={withPeriod("/dashboard/leads", periodQuery)}
            delta={{ value: `${data.conversionPct.toFixed(1)}% conv.`, direction: "flat" }}
          />
        )}
        {show("kpi.net_business") && (
          <MetricTile
            hue="emerald"
            icon={<TrendingUp className="size-[18px]" />}
            label={`Net business ${period.toUpperCase()}`}
            value={formatINR(data.netBusiness)}
            href={withPeriod("/dashboard/reports/net_sales", periodQuery)}
            delta={{ value: `Gross ${formatINR(data.sipAddedAmt + data.lumpsumAmt)}`, direction: data.netBusiness >= 0 ? "up" : "down" }}
          />
        )}
      </div>
      )}

      {/* Referrals and circulars — how the book grows and what keeps it. */}
      {show("section.growth_retention") && (
      <Suspense fallback={<CardSkeleton />}>
        <GrowthRetentionSection session={session} />
      </Suspense>
      )}

      {/* AUM by segment is NOT repeated here. It is the narrow half of
          Overview's chart row, and Insights already answers the same question
          twice over with "AUM breakup" (by asset class) and "Client mix" —
          three cuts of the book on one screen, one of them a second copy of a
          card the reader passed on the way in. Lead funnel takes the full
          width it was always cramped out of. */}
      {show("section.lead_funnel") && (
        <Suspense fallback={<ChartSkeleton />}>
          <LeadFunnelSection session={session} period={period} />
        </Suspense>
      )}

      {/* SIP persistency — the franchise-health metric. */}
      {show("section.sip_persistency") && <SipPersistencyTile session={session} />}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {show("section.attention_queues") && (
      <Suspense fallback={<CardSkeleton />}>
        <AttentionQueuesSection session={session} />
      </Suspense>
      )}
      {/* 2 · DID THE BOOK GROW OR LEAK, AND WHO MOVED IT.

             Every headline tile above is a stock — what the book is worth now.
             Neither of these is: the chart is the month's flow, and the panel
             beside it puts names against that flow. Both components were
             already written and rendered by no page.

             NetSalesSection degrades to an empty chart when no transaction feed
             has been imported, so this is safe on a book that has not been
             reconciled yet. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 items-start">
        <div className="min-w-0 lg:col-span-2">
          <Suspense fallback={<CardSkeleton />}>
            <NetSalesSection session={session} />
          </Suspense>
        </div>
        <div className="min-w-0">
          <Suspense fallback={<CardSkeleton />}>
            <TopMoversPanel session={session} startISO={range.fromISO} periodLabel={periodLabel} />
          </Suspense>
        </div>
      </div>

      {/* 3 · CHARTS — the reference's "wide chart + narrow donut" row. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 items-start">
        <div className="min-w-0 lg:col-span-2">
          <Suspense fallback={<CardSkeleton />}>
            <LeadPipelineSection session={session} branchId={branchId} rmId={rmId} />
          </Suspense>
        </div>
        <div className="min-w-0">
          {show("section.aum_segment") && (
            <Suspense fallback={<ChartSkeleton />}>
              <AumSegmentSection session={session} />
            </Suspense>
          )}
        </div>
      </div>
      <Suspense fallback={<CardSkeleton />}>
        <TargetAchievementSection session={session} />
      </Suspense>

      {/* 4 · NEEDS YOU — ranked, actionable, worst first. */}
      {show("section.data_gaps") && <DataGapsTile />}



      {/* 5 · TEAM */}
      {/* RM leaderboard — period-scoped and eight columns wide, so it gets its
          own row rather than a third of one. */}
      {show("section.rm_leaderboard") && (
      <Suspense fallback={<LeaderboardSkeleton />}>
        <RmLeaderboardSection
          session={session}
          from={range.fromDate}
          to={range.toDate}
          periodLabel={periodLabel}
          periodQuery={periodQuery}
        />
      </Suspense>
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
          <h2 className="text-2xs font-bold uppercase tracking-[0.12em] text-foreground/70">
            {title}
          </h2>
        </div>
        {link && (
          <Link
            href={link.href}
            className="text-2xs text-muted-foreground hover:text-foreground font-medium"
          >
            {link.label} →
          </Link>
        )}
      </div>
      {children}
    </div>
  );
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
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-semibold uppercase tracking-wide leading-snug text-muted-foreground">
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
      {sub && <div className="text-2xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

/**
 * Firm tracker loader. Resolves the same period the rest of the cockpit uses so
 * the window label on the tiles matches the header's period chip exactly.
 */
async function FirmTracker({
  session,
  period,
  customStart,
  customFrom,
  customTo,
  branchId,
  rmId,
}: {
  session: SessionUser;
  period: Period;
  customStart?: string;
  customFrom?: string;
  customTo?: string;
  branchId?: string | null;
  rmId?: string | null;
}) {
  const range = resolvePeriodRange(period, new Date(), {
    customStart,
    from: customFrom,
    to: customTo,
  });
  const data = await withTenant(
    session.tenantId,
    (tx) =>
      loadFirmTracker(tx, {
        from: new Date(range.fromISO),
        to: new Date(range.toISO),
        branchId: branchId ?? null,
        rmId: rmId ?? null,
      }),
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );
  return <FirmTrackerSections data={data} periodLabel={range.label} />;
}

/** Loader for the expiry pipeline; honours the branch filter like the tracker. */
async function ExpiryPipelineSection({
  session,
  branchId,
}: {
  session: SessionUser;
  branchId?: string | null;
}) {
  const rows = await withTenant(
    session.tenantId,
    (tx) => loadExpiryPipeline(tx, branchId ?? null),
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );
  return <ExpiryPipeline rows={rows} />;
}

/** Loader for target achievement — current financial year. */
async function TargetAchievementSection({ session }: { session: SessionUser }) {
  const fy = currentFyLabel();
  const rows = await withTenant(
    session.tenantId,
    (tx) => loadTargetProgress(tx, session.tenantId, fy, fyStartYear(fy)),
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );
  return (
    <TargetAchievement rows={rows} fy={fy} elapsed={fyElapsedFraction(fyStartYear(fy))} />
  );
}

/** Loader for the lead pipeline — a snapshot, so no date range applies. */
async function LeadPipelineSection({
  session,
  branchId,
  rmId,
}: {
  session: SessionUser;
  branchId?: string | null;
  rmId?: string | null;
}) {
  const data = await withTenant(
    session.tenantId,
    (tx) => loadLeadPipeline(tx, { branchId: branchId ?? null, rmId: rmId ?? null }),
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );
  return <LeadPipeline data={data} />;
}

/** Loader for the period-scoped RM leaderboard. */
async function RmLeaderboardSection({
  session,
  from,
  to,
  periodLabel,
  periodQuery,
}: {
  session: SessionUser;
  from: Date;
  to: Date;
  periodLabel: string;
  periodQuery?: string;
}) {
  const rows = await withTenant(
    session.tenantId,
    (tx) => loadRmLeaderboard(tx, { from, to }),
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );
  return (
    <RmLeaderboardTable rows={rows} periodLabel={periodLabel} periodQuery={periodQuery} />
  );
}

