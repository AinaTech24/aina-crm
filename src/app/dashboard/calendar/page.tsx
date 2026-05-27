import Link from "next/link";
import { sql } from "drizzle-orm";
import { Calendar, ListChecks, Sparkles, Users, Repeat, Megaphone, ShieldCheck } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";

/**
 * Unified calendar view.
 * Merges into a single month grid:
 *   - Tasks (due_at)
 *   - Lead follow-ups (next_follow_up_at)
 *   - Investor reviews (next_review_at)
 *   - SIPs (next_installment_at)
 *   - Campaigns (scheduled_at)
 *   - Service-request SLAs (sla_resolution_at)
 */

export const dynamic = "force-dynamic";

type Item = {
  date: string; // YYYY-MM-DD
  kind: "task" | "follow_up" | "review" | "sip" | "campaign" | "compliance";
  title: string;
  href: string;
  meta?: string;
};

const KIND_META: Record<Item["kind"], { color: string; icon: any; label: string }> = {
  task: { color: "bg-amber-100 text-amber-800 border-amber-300", icon: ListChecks, label: "Task" },
  follow_up: { color: "bg-blue-100 text-blue-800 border-blue-300", icon: Sparkles, label: "Follow-up" },
  review: { color: "bg-violet-100 text-violet-800 border-violet-300", icon: Users, label: "Review" },
  sip: { color: "bg-emerald-100 text-emerald-800 border-emerald-300", icon: Repeat, label: "SIP" },
  campaign: { color: "bg-pink-100 text-pink-800 border-pink-300", icon: Megaphone, label: "Campaign" },
  compliance: { color: "bg-rose-100 text-rose-800 border-rose-300", icon: ShieldCheck, label: "Compliance" },
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
        AND stage NOT IN ('converted', 'lost')
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

  // Build the month grid (6 weeks max)
  const firstWeekday = (monthStart.getDay() + 6) % 7; // Mon-first
  const daysInMonth = monthEnd.getDate();
  const cells: Array<{ date: Date | null; items: Item[] } | null> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(yyyy, mm - 1, d);
    const iso = date.toISOString().slice(0, 10);
    cells.push({ date, items: items.filter((it) => it.date === iso) });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = new Date(yyyy, mm - 2, 1);
  const nextMonth = new Date(yyyy, mm, 1);
  const monthLabel = monthStart.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Calendar className="size-6" /> Calendar
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

      <div className="flex flex-wrap gap-2 text-xs">
        {Object.entries(KIND_META).map(([k, meta]) => {
          const count = items.filter((it) => it.kind === k).length;
          const Icon = meta.icon;
          return (
            <span key={k} className={`flex items-center gap-1 px-2 py-1 rounded-full border ${meta.color}`}>
              <Icon className="size-3" />
              {meta.label} · {count}
            </span>
          );
        })}
      </div>

      <div className="border rounded-lg bg-card overflow-hidden">
        <div className="grid grid-cols-7 border-b text-xs font-medium text-muted-foreground">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="px-3 py-2 text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell, i) => {
            const isToday = cell?.date && cell.date.toDateString() === new Date().toDateString();
            return (
              <div
                key={i}
                className={`border-r border-b min-h-[110px] p-1.5 ${!cell ? "bg-muted/30" : ""} ${isToday ? "bg-blue-50/40" : ""}`}
              >
                {cell && (
                  <>
                    <div className={`text-xs font-medium ${isToday ? "text-blue-700" : "text-muted-foreground"}`}>
                      {cell.date!.getDate()}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {cell.items.slice(0, 4).map((it, idx) => {
                        const meta = KIND_META[it.kind];
                        return (
                          <Link
                            key={idx}
                            href={it.href}
                            className={`block text-[10px] truncate rounded px-1 py-0.5 border ${meta.color}`}
                            title={`${meta.label}: ${it.title}${it.meta ? " · " + it.meta : ""}`}
                          >
                            {it.title}
                          </Link>
                        );
                      })}
                      {cell.items.length > 4 && (
                        <div className="text-[10px] text-muted-foreground px-1">
                          +{cell.items.length - 4} more
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
