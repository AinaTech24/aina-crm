import React from "react";
import { sql } from "drizzle-orm";
import {
  AlertOctagon, ArrowUpRight,
  ClipboardList,
  Crown,
  Headset,
  Moon,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import Link from "next/link";

export async function AttentionQueuesSection({ session }: { session: SessionUser }) {
  // 180 days with no transaction. Deliberately NOT called "Dormant": the
  // Client mix card counts status IN ('dormant','inactive'), a different set
  // with a different number, and one word for both is how 2 and 3 ended up
  // on screen describing the same clients.
  const dormantCutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const res = await tx.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM investors
              WHERE status = 'active' AND deleted_at IS NULL AND next_review_at IS NOT NULL
                AND next_review_at <= now()) AS reviews_due,
          (SELECT COUNT(*)::int FROM service_requests
              WHERE status IN ('open', 'in_progress')) AS sr_pending,
          (SELECT COUNT(*)::int FROM service_requests
              WHERE status IN ('open', 'in_progress') AND type = 'complaint') AS complaints_open,
          (SELECT COUNT(*)::int FROM investors
              WHERE status = 'active' AND deleted_at IS NULL AND service_tier = 'A'
                AND (last_review_at IS NULL OR last_review_at < now() - interval '120 days')) AS hni_not_reviewed,
          (SELECT COUNT(*)::int FROM investors
              WHERE status = 'active' AND deleted_at IS NULL
                AND (last_transaction_at IS NULL OR last_transaction_at < ${dormantCutoff})) AS dormant_clients,
          (SELECT COUNT(*)::int FROM investors
              WHERE status = 'active' AND deleted_at IS NULL AND service_tier = 'A') AS tier_a,
          (SELECT COUNT(*)::int FROM transactions
              WHERE status = 'rejected'
                AND order_date >= current_date - interval '30 days') AS rejected_txns,
          (SELECT COUNT(*)::int FROM investors
              WHERE status = 'active' AND deleted_at IS NULL
                AND (
                  kyc_status IN ('expired', 're_kyc_required')
                  OR (ckyc_expiry_at IS NOT NULL
                      AND ckyc_expiry_at BETWEEN current_date AND current_date + interval '30 days')
                )) AS kyc_expiring
      `);
      return res.rows[0] as any;
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const queues = [
    // Rejected transactions lead the list because they are the only queue here
    // that is money: an instalment the RTA turned back is inflow the book was
    // counting on and will not receive until someone re-submits it.
    { label: "Rejected transactions", count: data.rejected_txns, href: "/dashboard/reports/sip-rejection", icon: AlertOctagon, hint: "Turned back in the last 30 days — re-submit" },
    { label: "Reviews due", count: data.reviews_due, href: "/dashboard/review-meetings", icon: ClipboardList, hint: "Schedule a conversation" },
    { label: "Service requests", count: data.sr_pending, href: "/dashboard/service-requests", icon: Headset, hint: "Keep clients moving forward" },
    { label: "Open complaints", count: data.complaints_open, href: "/dashboard/complaints", icon: AlertOctagon, hint: "Resolve outstanding concerns" },
    { label: "KYC attention", count: data.kyc_expiring, href: "/dashboard/investors", icon: ShieldAlert, hint: "Expired or due within 30 days" },
  ];

  return (
    <section aria-labelledby="attention-heading" className="card-surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5 pb-4">
        <div>
          <h2 id="attention-heading" className="text-[15px] font-semibold">Your next priorities</h2>
          <p className="mt-1 text-xs text-muted-foreground">Stay ahead of client follow-ups and service needs.</p>
        </div>
        <span className="text-xs text-muted-foreground">Across your practice</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 px-3 pb-3 gap-1">
        {queues.map(({ label, count, href, icon: Icon, hint }) => (
          <Link key={label} href={href} className="group flex items-start gap-3 rounded-lg px-3 py-3 hover:bg-secondary transition-colors">
            <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg ${Number(count) > 0 ? "bg-warning/10 text-warning-foreground" : "bg-secondary text-muted-foreground"}`}>
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xl font-semibold tabular-nums">{Number(count ?? 0)}</span>
                <ArrowUpRight className="size-3.5 text-muted-foreground group-hover:text-primary" />
              </div>
              <p className="mt-0.5 text-xs font-medium">{label}</p>
              <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{hint}</p>
            </div>
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-3 border-t border-border bg-secondary/30 px-5 py-3 text-xs text-muted-foreground">
        <Link href="/dashboard/reports/high_aum" className="inline-flex items-center gap-2 hover:text-primary"><TrendingUp className="size-3.5" /> High-AUM reviews <strong className="font-semibold text-foreground">{Number(data.hni_not_reviewed ?? 0)}</strong></Link>
        <Link href="/dashboard/reports/dormant" className="inline-flex items-center gap-2 hover:text-primary"><Moon className="size-3.5" /> No activity 180d <strong className="font-semibold text-foreground">{Number(data.dormant_clients ?? 0)}</strong></Link>
        <Link href="/dashboard/investors" className="inline-flex items-center gap-2 hover:text-primary"><Crown className="size-3.5" /> A-tier clients <strong className="font-semibold text-foreground">{Number(data.tier_a ?? 0)}</strong></Link>
      </div>
    </section>
  );
}
