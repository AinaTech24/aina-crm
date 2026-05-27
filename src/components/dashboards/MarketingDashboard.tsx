import Link from "next/link";
import { sql } from "drizzle-orm";
import { Megaphone, Image as ImageIcon, Send } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { formatRelative } from "@/lib/utils";

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
        (SELECT COUNT(*)::int FROM leads WHERE stage = 'converted'
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

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Marketing dashboard</h1>
        <p className="text-muted-foreground text-sm">Campaigns, content, lead flow.</p>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <Kpi label="Campaigns MTD" value={String(data.campaignsMtd)} />
        <Kpi label="Active right now" value={String(data.activeCampaigns)} />
        <Kpi label="Leads (marketing) MTD" value={String(data.leadsMtd)} />
        <Kpi label="Conversions MTD" value={String(data.conversionsMtd)} />
        <Kpi label="Approval queue" value={String(data.pendingApproval)} tone={data.pendingApproval > 0 ? "amber" : "muted"} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 border rounded-lg bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <Megaphone className="size-4" /> Recent campaigns
            </h2>
            <Link href="/dashboard/campaigns" className="text-xs text-muted-foreground hover:underline">
              Open all →
            </Link>
          </div>
          {data.campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-3 text-center py-6">
              No campaigns yet.{" "}
              <Link href="/dashboard/campaigns/new" className="text-primary hover:underline">
                Create one
              </Link>
              .
            </p>
          ) : (
            <table className="w-full text-sm mt-3">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 font-medium">Name</th>
                  <th className="text-left py-2 font-medium">Channel</th>
                  <th className="text-left py-2 font-medium">Status</th>
                  <th className="text-right py-2 font-medium">Sent</th>
                  <th className="text-right py-2 font-medium">Read</th>
                  <th className="text-left py-2 font-medium pl-3">When</th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((c: any) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2">{c.name}</td>
                    <td className="py-2 text-xs uppercase text-muted-foreground">{c.channel}</td>
                    <td className="py-2 text-xs">{c.status}</td>
                    <td className="py-2 text-right tabular-nums">{c.sent_count ?? 0}</td>
                    <td className="py-2 text-right tabular-nums">{c.read_count ?? 0}</td>
                    <td className="py-2 pl-3 text-xs text-muted-foreground">
                      {c.started_at ? formatRelative(c.started_at) : c.scheduled_at ? formatRelative(c.scheduled_at) : "draft"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold">Lead sources MTD</h2>
          {data.leadSources.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-3 text-center py-6">No leads yet this month.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {data.leadSources.map((s: any) => (
                <li key={s.source} className="flex items-center justify-between py-1 border-b last:border-0">
                  <span className="capitalize">{s.source.replace(/_/g, " ")}</span>
                  <span className="font-medium tabular-nums">{s.c}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold flex items-center gap-2">
            <ImageIcon className="size-4" /> Content calendar (this week)
          </h2>
          <p className="text-sm text-muted-foreground mt-3 text-center py-6">
            Open the{" "}
            <Link href="/dashboard/content-calendar" className="text-primary hover:underline">
              content calendar
            </Link>{" "}
            to plan posts.
          </p>
        </div>

        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold flex items-center gap-2">
            <Send className="size-4" /> Quick actions
          </h2>
          <div className="mt-3 space-y-2">
            <Action href="/dashboard/campaigns/new" label="Create new broadcast" />
            <Action href="/dashboard/templates/new" label="Create new template" />
            <Action href="/dashboard/content-calendar" label="Plan social content" />
            <Action href="/dashboard/leads" label="Review new leads" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "amber" | "muted" }) {
  const color = tone === "amber" && value !== "0" ? "text-amber-600" : "text-foreground";
  return (
    <div className="border rounded-lg p-5 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}

function Action({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="block border rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors">
      {label}
    </Link>
  );
}
