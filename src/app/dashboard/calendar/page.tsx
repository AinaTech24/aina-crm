import Link from "next/link";
import { sql } from "drizzle-orm";
import { Calendar } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { InteractiveCalendar } from "@/components/calendar/InteractiveCalendar";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

type Item = {
  date: string; // YYYY-MM-DD
  kind: "task" | "follow_up" | "review" | "sip" | "campaign" | "compliance";
  title: string;
  href: string;
  meta?: string;
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const now = new Date();
  const month = sp.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [yyyy, mm] = month.split("-").map(Number);

  const monthStart = new Date(yyyy, mm - 1, 1);
  const monthEnd = new Date(yyyy, mm, 0); // last day of month

  const monthStartIso = monthStart.toISOString().slice(0, 10);
  const monthEndIso = monthEnd.toISOString().slice(0, 10);

  const items = await withTenant(session.tenantId, async (tx) => {
    const out: Item[] = [];

    const tasks = await tx.execute(sql`
      SELECT id, title, due_at::date AS d, priority
      FROM tasks
      WHERE due_at IS NOT NULL
        AND due_at::date >= ${monthStartIso} AND due_at::date <= ${monthEndIso}
      ORDER BY due_at ASC LIMIT 500
    `);
    for (const r of tasks.rows as any[]) {
      out.push({ date: r.d, kind: "task", title: r.title, href: `/dashboard/tasks`, meta: r.priority });
    }

    const leads = await tx.execute(sql`
      SELECT id, name, next_follow_up_at::date AS d, stage
      FROM leads
      WHERE next_follow_up_at IS NOT NULL
        AND next_follow_up_at::date >= ${monthStartIso}
        AND next_follow_up_at::date <= ${monthEndIso}
        AND converted_investor_id IS NULL AND stage NOT IN ('lost')
      LIMIT 500
    `);
    for (const r of leads.rows as any[]) {
      out.push({ date: r.d, kind: "follow_up", title: `Follow up: ${r.name}`, href: `/dashboard/leads/${r.id}`, meta: r.stage });
    }

    const reviews = await tx.execute(sql`
      SELECT id, name, next_review_at::date AS d, segment_tag
      FROM investors
      WHERE next_review_at IS NOT NULL
        AND next_review_at::date >= ${monthStartIso}
        AND next_review_at::date <= ${monthEndIso}
      LIMIT 500
    `);
    for (const r of reviews.rows as any[]) {
      out.push({ date: r.d, kind: "review", title: `Review: ${r.name}`, href: `/dashboard/investors/${r.id}`, meta: r.segment_tag ?? "" });
    }

    const sips = await tx.execute(sql`
      SELECT s.id, s.scheme_name, s.amount, s.next_installment_at::date AS d, i.name AS investor_name
      FROM sips s LEFT JOIN investors i ON i.id = s.investor_id
      WHERE s.status = 'active' AND s.next_installment_at IS NOT NULL
        AND s.next_installment_at::date >= ${monthStartIso}
        AND s.next_installment_at::date <= ${monthEndIso}
      LIMIT 500
    `);
    for (const r of sips.rows as any[]) {
      out.push({ date: r.d, kind: "sip", title: `SIP · ${r.investor_name ?? "—"}`, href: `/dashboard/sips`, meta: `₹${r.amount} · ${r.scheme_name ?? ""}` });
    }

    const campaigns = await tx.execute(sql`
      SELECT id, name, scheduled_at::date AS d, channel, status
      FROM campaigns
      WHERE scheduled_at IS NOT NULL
        AND scheduled_at::date >= ${monthStartIso}
        AND scheduled_at::date <= ${monthEndIso}
      LIMIT 200
    `);
    for (const r of campaigns.rows as any[]) {
      out.push({ date: r.d, kind: "campaign", title: r.name, href: `/dashboard/campaigns/${r.id}`, meta: `${r.channel} · ${r.status}` });
    }

    const compliance = await tx.execute(sql`
      SELECT 'arn' AS kind, ${session.tenantId}::text AS id, arn AS who, arn_expiry_at AS d
      FROM tenants WHERE id = ${session.tenantId} AND arn_expiry_at IS NOT NULL
        AND arn_expiry_at >= ${monthStartIso}::date AND arn_expiry_at <= ${monthEndIso}::date
      UNION ALL
      SELECT 'nism', id::text, name, nism_expiry_at::date
      FROM users WHERE nism_expiry_at IS NOT NULL
        AND nism_expiry_at::date >= ${monthStartIso} AND nism_expiry_at::date <= ${monthEndIso}
      UNION ALL
      SELECT 'kyc', id::text, name, ckyc_expiry_at
      FROM investors WHERE ckyc_expiry_at IS NOT NULL
        AND ckyc_expiry_at >= ${monthStartIso}::date AND ckyc_expiry_at <= ${monthEndIso}::date
      LIMIT 200
    `);
    for (const r of compliance.rows as any[]) {
      out.push({
        date: typeof r.d === "string" ? r.d : new Date(r.d).toISOString().slice(0, 10),
        kind: "compliance",
        title: `${r.kind?.toUpperCase()} expiry: ${r.who}`,
        href: `/dashboard/compliance`,
      });
    }

    return out;
  });

  const prevMonth = new Date(yyyy, mm - 2, 1);
  const nextMonth = new Date(yyyy, mm, 1);
  const monthLabel = monthStart.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  // iCal subscription link generation (secure per-user signature)
  const signature = crypto
    .createHmac("sha256", process.env.NEXTAUTH_SECRET ?? "dev-secret")
    .update(session.userId)
    .digest("hex");
  const icalSubscriptionUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/api/calendar/feed?userId=${session.userId}&token=${signature}`;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Calendar className="size-6 text-brand-cyan" /> Calendar
          </h1>
          <p className="text-muted-foreground text-sm">Tasks, follow-ups, reviews, SIPs, campaigns, compliance — one view.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/calendar?month=${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`}
            className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent"
          >
            ← {prevMonth.toLocaleDateString("en-IN", { month: "short" })}
          </Link>
          <div className="text-sm font-medium min-w-[140px] text-center">{monthLabel}</div>
          <Link
            href={`/dashboard/calendar?month=${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`}
            className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent"
          >
            {nextMonth.toLocaleDateString("en-IN", { month: "short" })} →
          </Link>
        </div>
      </div>

      <InteractiveCalendar
        initialItems={items}
        yyyy={yyyy}
        mm={mm}
        monthLabel={monthLabel}
        icalSubscriptionUrl={icalSubscriptionUrl}
      />
    </div>
  );
}
