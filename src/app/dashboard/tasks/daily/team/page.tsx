import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
/**
 * Daily Job Tracker — the team's day (CEO review S8). Who has filled in the
 * tracker, and the figures the system already knows for each person. People
 * follow the dashboards' access rule (lib/team/daily-discipline.ts).
 */

import Link from "next/link";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { resolveDataAccess } from "@/lib/dashboards/team";
import { accessLabel } from "@/lib/dashboards/system/access";
import { todayIst } from "@/lib/daily-tracker";
import { loadTrackerSettings, mondayOf, teamDay } from "@/lib/team/daily-discipline";
import { InlineEmpty } from "@/components/common/EmptyState";
import { buttonClass } from "@/components/ui/button-class";

export const dynamic = "force-dynamic";

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

export default async function TeamTrackerPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const today = todayIst();
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= today ? sp.date : today;

  const data = await withTenant(session.tenantId, async (tx) => {
    const access = await resolveDataAccess(tx, session);
    return { access, rows: await teamDay(tx, session.tenantId, access, date), settings: await loadTrackerSettings(tx, session.tenantId) };
  });
  const missing = data.rows.filter((r) => !r.submittedAt).length;
  const isAdmin = can(session.roles, "settings.dashboard", session.permissions);
  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short" });

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeaderCard
        title={<><CalendarCheck className="size-6 text-muted-foreground" /> Team tracker</>}
        breadcrumb={[{ label: "Tasks", href: "/dashboard/tasks" }, { label: "Daily Job Tracker", href: "/dashboard/tasks/daily" }, { label: "Team" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/dashboard/tasks/weekly-pack?week=${mondayOf(date)}`} className={buttonClass("secondary", "sm")}>Weekly pack</Link>
            <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
              <Link href={`/dashboard/tasks/daily/team?date=${addDays(date, -1)}`} className="btn-icon size-7" aria-label="Previous day"><ChevronLeft className="size-4" /></Link>
              <span className="px-2 text-sm font-medium">{date === today ? "Today" : dateLabel}</span>
              <Link
                href={date < today ? `/dashboard/tasks/daily/team?date=${addDays(date, 1)}` : "#"}
                aria-disabled={date >= today}
                className={`btn-icon size-7 ${date >= today ? "pointer-events-none opacity-30" : ""}`}
                aria-label="Next day"
              >
                <ChevronRight className="size-4" />
              </Link>
            </div>
          </div>
        }
      />
      <p className="text-sm text-muted-foreground">
        Showing: {accessLabel(data.access)} · {data.rows.length - missing} of {data.rows.length} filled in
        {data.settings.remindAt ? ` · reminder at ${data.settings.remindAt}` : isAdmin ? <> · <Link href="/dashboard/settings/daily-tracker" className="underline">set a reminder time</Link></> : ""}
      </p>

      <div className="card-surface p-5">
        {data.rows.length === 0 ? (
          <InlineEmpty message="Nobody on your team keeps a tracker yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Person</th>
                  <th className="text-left">Tracker</th>
                  <th className="text-right">Focus items</th>
                  <th className="text-right">Done yesterday</th>
                  <th className="text-right">Meetings yesterday</th>
                  <th className="text-right">Follow-ups yesterday</th>
                  <th className="text-right">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/dashboard/tasks/daily?user=${r.id}&date=${date}`} className="font-medium hover:underline">{r.name ?? "—"}</Link>
                    </td>
                    <td>
                      {r.submittedAt ? (
                        <span className="text-muted-foreground">Filled in {time(r.submittedAt)}</span>
                      ) : (
                        <span className="font-medium text-warning">Not yet</span>
                      )}
                    </td>
                    <td className="text-right tabular-nums">{r.focus || "—"}</td>
                    <td className="text-right tabular-nums">{r.doneYesterday || "—"}</td>
                    <td className="text-right tabular-nums">{r.meetingsYesterday || "—"}</td>
                    <td className="text-right tabular-nums">{r.followUpsYesterday || "—"}</td>
                    <td className={`text-right tabular-nums ${r.overdueNow ? "text-destructive font-medium" : ""}`}>{r.overdueNow || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
