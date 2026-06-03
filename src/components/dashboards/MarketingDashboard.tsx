import Link from "next/link";
import { sql } from "drizzle-orm";
import { Megaphone, Image as ImageIcon, Send } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { formatRelative } from "@/lib/utils";
import { CampaignRoiChart } from "./CampaignRoiChart";
import { MarketingInsightsSection } from "./MarketingInsightsSection";

/**
 * Marketing dashboard — content + campaign focused.
 * Per spec section 2:
 *   Campaigns this month · Leads generated campaign-wise
 *   Pending creatives · Content pending approval · Posted content archive
 *   Social media calendar · Event registrations · Webinar follow-ups
 */
export async function MarketingDashboard({ session }: { session: SessionUser }) {
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const data = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM campaigns WHERE created_at >= ${startOfMonth.toISOString()}) AS campaigns_mtd,
        (SELECT COUNT(*)::int FROM campaigns WHERE status IN ('sending', 'scheduled')) AS active_campaigns,
        (SELECT COUNT(*)::int FROM leads WHERE created_at >= ${startOfMonth.toISOString()}
            AND source IN ('website', 'meta_ads', 'google_ads', 'social_media', 'webinar')) AS leads_mtd,
        (SELECT COUNT(*)::int FROM leads WHERE converted_investor_id IS NOT NULL
            AND converted_at >= ${startOfMonth.toISOString()}) AS conversions_mtd,
        (SELECT COUNT(*)::int FROM templates WHERE status = 'pending_approval' AND category = 'marketing') AS pending_approval
    `);
    const s = r.rows[0] as any;

    const campaignsList = await tx.execute(sql`
      SELECT id, name, channel, status, total_recipients, sent_count, delivered_count, read_count, replied_count, scheduled_at, started_at
      FROM campaigns
      ORDER BY created_at DESC
      LIMIT 8
    `);

    // Lead sources roll-up MTD
    const leadSources = await tx.execute(sql`
      SELECT source, COUNT(*)::int AS c
      FROM leads
      WHERE created_at >= ${startOfMonth.toISOString()}
      GROUP BY source
      ORDER BY c DESC
    `);

    return {
      campaignsMtd: Number(s.campaigns_mtd),
      activeCampaigns: Number(s.active_campaigns),
      leadsMtd: Number(s.leads_mtd),
      conversionsMtd: Number(s.conversions_mtd),
      pendingApproval: Number(s.pending_approval),
      campaigns: campaignsList.rows as any[],
      leadSources: leadSources.rows as any[],
    };
  }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

  const campaignRoiData = data.campaigns.slice(0, 5).map((c) => ({
    name: c.name.length > 15 ? c.name.slice(0, 15) + "..." : c.name,
    sent: Number(c.sent_count ?? 0),
    read: Number(c.read_count ?? 0),
    replied: Number(c.replied_count ?? 0),
  }));

  const daysOfWeek = Array.from({ length: 7 }).map((_, idx) => {
    const d = new Date(Date.now() + idx * 24 * 60 * 60 * 1000);
    let scheduledItem = "";
    if (idx === 0) scheduledItem = "SIP Reminders (WA)";
    if (idx === 1) scheduledItem = "Market Insights (Mail)";
    if (idx === 3) scheduledItem = "AINA Library Post";
    return {
      name: d.toLocaleDateString("en-US", { weekday: "short" }),
      date: d.getDate(),
      item: scheduledItem,
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Marketing dashboard</h1>
        <p className="text-muted-foreground text-sm">Campaigns, content, lead flow.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <Kpi label="Campaigns MTD" value={String(data.campaignsMtd)} />
        <Kpi label="Active right now" value={String(data.activeCampaigns)} />
        <Kpi label="Leads (marketing) MTD" value={String(data.leadsMtd)} />
        <Kpi label="Conversions MTD" value={String(data.conversionsMtd)} />
        <Kpi label="Approval queue" value={String(data.pendingApproval)} tone={data.pendingApproval > 0 ? "amber" : "muted"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Campaign ROI visual */}
        <div className="lg:col-span-2 card-surface glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90">
              <Megaphone className="size-4 text-brand-cyan-deep" /> Campaign ROI Performance
            </h2>
            <Link href="/dashboard/campaigns" className="text-xs text-brand-cyan-deep hover:underline font-semibold">
              Open all →
            </Link>
          </div>
          <CampaignRoiChart data={campaignRoiData} />
        </div>

        {/* Lead sources list */}
        <div className="card-surface glass-card p-5">
          <h2 className="font-semibold text-sm tracking-tight text-foreground/90 mb-3">Lead sources MTD</h2>
          {data.leadSources.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No leads yet this month.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.leadSources.map((s: any) => (
                <li key={s.source} className="flex items-center justify-between py-1.5 border-b last:border-0 border-border/40">
                  <span className="capitalize font-medium">{s.source.replace(/_/g, " ")}</span>
                  <span className="font-semibold tabular-nums chip bg-secondary">{s.c}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Mini Content Calendar weekly grid */}
        <div className="card-surface glass-card p-5">
          <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90 mb-4">
            <ImageIcon className="size-4 text-brand-cyan-deep" /> Content Planner (Weekly Timeline)
          </h2>
          <div className="grid grid-cols-7 gap-2">
            {daysOfWeek.map((d, idx) => (
              <div key={idx} className="flex flex-col items-center p-2 rounded-lg bg-secondary/30 border border-border/40">
                <div className="text-[10px] uppercase font-bold text-muted-foreground">{d.name}</div>
                <div className="text-sm font-extrabold mt-1">{d.date}</div>
                <div className="h-10 mt-2 flex items-center justify-center w-full text-center">
                  {d.item ? (
                    <span className="chip bg-brand-cyan-light text-brand-cyan-deep text-[8px] leading-tight px-1 py-0.5 rounded text-center truncate max-w-[80px] font-semibold" title={d.item}>
                      {d.item}
                    </span>
                  ) : (
                    <span className="text-[9px] text-muted-foreground/45">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 text-right">
            <Link href="/dashboard/content-calendar" className="text-xs text-brand-cyan-deep hover:underline font-semibold">
              Open content calendar →
            </Link>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card-surface glass-card p-5">
          <h2 className="font-semibold flex items-center gap-2 text-sm tracking-tight text-foreground/90 mb-4">
            <Send className="size-4 text-brand-cyan-deep" /> Quick Actions
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <Action href="/dashboard/campaigns/new" label="Create broadcast" />
            <Action href="/dashboard/templates/new" label="Create template" />
            <Action href="/dashboard/content-calendar" label="Plan social content" />
            <Action href="/dashboard/leads" label="Review new leads" />
          </div>
        </div>
      </div>

      {/* ---------- Marketing Insights — service & consent additions ---------- */}
      <MarketingInsightsSection session={session} />
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "amber" | "muted" }) {
  const color = tone === "amber" && value !== "0" ? "text-amber-600" : "text-foreground";
  return (
    <div className="card-surface glass-card p-5 hover-lift">
      <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-bold mt-2 tracking-tight ${color}`}>{value}</div>
    </div>
  );
}

function Action({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="block border rounded-md px-3.5 py-2.5 text-xs bg-card hover:bg-secondary/70 border-border/70 font-semibold transition-all hover:translate-x-1 duration-150 shadow-sm">
      {label}
    </Link>
  );
}
