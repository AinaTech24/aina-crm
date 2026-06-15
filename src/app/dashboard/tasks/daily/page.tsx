/**
 * Daily Job Tracker (DJT) — a per-RM daily reflection + planning ritual,
 * adopted from the MFD's Excel DJT. The "productive & completed" and
 * "non-productive & incomplete" lists auto-fill from the user's tasks; the RM
 * adds today's focus + key learning / breakdown / breakthrough. Owners can
 * review any team member's day (read-only).
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { CalendarCheck, ListChecks, CheckCircle2, AlertCircle, TrendingUp, ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { withTenant } from "@/db/client";
import { loadDailyTracker } from "@/lib/daily-tracker";
import { DailyTrackerForm } from "@/components/tasks/DailyTrackerForm";
import { DailyTrackerWho } from "@/components/tasks/DailyTrackerWho";

export const dynamic = "force-dynamic";

const PRIORITY_TONE: Record<string, string> = {
  urgent: "text-rose-600",
  high: "text-amber-600",
  normal: "text-muted-foreground",
  low: "text-muted-foreground/70",
};

export default async function DailyTrackerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const isOwner = can(session.roles, "dashboard.view.owner", session.permissions);

  const dateISO =
    typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date)
      ? sp.date
      : new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const targetUser = isOwner && sp.user ? sp.user : session.userId;
  const isSelf = targetUser === session.userId;

  const { data, name, members } = await withTenant(session.tenantId, async (tx) => {
    const data = await loadDailyTracker(tx as any, session.tenantId, targetUser, dateISO);
    const nameRow = await tx.execute(sql`SELECT name FROM users WHERE id = ${targetUser}::uuid LIMIT 1`);
    const name = ((nameRow.rows[0] as any)?.name as string) ?? "—";
    let members: { id: string; name: string }[] = [];
    if (isOwner) {
      const r = await tx.execute(
        sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' ORDER BY name ASC`
      );
      members = (r.rows as { id: string; name: string }[]).map((m) => ({ id: String(m.id), name: m.name ?? "—" }));
    }
    return { data, name, members };
  });

  const dateLabel = new Date(dateISO + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/dashboard/tasks" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1 mb-1">
            <ArrowLeft className="size-3" /> Tasks
          </Link>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarCheck className="size-6 text-brand-cyan" /> Daily Job Tracker
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {isSelf ? "Your" : `${name}'s`} day · {dateLabel}
          </p>
        </div>
        {isOwner && members.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Viewing</span>
            <DailyTrackerWho members={members} current={isSelf ? "" : targetUser} />
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <Kpi icon={TrendingUp} label="Productivity" value={`${data.productivityPct}%`} tone="emerald" sub="completed vs carried" />
        <Kpi icon={CheckCircle2} label="Completed yesterday" value={String(data.completedYesterday.length)} tone="sky" />
        <Kpi icon={AlertCircle} label="Carried over" value={String(data.incompleteCarried.length)} tone={data.incompleteCarried.length ? "amber" : "muted"} />
      </div>

      {/* Auto-filled work lists */}
      <div className="grid md:grid-cols-2 gap-3">
        <section className="card-surface p-4 space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-1.5 text-emerald-700">
            <CheckCircle2 className="size-4" /> Productive &amp; completed (yesterday)
          </h3>
          {data.completedYesterday.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing marked completed yesterday.</p>
          ) : (
            <ul className="text-sm divide-y divide-border">
              {data.completedYesterday.map((t) => (
                <li key={t.id} className="py-1.5 flex items-center justify-between gap-2">
                  <span className="truncate">{t.title}</span>
                  {t.for && <span className="text-[11px] text-muted-foreground shrink-0">{t.for}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card-surface p-4 space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-1.5 text-amber-700">
            <ListChecks className="size-4" /> Non-productive &amp; incomplete (carried over)
          </h3>
          {data.incompleteCarried.length === 0 ? (
            <p className="text-xs text-muted-foreground">No overdue / carried-over tasks. 🎉</p>
          ) : (
            <ul className="text-sm divide-y divide-border">
              {data.incompleteCarried.map((t) => (
                <li key={t.id} className="py-1.5 flex items-center justify-between gap-2">
                  <span className="truncate">{t.title}</span>
                  <span className={`text-[11px] shrink-0 capitalize ${PRIORITY_TONE[t.priority] ?? ""}`}>{t.priority}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Editable: today's focus + reflection */}
      <DailyTrackerForm
        date={dateISO}
        readOnly={!isSelf}
        initial={{
          keyLearning: data.keyLearning,
          breakdown: data.breakdown,
          breakthrough: data.breakthrough,
          todayFocus: data.todayFocus,
        }}
        dueToday={data.dueToday}
      />
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
  tone?: "emerald" | "sky" | "amber" | "muted";
}) {
  const color =
    tone === "emerald" ? "text-emerald-600" : tone === "sky" ? "text-sky-600" : tone === "amber" ? "text-amber-600" : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
