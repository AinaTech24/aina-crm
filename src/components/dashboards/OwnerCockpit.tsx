import Link from "next/link";
import { sql } from "drizzle-orm";
import { ArrowDownRight, ArrowUpRight, TrendingUp, Users, UserPlus, ShieldCheck, Megaphone, AlertOctagon, Sparkles, ClipboardList, AlertCircle } from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";
import { NetSalesChart } from "./NetSalesChart";
import { GettingStartedChecklist } from "./GettingStartedChecklist";
import { DataGapsTile } from "./DataGapsTile";

/**
 * MFD Owner Cockpit — spec § 6, Module 2.
 *
 * Renders all 20 cards/charts the spec calls out, grouped into:
 *   1. Headline (4) — Total Leads, Total Clients, Active SIP Book, Net Business MTD
 *   2. Monthly business (5) — SIP added, Lumpsum, Redemption, SIP rejected, SIP stopped
 *   3. Attention queues (5) — Reviews due, Pending SR, Open complaints, High-AUM no review, Dormant
 *   4. Team & health (4) — Team tasks, DDQ score, Data quality score, Campaigns running
 *   5. Trends — Lead conversion %, RM-wise business, 30-day net sales chart
 */
export async function OwnerCockpit({ session }: { session: SessionUser }) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfMonthISO = startOfMonth.toISOString();
  const dormantCutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      // All 8 queries below are independent of each other. Fire them in
      // parallel — the transaction's single connection multiplexes them
      // server-side, and total wall-clock drops from ~sum-of-queries
      // (was making /dashboard a 12-second affair) to ~max-of-queries.
      const [
        headline,
        business,
        sipStopped,
        queues,
        team,
        leadFunnel,
        rmWise,
        dailySales,
      ] = await Promise.all([
      // ---------- 1. Headline counts ----------
      tx.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM investors WHERE status = 'active') AS total_clients,
          (SELECT COUNT(*)::int FROM leads WHERE stage NOT IN ('converted', 'lost', 'cold', 'not_interested')) AS total_leads,
          (SELECT COALESCE(SUM(active_sip_amount::numeric), 0)::numeric FROM investors WHERE status = 'active') AS sip_book,
          (SELECT COALESCE(SUM(aum::numeric), 0)::numeric FROM investors WHERE status = 'active') AS total_aum
      `),

      // ---------- 2. Monthly business breakdown ----------
      tx.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE type = 'sip' AND status = 'successful'
              AND order_date >= ${startOfMonthISO}::date)::int AS sip_added_count,
          COALESCE(SUM(amount::numeric) FILTER (WHERE type = 'sip' AND status = 'successful'
              AND order_date >= ${startOfMonthISO}::date), 0)::numeric AS sip_added_amt,
          COUNT(*) FILTER (WHERE type = 'lumpsum' AND status = 'successful'
              AND order_date >= ${startOfMonthISO}::date)::int AS lumpsum_count,
          COALESCE(SUM(amount::numeric) FILTER (WHERE type = 'lumpsum' AND status = 'successful'
              AND order_date >= ${startOfMonthISO}::date), 0)::numeric AS lumpsum_amt,
          COALESCE(SUM(amount::numeric) FILTER (WHERE direction = 'outflow' AND status = 'successful'
              AND order_date >= ${startOfMonthISO}::date), 0)::numeric AS redemption_amt,
          COUNT(*) FILTER (WHERE type = 'sip' AND status = 'rejected'
              AND created_at >= ${startOfMonthISO})::int AS sip_rejected_count
        FROM transactions
      `),

      tx.execute(sql`
        SELECT COUNT(*)::int AS c FROM sips
        WHERE status IN ('stopped', 'paused', 'cancelled')
          AND updated_at >= ${startOfMonthISO}
      `),

      // ---------- 3. Attention queues ----------
      tx.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM investors
              WHERE status = 'active' AND next_review_at IS NOT NULL
                AND next_review_at <= now()) AS reviews_due,
          (SELECT COUNT(*)::int FROM service_requests
              WHERE status IN ('open', 'in_progress')) AS sr_pending,
          (SELECT COUNT(*)::int FROM service_requests
              WHERE status IN ('open', 'in_progress') AND type = 'complaint') AS complaints_open,
          (SELECT COUNT(*)::int FROM investors
              WHERE status = 'active' AND service_tier = 'A'
                AND (last_review_at IS NULL OR last_review_at < now() - interval '120 days')) AS hni_not_reviewed,
          (SELECT COUNT(*)::int FROM investors
              WHERE status = 'active'
                AND (last_transaction_at IS NULL OR last_transaction_at < ${dormantCutoff})) AS dormant_clients
      `),

      // ---------- 4. Team & health ----------
      tx.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM tasks WHERE status = 'open') AS team_tasks,
          (SELECT COUNT(*)::int FROM campaigns WHERE status IN ('sending', 'scheduled')) AS campaigns_running,
          (SELECT overall_score::numeric FROM ddq_scores ORDER BY computed_at DESC LIMIT 1) AS ddq_score,
          (SELECT (
              100.0 * COUNT(*) FILTER (WHERE pan IS NOT NULL AND pan <> ''
                AND email IS NOT NULL AND email <> ''
                AND phone IS NOT NULL AND phone <> ''
                AND dob IS NOT NULL
                AND nominee_name IS NOT NULL AND nominee_name <> ''
                AND bank_account_masked IS NOT NULL AND bank_account_masked <> '')
              / NULLIF(COUNT(*), 0)
            )::numeric FROM investors WHERE status = 'active') AS data_quality_score
      `),

      // ---------- 5. Lead conversion + RM-wise ----------
      tx.execute(sql`
        SELECT
          COUNT(*)::int AS total_leads_mtd,
          COUNT(*) FILTER (WHERE stage = 'converted')::int AS converted_mtd
        FROM leads
        WHERE created_at >= ${startOfMonthISO}
      `),

      tx.execute(sql`
        SELECT u.id, u.name AS rm_name,
          COUNT(DISTINCT i.id)::int AS clients,
          COALESCE(SUM(i.aum::numeric), 0)::numeric AS aum,
          COALESCE(SUM(i.active_sip_amount::numeric), 0)::numeric AS sip_book
        FROM users u
        LEFT JOIN investors i ON i.rm_id = u.id AND i.status = 'active'
        WHERE 'rm' = ANY(u.roles) AND u.status = 'active'
        GROUP BY u.id, u.name
        ORDER BY aum DESC NULLS LAST
        LIMIT 8
      `),

      // 30-day daily net-sales series for the chart
      tx.execute(sql`
        WITH dates AS (
          SELECT generate_series(current_date - interval '29 days', current_date, interval '1 day')::date AS d
        )
        SELECT d::text AS day,
          COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric END), 0)::numeric AS gross,
          COALESCE(SUM(CASE WHEN t.direction = 'outflow' THEN t.amount::numeric END), 0)::numeric AS redemption,
          COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END), 0)::numeric AS net
        FROM dates LEFT JOIN transactions t
          ON t.order_date = dates.d AND t.status = 'successful'
        GROUP BY d ORDER BY d
      `),
      ]);

      // Unpack the parallel results back into the shape the JSX expects.
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
        // business
        sipAddedCount: Number(b.sip_added_count),
        sipAddedAmt: Number(b.sip_added_amt),
        lumpsumCount: Number(b.lumpsum_count),
        lumpsumAmt: Number(b.lumpsum_amt),
        redemptionAmt: Number(b.redemption_amt),
        sipRejectedCount: Number(b.sip_rejected_count),
        sipStoppedCount: Number((sipStopped.rows[0] as any)?.c ?? 0),
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
        rmWise: rmWise.rows as any[],
        // chart
        dailySales: (dailySales.rows as any[]).map((r) => ({
          day: String(r.day),
          gross: Number(r.gross),
          redemption: Number(r.redemption),
          net: Number(r.net),
        })),
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const today = now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Hero header — gradient brand strip with welcome line */}
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
                {today} · Here's what's happening across the firm today.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="chip bg-white/10 text-white backdrop-blur-sm border border-white/20">
                <span className="pulse-dot" /> Live
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Getting-started checklist — auto-hides when all steps complete */}
      <GettingStartedChecklist tenantId={session.tenantId} />

      {/* ---------- 1. Headline KPIs — hero tiles ---------- */}
      <div className="grid grid-cols-4 gap-3">
        <Kpi
          href="/dashboard/investors"
          icon={Users}
          label="Total Clients"
          value={String(data.totalClients)}
          sub={formatINR(data.totalAum) + " AUM"}
          accent="cyan"
        />
        <Kpi
          href="/dashboard/leads"
          icon={UserPlus}
          label="Open Leads"
          value={String(data.totalLeads)}
          sub={`${data.conversionPct.toFixed(1)}% conversion MTD`}
          accent="violet"
        />
        <Kpi
          href="/dashboard/sips"
          icon={TrendingUp}
          label="Active SIP Book"
          value={formatINR(data.sipBook)}
          sub="per month"
          accent="emerald"
        />
        <Kpi
          href="/dashboard/reports/net_sales"
          icon={TrendingUp}
          label="Net Business MTD"
          value={formatINR(data.netBusiness)}
          sub={`Gross ${formatINR(data.sipAddedAmt + data.lumpsumAmt)}`}
          trend={data.netBusiness >= 0 ? "up" : "down"}
          hero
        />
      </div>

      {/* ---------- 2. Monthly business breakdown ---------- */}
      <Group title="Monthly business" link={{ href: "/dashboard/reports/net_sales", label: "Open report" }}>
        <div className="grid grid-cols-5 gap-3">
          <Stat href="/dashboard/sips" label="SIP Added MTD" value={String(data.sipAddedCount)} sub={formatINR(data.sipAddedAmt)} />
          <Stat href="/dashboard/transactions" label="Lumpsum MTD" value={String(data.lumpsumCount)} sub={formatINR(data.lumpsumAmt)} />
          <Stat href="/dashboard/transactions?type=redemption" label="Redemption MTD" value={formatINR(data.redemptionAmt)} tone={data.redemptionAmt > 0 ? "rose" : "muted"} />
          <Stat href="/dashboard/sip-rejections" label="SIP Rejected MTD" value={String(data.sipRejectedCount)} tone={data.sipRejectedCount > 0 ? "rose" : "muted"} />
          <Stat href="/dashboard/sips?status=stopped" label="SIP Stopped MTD" value={String(data.sipStoppedCount)} tone={data.sipStoppedCount > 0 ? "amber" : "muted"} />
        </div>
      </Group>

      {/* ---------- 2b. Data gaps — fixes from MFD ops checklist ---------- */}
      <DataGapsTile />

      {/* ---------- 3. Attention queues ---------- */}
      <Group title="Needs attention">
        <div className="grid grid-cols-5 gap-3">
          <Stat href="/dashboard/review-meetings" label="Review Meetings Due" value={String(data.reviewsDue)} tone={data.reviewsDue > 0 ? "amber" : "muted"} icon={ClipboardList} />
          <Stat href="/dashboard/service-requests" label="Pending Service Requests" value={String(data.srPending)} tone={data.srPending > 0 ? "amber" : "muted"} />
          <Stat href="/dashboard/complaints" label="Open Complaints" value={String(data.complaintsOpen)} tone={data.complaintsOpen > 0 ? "rose" : "muted"} icon={AlertOctagon} />
          <Stat href="/dashboard/reports/high_aum" label="High-AUM Not Reviewed" value={String(data.hniNotReviewed)} tone={data.hniNotReviewed > 0 ? "rose" : "muted"} />
          <Stat href="/dashboard/reports/dormant" label="Dormant Clients" value={String(data.dormantClients)} tone={data.dormantClients > 0 ? "amber" : "muted"} />
        </div>
      </Group>

      {/* ---------- 4. Team & health ---------- */}
      <Group title="Team & health">
        <div className="grid grid-cols-4 gap-3">
          <Stat href="/dashboard/tasks" label="Team Pending Tasks" value={String(data.teamTasks)} tone={data.teamTasks > 20 ? "amber" : "muted"} />
          <Stat
            href="/dashboard/compliance"
            label="DDQ Readiness Score"
            value={data.ddqScore != null ? `${data.ddqScore.toFixed(0)}%` : "—"}
            tone={data.ddqScore != null && data.ddqScore < 70 ? "rose" : data.ddqScore != null && data.ddqScore < 85 ? "amber" : "emerald"}
            icon={ShieldCheck}
          />
          <Stat
            href="/dashboard/investors"
            label="Data Quality Score"
            value={data.dataQualityScore != null ? `${data.dataQualityScore.toFixed(0)}%` : "—"}
            sub="Investors with complete profile"
            tone={data.dataQualityScore != null && data.dataQualityScore < 70 ? "rose" : data.dataQualityScore != null && data.dataQualityScore < 85 ? "amber" : "emerald"}
          />
          <Stat href="/dashboard/campaigns" label="Marketing Campaigns Running" value={String(data.campaignsRunning)} icon={Megaphone} />
        </div>
      </Group>

      {/* ---------- 5. Conversion + RM-wise + chart ---------- */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2">
              <div className="size-7 rounded-lg bg-emerald-50 grid place-items-center">
                <Sparkles className="size-3.5 text-emerald-600" />
              </div>
              Lead Conversion (MTD)
            </h2>
            <Link href="/dashboard/leads" className="text-xs text-brand-cyan-deep hover:underline font-medium">
              Pipeline →
            </Link>
          </div>
          <div className="text-4xl font-bold tabular-nums text-gradient">
            {data.conversionPct.toFixed(1)}%
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            {data.convertedMtd} converted out of {data.leadsMtd} leads created this month.
          </p>
          <div className="mt-4 h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, data.conversionPct)}%`,
                backgroundImage:
                  "linear-gradient(90deg, hsl(165 70% 45%) 0%, hsl(165 75% 38%) 100%)",
              }}
            />
          </div>
        </div>

        <div className="col-span-2 card-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2">
              <div className="size-7 rounded-lg bg-brand-cyan-light grid place-items-center">
                <Users className="size-3.5 text-brand-cyan-deep" />
              </div>
              RM-wise Business
            </h2>
            <Link
              href="/dashboard/reports/rm_business"
              className="text-xs text-brand-cyan-deep hover:underline font-medium"
            >
              Full report →
            </Link>
          </div>
          {data.rmWise.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No RMs configured yet.
            </p>
          ) : (
            <table className="w-full text-sm table-modern">
              <thead>
                <tr>
                  <th className="text-left py-2 px-2">RM</th>
                  <th className="text-right py-2 px-2">Clients</th>
                  <th className="text-right py-2 px-2">AUM</th>
                  <th className="text-right py-2 px-2">SIP book</th>
                </tr>
              </thead>
              <tbody>
                {data.rmWise.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-2.5 px-2 font-medium">{r.rm_name}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{r.clients}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">
                      {formatINR(Number(r.aum))}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums">
                      {formatINR(Number(r.sip_book))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ---------- Net-sales chart ---------- */}
      <div className="card-surface p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2">
            <div className="size-7 rounded-lg bg-brand-cyan-light grid place-items-center">
              <TrendingUp className="size-3.5 text-brand-cyan-deep" />
            </div>
            Net sales — last 30 days
          </h2>
          <span className="text-xs text-muted-foreground">Daily inflow vs redemption</span>
        </div>
        <NetSalesChart data={data.dailySales} />
      </div>
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
}: {
  href?: string;
  icon?: any;
  label: string;
  value: string;
  sub?: string;
  trend?: "up" | "down";
  accent?: "cyan" | "violet" | "emerald" | "amber";
  hero?: boolean;
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
    <div className="kpi-card">
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
      <div className="text-2xl font-bold mt-2 tabular-nums tracking-tight">{value}</div>
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
    <div className="kpi-card">
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
