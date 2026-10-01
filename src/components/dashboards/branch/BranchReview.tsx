/**
 * §27 weekly review mode, §28 monthly review mode, §31 quick actions.
 *
 * The review modes are the manual Monday / month-end branch review, done from
 * the CRM: this week against last week (or this month-to-date against the
 * same days of last month), with the phased target beside it. A weekly target
 * exists only because the firm phases annual targets linearly; with phasing
 * off the column says so instead of inventing one.
 */

import Link from "next/link";
import {
  AlertTriangle, CalendarCheck, CalendarPlus, ClipboardList, ListChecks, ListPlus,
  MessageSquarePlus, Presentation, TrendingDown, Trophy, UserPlus, Users,
} from "lucide-react";
import type { ReviewMode } from "@/lib/dashboard/branch/sections";
import type { MonthRow } from "@/lib/dashboard/my/kpis";
import { can, type Capability } from "@/lib/auth/rbac";
import type { SessionUser } from "@/lib/auth/session";
import { buttonClass } from "@/components/ui/button-class";
import { MoreMenu } from "@/components/common/MoreMenu";
import { Figure, Num, Section, Table } from "@/components/dashboards/my/Shared";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ─────────────────────────── §27 / §28 review mode ─────────────────────────── */

export function ReviewModePanel({
  data, hrefs, balanceRows, phasing, personal = false,
}: {
  /** The RM desk: "My weekly scorecard" rather than "Weekly branch review". */
  personal?: boolean;
  /** null while no review mode is switched on. */
  data: ReviewMode | null;
  hrefs: { weekly: string; monthly: string; off: string };
  /** Monthly only — AUM and SIP book from the recorded month-end snapshots. */
  balanceRows: MonthRow[];
  phasing: "linear" | "none";
}) {
  const toggle = (
    <div className="dash-seg flex-wrap" role="group" aria-label="Review mode">
      {(["weekly", "monthly"] as const).map((m) => (
        <Link
          key={m}
          href={data?.mode === m ? hrefs.off : hrefs[m]}
          scroll={false}
          aria-current={data?.mode === m ? "true" : undefined}
          className={cn(
            "inline-flex min-h-6 items-center rounded-md px-2.5 py-1 text-2xs font-semibold transition-colors",
            data?.mode === m ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
          )}
        >
          {m === "weekly" ? (personal ? "Weekly scorecard" : "Weekly review") : personal ? "Monthly scorecard" : "Monthly review"}
        </Link>
      ))}
    </div>
  );

  if (!data) {
    return (
      <Section
        title={personal ? "My scorecards" : "Branch review"}
        subtitle={personal
          ? "This week against last week, or this month against last — with the target beside each figure."
          : "Run the weekly RM review or the monthly branch review from here instead of compiling a sheet."}
        icon={<Presentation className="size-4" />}
        action={toggle}
      >
        <p className="text-xs text-muted-foreground">
          Weekly: this week against last week, with the weekly share of each annual target. Monthly: month to date
          against the same days of last month, product by product.
        </p>
      </Section>
    );
  }

  const rows = data.mode === "monthly"
    ? [
        ...balanceRows.map((b) => ({
          key: b.key, label: `${b.label} (month-end)`, format: b.format, previous: b.previous, current: b.current,
          target: null as number | null, annual: null as number | null, inverse: b.inverse ?? false, balance: true,
        })),
        ...data.rows.map((r) => ({ ...r, previous: r.previous as number | null, current: r.current as number | null, inverse: r.inverse ?? false, balance: false })),
      ]
    : data.rows.map((r) => ({ ...r, previous: r.previous as number | null, current: r.current as number | null, inverse: r.inverse ?? false, balance: false }));

  return (
    <Section
      title={data.mode === "weekly"
        ? (personal ? "My weekly scorecard" : "Weekly branch review")
        : (personal ? "My monthly scorecard" : "Monthly branch review")}
      subtitle={`${data.currentLabel} against ${data.previousLabel}.`}
      icon={<Presentation className="size-4" />}
      action={toggle}
      note={phasing === "linear"
        ? "Target is the annual target pro-rated to this window by days — the firm's configured phasing. Metrics without an annual target show “—”. AUM and SIP book are recorded month-end balances, not flows."
        : "Target phasing is switched off for this firm, so a week or a month has no target of its own. AUM and SIP book are recorded month-end balances, not flows."}
    >
      <div id="review-mode" className="scroll-mt-40" />
      <Table
        rows={rows.length}
        empty="Nothing to compare."
        head={
          <>
            <th scope="col">Metric</th>
            <th scope="col" className="text-right">{data.previousLabel}</th>
            <th scope="col" className="text-right">{data.currentLabel}</th>
            <th scope="col" className="text-right">Change</th>
            <th scope="col" className="text-right">Change %</th>
            <th scope="col" className="text-right">Target</th>
            <th scope="col" className="text-right">vs target</th>
            {data.mode === "monthly" && <th scope="col" className="text-right">FY target</th>}
          </>
        }
      >
        {rows.map((r) => {
          const change = r.previous != null && r.current != null ? r.current - r.previous : null;
          const good = change == null || change === 0 ? null : r.inverse ? change < 0 : change > 0;
          const pct = change != null && r.previous != null && r.previous !== 0 ? change / Math.abs(r.previous) : null;
          const vs = r.target != null && r.target > 0 && r.current != null ? r.current / r.target : null;
          return (
            <tr key={r.key}>
              <td className="py-2.5 font-medium">{r.label}</td>
              <Num><Figure value={r.previous} format={r.format} unavailable="Not recorded." /></Num>
              <Num><Figure value={r.current} format={r.format} unavailable="Not recorded." /></Num>
              <Num tone={good == null ? "neutral" : good ? "good" : "bad"}>
                {change == null ? <span className="text-muted-foreground">—</span> : (
                  <>{change > 0 ? "+" : change < 0 ? "−" : ""}<Figure value={Math.abs(change)} format={r.format} /></>
                )}
              </Num>
              <Num tone={good == null ? "neutral" : good ? "good" : "bad"}>
                {pct == null ? (
                  <span className="text-muted-foreground" title={r.previous === 0 ? "The previous window was zero, so there is no percentage to take." : "Not recorded."}>N/A</span>
                ) : `${pct > 0 ? "+" : ""}${formatPercent(pct * 100, 1)}`}
              </Num>
              <Num>
                {r.balance ? <span className="text-2xs text-muted-foreground">—</span> : (
                  <Figure value={r.target} format={r.format} unavailable={phasing === "none" ? "Not phased." : "No annual target set."} />
                )}
              </Num>
              <Num tone={vs == null ? "neutral" : vs >= 1 ? "good" : "neutral"}>
                {vs == null ? <span className="text-muted-foreground">—</span> : formatPercent(vs * 100, 0)}
              </Num>
              {data.mode === "monthly" && (
                <Num>
                  {r.balance ? <span className="text-2xs text-muted-foreground">—</span> : (
                    <Figure value={r.annual} format={r.format} unavailable="No annual target set." />
                  )}
                </Num>
              )}
            </tr>
          );
        })}
      </Table>

      {data.mode === "monthly" && (
        <div className="mt-5">
          <h3 className="mb-2 text-2xs font-semibold text-muted-foreground">Business by product (Business Entries)</h3>
          {data.products == null ? (
            <p className="text-xs text-muted-foreground">No business entry was recorded in either window, so there is no product split.</p>
          ) : (
            <Table
              rows={data.products.length}
              empty="Nothing recorded."
              head={
                <>
                  <th scope="col">Product</th>
                  <th scope="col" className="text-right">{data.previousLabel}</th>
                  <th scope="col" className="text-right">{data.currentLabel}</th>
                  <th scope="col" className="text-right">Change</th>
                </>
              }
            >
              {data.products.map((p) => (
                <tr key={p.key}>
                  <td className="py-2.5">{p.label}</td>
                  <Num><Figure value={p.previous} /></Num>
                  <Num><Figure value={p.current} /></Num>
                  <Num tone={p.current - p.previous > 0 ? "good" : p.current - p.previous < 0 ? "bad" : "neutral"}>
                    {p.current === p.previous ? <span className="text-muted-foreground">—</span> : (
                      <>{p.current > p.previous ? "+" : "−"}<Figure value={Math.abs(p.current - p.previous)} /></>
                    )}
                  </Num>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-2xs text-muted-foreground">
            Also part of the monthly review: <Link href="#client-book" className="text-primary hover:underline">client category mix</Link>
            {" · "}<Link href="#rm-scoreboard" className="text-primary hover:underline">RM performance</Link>
            {" · "}<Link href="#month-on-month" className="text-primary hover:underline">month-on-month table</Link>.
          </p>
        </div>
      )}
    </Section>
  );
}

/* ─────────────────────────── §31 quick actions ─────────────────────────── */

type Action = {
  key: string;
  label: string;
  href: string;
  icon: typeof UserPlus;
  /** Rendered only if the user holds ANY of these. Undefined = always. */
  caps?: Capability[];
  primary?: boolean;
};

/**
 * Permission-aware: an action the viewer cannot perform is not rendered at all.
 * A disabled button invites a ticket asking how to enable it; a button that
 * opens a 403 is worse.
 */
export function BranchQuickActions({
  session, hrefs,
}: {
  session: SessionUser;
  hrefs: {
    sipRejections: string; pendingReviews: string; overdueTasks: string; clients: string;
  };
}) {
  const actions: Action[] = [
    { key: "meeting", label: "Schedule meeting", href: "/dashboard/review-meetings/new", icon: CalendarPlus,
      caps: ["review_meeting.manage.all", "review_meeting.manage.assigned"], primary: true },
    { key: "review", label: "Create review", href: "/dashboard/review-meetings/new?category=review", icon: CalendarCheck,
      caps: ["review_meeting.manage.all", "review_meeting.manage.assigned"] },
    { key: "lead", label: "Add lead", href: "/dashboard/leads/new", icon: UserPlus, caps: ["lead.edit.all", "lead.edit.assigned"] },
    { key: "task", label: "Add task", href: "/dashboard/tasks/new", icon: ListPlus, caps: ["task.edit.all", "task.edit.assigned"] },
    { key: "query", label: "Add service request", href: "/dashboard/service-requests/new", icon: MessageSquarePlus, caps: ["service_request.manage"] },
    { key: "rejections", label: "SIP rejections", href: hrefs.sipRejections, icon: AlertTriangle },
    { key: "reviews", label: "Pending reviews", href: hrefs.pendingReviews, icon: ListChecks,
      caps: ["investor.view.all", "investor.view.assigned"] },
    { key: "redemptions", label: "Redemptions", href: "/dashboard/reports/redemption", icon: TrendingDown },
    { key: "tasks", label: "Overdue tasks", href: hrefs.overdueTasks, icon: ClipboardList, caps: ["task.view.all", "task.view.assigned"] },
    { key: "rm", label: "RM performance", href: "#rm-scoreboard", icon: Trophy },
    { key: "clients", label: "Client list", href: hrefs.clients, icon: Users, caps: ["investor.view.all", "investor.view.assigned"] },
  ];
  const allowed = actions.filter((a) => !a.caps || a.caps.some((c) => can(session.roles, c, session.permissions)));
  // Two buttons and "More" in the header row. Eleven same-weight buttons in a
  // card of their own was a toolbar to read before the first number.
  const ON_BAR = new Set(["meeting", "task"]);
  const bar = allowed.filter((a) => ON_BAR.has(a.key));
  const more = allowed.filter((a) => !ON_BAR.has(a.key));
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Quick actions">
      {bar.map((a) => {
        const Icon = a.icon;
        return (
          <Link key={a.key} href={a.href} className={buttonClass(a.primary ? "primary" : "secondary", "md")}>
            <Icon className="size-4" aria-hidden />
            {a.label}
          </Link>
        );
      })}
      <MoreMenu text="More" label="More actions" items={more.map((a) => ({ href: a.href, label: a.label }))} />
    </div>
  );
}
