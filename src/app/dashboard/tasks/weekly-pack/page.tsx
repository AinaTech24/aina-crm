import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
/**
 * Weekly team-review pack (CEO review S8): one page per manager for the
 * Monday review — each person's week without anyone typing it in. Done and
 * on time, overdue now, escalations, QA results, tracker days, meetings and
 * follow-ups (lib/team/daily-discipline.ts weeklyPack). Print gives the PDF.
 * People follow the dashboards' access rule: team, branch, firm or own.
 */

import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardList } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { resolveDataAccess } from "@/lib/dashboards/team";
import { accessLabel } from "@/lib/dashboards/system/access";
import { todayIst } from "@/lib/daily-tracker";
import { mondayOf, weeklyPack, type PackRow } from "@/lib/team/daily-discipline";
import { InlineEmpty } from "@/components/common/EmptyState";
import { PrintButton } from "@/components/settings/PrintButton";

export const dynamic = "force-dynamic";

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const short = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", day: "2-digit", month: "short" });
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

export default async function WeeklyPackPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const thisMonday = mondayOf(todayIst());
  // Default: the week just finished — Monday's review is about last week.
  const monday = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? mondayOf(sp.week) : addDays(thisMonday, -7);
  const capped = monday > thisMonday ? thisMonday : monday;

  const { access, rows } = await withTenant(session.tenantId, async (tx) => {
    const access = await resolveDataAccess(tx, session);
    return { access, rows: await weeklyPack(tx, session.tenantId, access, capped) };
  });

  const total = rows.reduce(
    (a, r) => ({
      done: a.done + r.done, doneWithDue: a.doneWithDue + r.doneWithDue, onTime: a.onTime + r.onTime, overdueNow: a.overdueNow + r.overdueNow,
      escalated: a.escalated + r.escalated, qaPassed: a.qaPassed + r.qaPassed, qaFailed: a.qaFailed + r.qaFailed,
      meetings: a.meetings + r.meetings, followUps: a.followUps + r.followUps,
    }),
    { done: 0, doneWithDue: 0, onTime: 0, overdueNow: 0, escalated: 0, qaPassed: 0, qaFailed: 0, meetings: 0, followUps: 0 },
  );
  const sunday = addDays(capped, 6);

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeaderCard
        title={<><ClipboardList className="size-6 text-muted-foreground" /> Weekly team pack</>}
        breadcrumb={[{ label: "Tasks", href: "/dashboard/tasks" }, { label: "Weekly team pack" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
              <Link href={`/dashboard/tasks/weekly-pack?week=${addDays(capped, -7)}`} className="btn-icon size-7" aria-label="Previous week"><ChevronLeft className="size-4" /></Link>
              <span className="px-2 text-sm font-medium tabular-nums">{short(capped)} – {short(sunday)}</span>
              <Link
                href={capped < thisMonday ? `/dashboard/tasks/weekly-pack?week=${addDays(capped, 7)}` : "#"}
                aria-disabled={capped >= thisMonday}
                className={`btn-icon size-7 ${capped >= thisMonday ? "pointer-events-none opacity-30" : ""}`}
                aria-label="Next week"
              >
                <ChevronRight className="size-4" />
              </Link>
            </div>
            <PrintButton />
          </div>
        }
      />
      <p className="text-sm text-muted-foreground">
        Week of {short(capped)} – {short(sunday)}{capped === thisMonday ? " (so far)" : ""} · Showing: {accessLabel(access)}
      </p>

      <div className="card-surface p-5">
        {rows.length === 0 ? (
          <InlineEmpty message="No one to show for this week." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Person</th>
                  <th className="text-right">Done</th>
                  <th className="text-right">On time</th>
                  <th className="text-right">Overdue now</th>
                  <th className="text-right">Escalated</th>
                  <th className="text-right">QA pass / fail</th>
                  <th className="text-right">Tracker days</th>
                  <th className="text-right">Meetings</th>
                  <th className="text-right">Follow-ups</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => <PackLine key={r.id} r={r} monday={capped} />)}
                {rows.length > 1 && (
                  <tr className="font-semibold">
                    <td>Team</td>
                    <td className="text-right tabular-nums">{total.done || "—"}</td>
                    <td className="text-right tabular-nums">{pct(total.onTime, total.doneWithDue)}</td>
                    <td className="text-right tabular-nums">{total.overdueNow || "—"}</td>
                    <td className="text-right tabular-nums">{total.escalated || "—"}</td>
                    <td className="text-right tabular-nums">{total.qaPassed + total.qaFailed ? `${total.qaPassed} / ${total.qaFailed}` : "—"}</td>
                    <td />
                    <td className="text-right tabular-nums">{total.meetings || "—"}</td>
                    <td className="text-right tabular-nums">{total.followUps || "—"}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function PackLine({ r, monday }: { r: PackRow; monday: string }) {
  const late = r.doneWithDue > 0 && r.onTime / r.doneWithDue < 0.8;
  return (
    <tr>
      <td><Link href={`/dashboard/tasks/daily?user=${r.id}&date=${monday}`} className="font-medium hover:underline">{r.name ?? "—"}</Link></td>
      <td className="text-right tabular-nums">{r.done || "—"}</td>
      <td className={`text-right tabular-nums ${late ? "text-warning font-medium" : ""}`}>{pct(r.onTime, r.doneWithDue)}</td>
      <td className={`text-right tabular-nums ${r.overdueNow ? "text-destructive font-medium" : ""}`}>{r.overdueNow || "—"}</td>
      <td className="text-right tabular-nums">{r.escalated || "—"}</td>
      <td className={`text-right tabular-nums ${r.qaFailed ? "text-warning font-medium" : ""}`}>{r.qaPassed + r.qaFailed ? `${r.qaPassed} / ${r.qaFailed}` : "—"}</td>
      <td className="text-right tabular-nums">{r.trackerDays ? `${r.trackerDays} of 6` : "—"}</td>
      <td className="text-right tabular-nums">{r.meetings || "—"}</td>
      <td className="text-right tabular-nums">{r.followUps || "—"}</td>
    </tr>
  );
}
