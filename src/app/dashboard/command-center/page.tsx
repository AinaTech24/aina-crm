import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
/**
 * My Day — the single screen an owner or RM opens every morning.
 *
 * One prioritised worklist across every module: SLA breaches, SIP bounces,
 * redemption risk, overdue reviews, KYC expiries, overdue tasks & lead
 * follow-ups, stale risk profiles, birthdays. Firm-wide for owners/branch
 * heads/compliance; "your book only" for RMs and ops.
 *
 * Pure read over current state (src/lib/command-center/queue.ts) — every row
 * deep-links to where you act.
 *
 * Two columns: "Must do today" (late or due today, in a fixed urgency order)
 * and "Coming up". The header counts only individual work: bulk jobs (the
 * annual risk-profile refresh) and courtesies (birthdays, anniversaries) are
 * shown, never counted — 786 stale risk profiles used to read as "792 this
 * week" and bury the six things that were.
 */

import Link from "next/link";
import {
  LifeBuoy, XOctagon, TrendingDown, CalendarClock, Calendar, CalendarOff, CalendarCheck, ShieldAlert, ListChecks,
  Sparkles, ShieldCheck, Cake, CheckCircle2, Inbox, MessageCircle, FileText,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { withTenant } from "@/db/client";
import { buildCommandQueue, type ActionGroup, type ActionItem } from "@/lib/command-center/queue";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { AutoRefresh } from "@/components/common/AutoRefresh";
import { CommandClientPicker } from "@/components/command-center/CommandClientPicker";
import { CommandItemActions } from "@/components/command-center/CommandItemActions";
import { OlderOverdueTasks } from "@/components/command-center/OlderOverdueTasks";
import { HelpTip } from "@/components/common/HelpTip";
import { sql } from "drizzle-orm";
import { MyDayNav } from "@/components/layout/MyDayNav";
import { navEnabledForUser } from "@/lib/nav/enabled-for-user";

export const dynamic = "force-dynamic";

const ICONS: Record<string, any> = {
  LifeBuoy, XOctagon, TrendingDown, CalendarClock, Calendar, CalendarOff, CalendarCheck, ShieldAlert,
  ListChecks, Sparkles, ShieldCheck, Cake, MessageCircle, FileText,
};

/** WhatsApp wish text for the inline "send wish" action. */
function wishText(actionType: ActionItem["actionType"], name: string): string {
  if (actionType === "anniversary") return `Dear ${name}, wishing you a very happy wedding anniversary! 💐`;
  return `Dear ${name}, wishing you a very happy birthday! 🎂 May the year ahead bring you health, happiness and prosperity.`;
}

/** Where a card sits on the clock: already late, due today, or later this week. */
type Timing = "overdue" | "today" | "week";

const TIMING: Record<string, Timing> = {
  sla_breach: "overdue",
  sip_bounce: "overdue",
  mandate_rejected: "overdue",
  tasks_overdue: "overdue",
  lead_followups: "overdue",
  reviews_due: "overdue",
  onboarding_stuck: "overdue",
  proposals_aging: "overdue",
  unanswered_inbound: "overdue",
  redemption_risk: "today",
  meetings_today: "today",
  leave_approvals: "today",
  clock_in: "today",
  birthdays_today: "today",
  anniversaries_today: "today",
  birthdays: "week",
  rp_stale: "week",
};

/** Anything unlisted falls back to its severity band. */
function timingOf(g: ActionGroup): Timing {
  return TIMING[g.key] ?? (g.severity === "now" ? "overdue" : g.severity === "today" ? "today" : "week");
}

/**
 * Shown, never counted in the header: a bulk job (one decision for hundreds of
 * clients) and courtesies (nice to do, not work that is late).
 */
const NOT_COUNTED = new Set(["rp_stale", "birthdays_today", "birthdays", "anniversaries_today"]);

/**
 * "Must do today" order: SLA breaches, overdue tasks, today's meetings,
 * follow-ups, leave approvals, birthdays. Bounced SIPs and rejected mandates
 * are breaches of the same kind (money already stopped), so they sit with the
 * SLA breaches; the other follow-up flavours sit with follow-ups. Unlisted
 * cards go after these, in the queue's own order.
 */
const URGENCY = [
  "sla_breach", "sip_bounce", "mandate_rejected",
  "tasks_overdue",
  "meetings_today",
  "lead_followups", "unanswered_inbound", "reviews_due", "proposals_aging", "onboarding_stuck",
  "kyc_expiring", "redemption_risk", "clock_in",
  "leave_approvals",
  "birthdays_today", "anniversaries_today",
];
const urgencyRank = (key: string) => {
  const i = URGENCY.indexOf(key);
  return i === -1 ? URGENCY.length : i;
};

/** Old saved views and links use the severity names. */
const LEGACY_FILTER: Record<string, Timing> = { now: "overdue", today: "today", soon: "week" };

export default async function CommandCenterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const firmWide = can(session.roles, "dashboard.view.owner", session.permissions);
  const canBulkRiskProfile = can(session.roles, "risk_profile.manage", session.permissions);
  const timingFilter = (sp.severity ?? "")
    .split(",")
    .filter(Boolean)
    .map((v) => LEGACY_FILTER[v] ?? v);
  const catFilter = (sp.category ?? "").split(",").filter(Boolean);
  // Owners can scope the whole queue to one user; everyone else only sees their
  // own book, so the user filter is owner-only.
  const userParam = firmWide ? (sp.user ?? "").trim() : "";
  // Scope the whole board to a single client (search-as-you-type picker).
  const clientId = (sp.client ?? "").trim();

  // "Clock in for today" is about YOUR attendance: only on your own board, and
  // only when Attendance is switched on for you (the sidebar's own gates).
  let includeClockIn = false;
  if (!userParam && !clientId) {
    const modules = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`SELECT enabled_modules FROM users WHERE id = ${session.userId}::uuid`);
      return ((r.rows[0] as { enabled_modules?: string[] | null } | undefined)?.enabled_modules ?? null) as string[] | null;
    });
    includeClockIn = await navEnabledForUser(session, modules, "/dashboard/attendance");
  }

  const { allGroups, userOptions, clientName } = await withTenant(
    session.tenantId,
    async (tx) => {
      const groups = await buildCommandQueue(
        tx as any,
        {
          ...(userParam ? { userId: userParam, firmWide: false } : { userId: session.userId, firmWide }),
          clientId,
          includeClockIn,
        }
      );
      // Resolve the selected client's name for the picker chip.
      let clientName = "";
      if (clientId) {
        const cr = await tx.execute(sql`SELECT name FROM investors WHERE id = ${clientId} LIMIT 1`);
        clientName = ((cr.rows[0] as any)?.name as string) ?? "";
      }
      // Roster for the User filter — active users, so any newly-added user shows
      // up automatically.
      let users: { value: string; label: string }[] = [];
      if (firmWide) {
        const r = await tx.execute(sql`
          SELECT id, name FROM users
          WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
          ORDER BY name ASC
        `);
        users = (r.rows as { id: string; name: string }[]).map((u) => ({ value: String(u.id), label: u.name ?? "—" }));
      }
      return { allGroups: groups, userOptions: users, clientName };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  // Category options come from whatever the queue produced — so the filter only
  // ever offers categories that actually have open items.
  const categoryOptions = Array.from(
    new Map(allGroups.map((g) => [g.key, g.label] as const)).entries()
  ).map(([value, label]) => ({ value, label }));

  const dateFrom = (sp.date_from ?? "").slice(0, 10);
  const dateTo = (sp.date_to ?? "").slice(0, 10);
  const inRange = (d?: string | null) => {
    if (!dateFrom && !dateTo) return true;
    if (!d) return true; // undated = always-current (e.g. SLA breach) — never hide
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  let groups = allGroups;
  if (timingFilter.length) groups = groups.filter((g) => timingFilter.includes(timingOf(g)));
  if (catFilter.length) groups = groups.filter((g) => catFilter.includes(g.key));
  // Date-range filter — narrows dated items (reviews, meetings, KYC, tasks,
  // follow-ups…) to the window; undated "act now" items always stay. Count
  // reflects what's shown. (The overdue-task 30-day split is a view of the
  // full list, so it steps aside while a date range is on.)
  if (dateFrom || dateTo) {
    groups = groups
      .map((g) => {
        const items = g.items.filter((it) => inRange(it.date));
        return { ...g, items, count: items.length, aging: undefined };
      })
      .filter((g) => g.items.length > 0);
  }

  const countOf = (t: Timing) =>
    groups.filter((g) => !NOT_COUNTED.has(g.key) && timingOf(g) === t).reduce((n, g) => n + g.count, 0);
  const overdueCount = countOf("overdue");
  const todayCount = countOf("today");
  const weekCount = countOf("week");

  const riskProfiles = groups.find((g) => g.key === "rp_stale");
  const mustDo = groups
    .filter((g) => g.key !== "rp_stale" && timingOf(g) !== "week")
    .sort((a, b) => urgencyRank(a.key) - urgencyRank(b.key));
  const comingUp = groups
    .filter((g) => g.key !== "rp_stale" && timingOf(g) === "week")
    .sort((a, b) => urgencyRank(a.key) - urgencyRank(b.key));

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Triage queue is "act now" — keep it fresh as work completes elsewhere. */}
      <AutoRefresh intervalMs={30000} />
      {/* Header */}
      <PageHeaderCard title={<><Inbox className="size-6 text-muted-foreground" /> My Day
            <HelpTip title="My Day">
              Your single &ldquo;what needs me today&rdquo; screen — overdue tasks, today&apos;s
              meetings, SIP bounces, birthdays and follow-ups, ranked by urgency. Start your day here.
            </HelpTip></>} subtitle={<>Everything that needs you today — overdue tasks, follow-ups, reviews and breaches.</>} actions={<><div className="flex items-center gap-3 flex-wrap">
          <div
            className="flex items-center gap-4 rounded-lg border border-border bg-card px-3 py-1.5"
            title="Bulk jobs (risk-profile refresh) and birthdays are shown below but not counted here."
          >
            <Stat label="Overdue" value={overdueCount} tone={overdueCount ? "rose" : "muted"} />
            <Stat label="Due today" value={todayCount} tone={todayCount ? "amber" : "muted"} />
            <Stat label="This week" value={weekCount} tone="muted" />
          </div>
        </div></>} />

      <MyDayNav />

      <CompactFilterBar
        totalCount={overdueCount + todayCount + weekCount}
        rightSlot={<CustomViews viewsKey="views:command-center" />}
        leftSlot={<CommandClientPicker selectedId={clientId} selectedName={clientName} />}
        filters={[
          ...(firmWide && userOptions.length
            ? [{ type: "select" as const, key: "user", label: "User", allLabel: "All users", options: userOptions }]
            : []),
          { type: "date_range" as const, key: "date", label: "Date" },
          {
            type: "multi",
            key: "severity",
            label: "When",
            options: [
              { value: "overdue", label: "Overdue" },
              { value: "today", label: "Due today" },
              { value: "week", label: "This week" },
            ],
          },
          ...(categoryOptions.length
            ? [{ type: "multi" as const, key: "category", label: "Category", options: categoryOptions }]
            : []),
        ]}
      />

      {(dateFrom || dateTo) && (
        <p className="text-2xs text-muted-foreground -mt-3">
          Date filter narrows dated items (reviews, meetings, follow-ups…). Always-current items like SLA breaches stay visible.
        </p>
      )}

      {groups.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <CheckCircle2 className="size-10 text-muted-foreground mx-auto mb-3" />
          <div className="font-semibold text-lg">All clear</div>
          <p className="text-sm text-muted-foreground mt-1">
            No overdue reviews, SIP bounces, SLA breaches or follow-ups in {firmWide ? "the firm" : "your book"} right now.
          </p>
        </div>
      ) : (
        // Two columns from laptop width up, one on a phone.
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <section aria-labelledby="myday-must-do" className="min-w-0 space-y-4">
            <ColumnHeading id="myday-must-do" label="Must do today" count={overdueCount + todayCount} />
            {mustDo.length === 0 ? (
              <p className="card-surface p-6 text-center text-sm text-muted-foreground">Nothing late or due today.</p>
            ) : (
              mustDo.map((g) => <GroupCard key={g.key} group={g} />)
            )}
          </section>
          <section aria-labelledby="myday-coming-up" className="min-w-0 space-y-4">
            <ColumnHeading id="myday-coming-up" label="Coming up" count={weekCount} />
            {riskProfiles && <RiskProfileBulkCard group={riskProfiles} canBulk={canBulkRiskProfile} />}
            {comingUp.map((g) => (
              <GroupCard key={g.key} group={g} />
            ))}
            {!riskProfiles && comingUp.length === 0 && (
              <p className="card-surface p-6 text-center text-sm text-muted-foreground">Nothing coming up this week.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ColumnHeading({ id, label, count }: { id: string; label: string; count: number }) {
  return (
    <h2 id={id} className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
      <span className="rounded-full bg-secondary px-1.5 tabular-nums text-foreground/70">{count}</span>
    </h2>
  );
}

/* Severity budget: ONE chip per card, tinted only when the card is late (rose)
   or due today (soft amber). Birthdays and other courtesies stay neutral even
   on the day — nothing about them is late. */
const TIMING_CHIP: Record<Timing, { label: string; cls: string; icon: string }> = {
  overdue: { label: "Overdue", cls: "bg-rose-50 text-rose-700 border border-rose-200", icon: "text-rose-600" },
  today: { label: "Today", cls: "bg-amber-50 text-amber-700 border border-amber-200", icon: "text-amber-600" },
  week: { label: "This week", cls: "bg-secondary text-muted-foreground border border-transparent", icon: "text-muted-foreground" },
};

function GroupCard({ group }: { group: ActionGroup }) {
  const Icon = ICONS[group.icon] ?? Inbox;
  const timing = timingOf(group);
  const chip = NOT_COUNTED.has(group.key) ? { ...TIMING_CHIP.week, label: TIMING_CHIP[timing].label } : TIMING_CHIP[timing];
  const aging = group.aging;
  // Overdue tasks list only the last 30 days; the rest fold away below.
  const rows = aging ? aging.recent : group.items;
  const listedTotal = aging ? aging.recentCount : group.count;
  return (
    <div className="card-surface overflow-hidden border border-border">
      {group.severity === "now" && <div className="h-0.5 bg-rose-500" />}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-secondary/30">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`size-4 shrink-0 ${chip.icon}`} />
          <span className="font-semibold text-sm truncate">{group.label}</span>
        </div>
        <span className={`shrink-0 text-2xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full tabular-nums ${chip.cls}`}>
          {chip.label} · {group.count}
        </span>
      </div>
      {rows.length > 0 ? (
        <ul className="divide-y">
          {rows.map((it) => (
            <li key={it.id} className="flex items-center gap-1 px-4 py-2.5 hover:bg-accent/40 transition-colors">
              <Link href={it.href} className="flex items-center gap-2 min-w-0 flex-1">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{it.title}</div>
                  {it.detail && <div className="text-2xs text-muted-foreground truncate">{it.detail}</div>}
                </div>
                {typeof it.ageDays === "number" && it.ageDays > 0 && (
                  <span
                    className={`text-2xs tabular-nums shrink-0 ${
                      it.ageDays > 30
                        ? "font-semibold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200"
                        : it.ageDays > 7
                          ? "font-medium text-amber-700"
                          : "text-muted-foreground"
                    }`}
                    title={`${it.ageDays} day(s) overdue / waiting`}
                  >
                    {it.ageDays}d overdue
                  </span>
                )}
              </Link>
              <CommandItemActions
                itemKey={it.itemKey ?? `${group.key}:${it.id}`}
                actionType={it.actionType}
                taskId={it.actionType === "task" ? it.id : undefined}
                phone={it.phone}
                wishText={wishText(it.actionType, it.title)}
              />
            </li>
          ))}
        </ul>
      ) : (
        aging && <p className="px-4 py-2.5 text-2xs text-muted-foreground">None in the last 30 days.</p>
      )}
      {listedTotal > rows.length && (
        <Link
          href={group.href}
          className="block px-4 py-2 text-xs font-medium text-brand-cyan-deep hover:underline border-t bg-card"
        >
          View all {listedTotal} →
        </Link>
      )}
      {aging && aging.olderCount > 0 && (
        <OlderOverdueTasks
          count={aging.olderCount}
          ids={aging.olderIds}
          items={aging.older.map((it) => ({
            id: it.id,
            title: it.title,
            detail: it.detail,
            href: it.href,
            ageDays: it.ageDays,
            itemKey: it.itemKey,
          }))}
        />
      )}
    </div>
  );
}

/**
 * The annual risk-profile refresh as ONE card. Hundreds of clients listed one
 * by one is not a to-do list; it is a bulk job with a bulk tool.
 */
function RiskProfileBulkCard({ group, canBulk }: { group: ActionGroup; canBulk: boolean }) {
  return (
    <div className="card-surface border border-border p-4 flex items-start gap-3">
      <ShieldCheck className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">
          {group.count.toLocaleString("en-IN")} client{group.count === 1 ? " needs" : "s need"} a risk profile
        </div>
        <p className="mt-0.5 text-2xs text-muted-foreground">
          Never assessed, or last signed more than a year ago (SEBI&apos;s annual refresh).
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium">
          {canBulk && (
            <Link href="/dashboard/risk-profiles" className="text-brand-cyan-deep hover:underline">
              Send links in bulk →
            </Link>
          )}
          <Link href={group.href} className={canBulk ? "text-muted-foreground hover:underline" : "text-brand-cyan-deep hover:underline"}>
            See the list{canBulk ? "" : " →"}
          </Link>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "rose" | "amber" | "muted" }) {
  const cls = tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : "text-foreground";
  return (
    <div className="text-center">
      <div className={`text-xl font-bold tabular-nums leading-none ${cls}`}>{value}</div>
      <div className="text-2xs uppercase tracking-wider text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
