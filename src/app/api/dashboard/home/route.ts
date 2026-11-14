import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/dashboard/home
 *
 * The native mobile Home screen's data: a few headline figures + a "Today"
 * worklist of actionable counts that deep-link into filtered lists.
 *
 * The headline figures are lib/metrics' — the same definitions as the role
 * dashboards (AUM and active clients of LIVE clients, active = active or
 * redemption risk; the SIP book from active SIPs, not the per-client cache;
 * open leads and follow-ups due by lead stage) — over the app's scope
 * (mobileMetricScope: firm / branch / own book), so Home never shows a number
 * the CRM would contradict. "Meetings today" counts the meetings the viewer
 * owns or attends. Days are India days. Each figure fails soft to 0, so a
 * schema difference never 500s Home.
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { mobileFirmAccess, mobileMeetingScope, mobileMetricScope, mobileTaskScope } from "@/lib/mobile/access";
import { requireSession } from "@/lib/auth/session";
import { getActiveClients, getAUM, getOpenLeads, getReviewsDue, getSipBook } from "@/lib/metrics";

export const dynamic = "force-dynamic";

const FIRM_WIDE = ["owner", "back_office", "ops", "compliance", "branch_head"];
/** Today's India day as [start, end) instants — the database clock runs on UTC. */
const IST_DAY_START = sql`((now() AT TIME ZONE 'Asia/Kolkata')::date::timestamp AT TIME ZONE 'Asia/Kolkata')`;
const IST_DAY_END = sql`(${IST_DAY_START} + interval '1 day')`;

export async function GET() {
  try {
    const session = await requireSession();
    const roles = session.roles ?? [];
    const seesAll = session.mobile ? mobileFirmAccess(session) : roles.some((r) => FIRM_WIDE.includes(r));
    const scope = seesAll ? { tenantId: session.tenantId } : mobileMetricScope(session);
    const taskScope = session.mobile ? mobileTaskScope(session) : sql`(assignee_id = ${session.userId} OR ${seesAll})`;
    const meetingScope = seesAll ? sql`TRUE` : mobileMeetingScope(session, "m");

    const data = await withTenant(session.tenantId, async (tx) => {
      const soft = async <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);
      const count = (query: any) => soft(tx.execute(query).then((r) => Number((r.rows[0] as any)?.v ?? 0)), 0);

      const [clients, aum, sip, leads, reviews, tasksOverdue, tasksToday, meetingsToday] = await Promise.all([
        soft(getActiveClients(tx, scope), { clients: 0, active: 0, funded: 0 }),
        soft(getAUM(tx, scope), { aum: 0, funded: 0 }),
        soft(getSipBook(tx, scope), { monthly: 0, sips: 0, clients: 0, average: null }),
        soft(getOpenLeads(tx, scope), { open: 0, followUpDue: 0 }),
        soft(getReviewsDue(tx, scope, 0), { overdue: 0, dueThisMonth: 0, due30: 0, unscheduled: 0, rows: [] }),
        count(sql`SELECT count(*)::int AS v FROM tasks WHERE tenant_id = ${session.tenantId}::uuid AND status IN ('open','in_progress','blocked') AND deleted_at IS NULL AND due_at < now() AND ${taskScope}`),
        count(sql`SELECT count(*)::int AS v FROM tasks WHERE tenant_id = ${session.tenantId}::uuid AND status IN ('open','in_progress','blocked') AND deleted_at IS NULL AND due_at >= ${IST_DAY_START} AND due_at < ${IST_DAY_END} AND ${taskScope}`),
        count(sql`SELECT count(*)::int AS v FROM review_meetings m WHERE m.tenant_id = ${session.tenantId}::uuid AND m.status IN ('scheduled','confirmed','in_progress') AND m.meeting_date >= ${IST_DAY_START} AND m.meeting_date < ${IST_DAY_END} AND ${meetingScope}`),
      ]);

      return {
        clients: clients.active, aum: aum.aum, sipBook: sip.monthly, leadsOpen: leads.open,
        followupsDue: leads.followUpDue, reviewsDue: reviews.overdue, tasksOverdue, tasksToday, meetingsToday,
      };
    }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

    return NextResponse.json({
      scope: seesAll ? "firm" : session.mobile && roles.includes("branch_head") ? "branch" : "me",
      kpis: [
        { key: "aum", label: "Total AUM", value: data.aum, format: "inr" },
        { key: "clients", label: "Active Clients", value: data.clients, format: "number" },
        { key: "sipBook", label: "Monthly SIP", value: data.sipBook, format: "inr" },
        { key: "leadsOpen", label: "Open Leads", value: data.leadsOpen, format: "number" },
      ],
      // "Today" — only actionable items; the app hides zero-count rows so Home
      // shows just what needs attention. All deep-link into kept modules.
      worklist: [
        { key: "tasksOverdue", label: "Overdue tasks", count: data.tasksOverdue, icon: "alert-triangle", tone: "danger", href: "/(app)/(tabs)/tasks?due=overdue" },
        { key: "tasksToday", label: "Tasks due today", count: data.tasksToday, icon: "check-square", tone: "warning", href: "/(app)/(tabs)/tasks?due=today" },
        { key: "followupsDue", label: "Follow-ups due", count: data.followupsDue, icon: "corner-up-right", tone: "warning", href: "/(app)/(tabs)/activities" },
        { key: "meetingsToday", label: "Meetings today", count: data.meetingsToday, icon: "video", tone: "info", href: "/m/review-meetings" },
        { key: "reviewsDue", label: "Client reviews due", count: data.reviewsDue, icon: "calendar", tone: "info", href: "/m/review-meetings" },
      ],
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
