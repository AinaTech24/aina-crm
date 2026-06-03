import Link from "next/link";
import { sql } from "drizzle-orm";
import { ShieldAlert, Sprout, HeartHandshake, ScrollText } from "lucide-react";
import { db, withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";
import { scanChurn } from "@/lib/churn/scan";
import { scanTaxHarvest } from "@/lib/tax/harvesting";

/**
 * Growth & Retention — surfaces the session's flagship features on the owner's
 * home screen: who's about to leave (churn), tax-free gains to harvest, referral
 * momentum, and regulatory actions outstanding. Streamed via Suspense from the
 * cockpit so the heavier scans never block the first paint.
 */
export async function GrowthRetentionSection({ session }: { session: SessionUser }) {
  const [tenantData, regulatory] = await Promise.all([
    withTenant(
      session.tenantId,
      async (tx) => {
        const [churn, harvest, referrals] = await Promise.all([
          scanChurn(tx, { minBand: "high" }),
          scanTaxHarvest(tx, { limit: 500 }),
          tx.execute(sql`
            SELECT
              COUNT(*) FILTER (WHERE referred_by_investor_id IS NOT NULL
                AND created_at >= date_trunc('month', now()))::int AS referrals_mtd,
              COUNT(DISTINCT referred_by_investor_id)::int AS total_referrers
            FROM leads
            WHERE referred_by_investor_id IS NOT NULL
          `),
        ]);
        const churnAum = churn.reduce((s, r) => s + r.aum, 0);
        const harvestable = harvest.reduce((s, r) => s + r.harvestable, 0);
        const ref = referrals.rows[0] as { referrals_mtd: number; total_referrers: number };
        return {
          churnCount: churn.length,
          churnAum,
          harvestClients: harvest.length,
          harvestable,
          referralsMtd: Number(ref?.referrals_mtd ?? 0),
          totalReferrers: Number(ref?.total_referrers ?? 0),
        };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    ),
    // Platform-shared circulars (no tenant_id) — plain select.
    db.execute(sql`
      SELECT COUNT(*)::int AS action_required
      FROM amfi_circulars
      WHERE severity IN ('action_required', 'critical')
    `),
  ]);

  const circularsToAction = Number((regulatory.rows[0] as { action_required: number })?.action_required ?? 0);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="h-4 w-1 rounded-full brand-bar" />
        <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/70">
          Growth &amp; retention
        </h2>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile
          href="/dashboard/reports/churn-risk"
          icon={ShieldAlert}
          tone={tenantData.churnCount > 0 ? "rose" : "emerald"}
          label="Clients at churn risk"
          value={String(tenantData.churnCount)}
          sub={tenantData.churnCount > 0 ? `${formatINR(tenantData.churnAum)} AUM at risk` : "Book is sticky"}
        />
        <Tile
          href="/dashboard/reports/tax-harvesting"
          icon={Sprout}
          tone={tenantData.harvestable > 0 ? "emerald" : "muted"}
          label="Tax-free LTCG to harvest"
          value={tenantData.harvestable > 0 ? formatINR(tenantData.harvestable) : "—"}
          sub={tenantData.harvestClients > 0 ? `Across ${tenantData.harvestClients} client${tenantData.harvestClients > 1 ? "s" : ""}` : "No opportunities now"}
        />
        <Tile
          href="/dashboard/referrals"
          icon={HeartHandshake}
          tone="violet"
          label="Referrals this month"
          value={String(tenantData.referralsMtd)}
          sub={`${tenantData.totalReferrers} active referrer${tenantData.totalReferrers === 1 ? "" : "s"}`}
        />
        <Tile
          href="/dashboard/compliance/amfi-circulars"
          icon={ScrollText}
          tone={circularsToAction > 0 ? "amber" : "muted"}
          label="Circulars to action"
          value={String(circularsToAction)}
          sub={circularsToAction > 0 ? "Review in the digest" : "All caught up"}
        />
      </div>
    </div>
  );
}

function Tile({
  href, icon: Icon, label, value, sub, tone,
}: {
  href: string; icon: any; label: string; value: string; sub?: string;
  tone: "rose" | "amber" | "emerald" | "violet" | "muted";
}) {
  const color =
    tone === "rose" ? "text-rose-600"
    : tone === "amber" ? "text-amber-600"
    : tone === "emerald" ? "text-emerald-600"
    : tone === "violet" ? "text-brand-violet"
    : "text-foreground";
  const iconBg =
    tone === "rose" ? "bg-rose-50 text-rose-600"
    : tone === "amber" ? "bg-amber-50 text-amber-600"
    : tone === "emerald" ? "bg-emerald-50 text-emerald-600"
    : tone === "violet" ? "bg-violet-50 text-brand-violet"
    : "bg-brand-cyan-light text-brand-cyan-deep";

  return (
    <Link href={href}>
      <div className="kpi-card glass-card">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
          <div className={`size-7 rounded-lg grid place-items-center ${iconBg}`}>
            <Icon className="size-3.5" />
          </div>
        </div>
        <div className={`text-xl font-bold mt-2 tabular-nums tracking-tight ${color}`}>{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
      </div>
    </Link>
  );
}
