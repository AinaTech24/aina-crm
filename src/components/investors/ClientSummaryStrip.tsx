/**
 * Client 360 summary strip (RM brief §40) — the relationship in one band at
 * the top of the client page, before the deeper sections: family, category,
 * RM, AUM, SIP book, last meeting, next review, risk profile, open tasks and
 * queries, pending proposals, insurance.
 *
 * Server component; loads its own facts (lib/investors/summary.ts) inside
 * its own Suspense so the page header never waits on it. Fields the firm's
 * licence hides elsewhere on the page are hidden here too.
 *
 * Every cell that has a home lower on the page links to it. The tabs switch
 * to whichever one holds the target (InvestorDetailTabs), so "Open tasks" on
 * the Overview tab opens the task list on the Engagement tab.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { loadClientSummary } from "@/lib/investors/summary";
import { guardianRiskHidden } from "@/lib/investors/guardian-link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatCount, formatDate, formatMoney, humanise } from "@/lib/format";
import { cn } from "@/lib/utils";

type Show = { aum: boolean; sip: boolean; risk: boolean; category: boolean; rm: boolean };

function Cell({ label, children, href }: { label: string; children: ReactNode; href?: string }) {
  const body = <dd className="mt-0.5 text-sm font-medium text-foreground">{children}</dd>;
  // A hash link stays a plain anchor so the tab strip's handler owns the click.
  const link = href?.startsWith("#") ? (
    <a href={href} className="block rounded hover:text-primary hover:underline">{body}</a>
  ) : href ? (
    <Link href={href} className="block rounded hover:text-primary hover:underline">{body}</Link>
  ) : (
    body
  );
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-muted-foreground">{label}</dt>
      {link}
    </div>
  );
}

const Gap = ({ children }: { children: ReactNode }) => (
  <span className="text-xs font-normal text-muted-foreground">{children}</span>
);

export async function ClientSummaryStrip({
  session, investorId, investorName, show,
}: {
  session: Pick<SessionUser, "tenantId" | "userId" | "branchId" | "roles">;
  investorId: string;
  investorName: string;
  show: Show;
}) {
  const s = await withTenant(session.tenantId, async (tx) => {
    const sum = await loadClientSummary(tx, session.tenantId, investorId);
    // A linked minor's risk is the guardian's copy: not shown when the viewer
    // cannot open that guardian (G-1).
    if (sum && (await guardianRiskHidden(tx, session, investorId))) {
      sum.risk = "Not completed"; sum.riskCategory = null; sum.riskSigned = null;
    }
    return sum;
  }, {
    userId: session.userId,
    branchId: session.branchId ?? undefined,
    roles: session.roles,
  });
  if (!s) return null;

  // Compared as India calendar days: a UTC slice would call a review due
  // today "overdue" between midnight and 05:30.
  const istDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
  const reviewLate = s.nextReview != null && istDay(new Date(s.nextReview)) < istDay(new Date());
  const scheduleHref = `/dashboard/review-meetings/new?investorId=${investorId}`;

  return (
    <Card className="px-5 py-4">
      <h2 className="sr-only">Relationship summary</h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        <Cell label="Family" href={s.familyId ? `/dashboard/families/${s.familyId}` : undefined}>
          {s.family ?? <Gap>Not mapped to a family</Gap>}
        </Cell>
        {show.category && (
          <Cell label="Category">
            {s.category ? <Badge raw>{s.category}</Badge> : <Gap>Not set</Gap>}
          </Cell>
        )}
        {show.rm && (
          <Cell label="Relationship manager">{s.rm ?? <Gap>Not assigned</Gap>}</Cell>
        )}
        {show.aum && (
          <Cell label="Current AUM">
            <span className="tabular-nums">{formatMoney(s.aum)}</span>
          </Cell>
        )}
        {show.sip && (
          <Cell label="SIP book" href="#rel-sips">
            {s.sipBook > 0 ? <span className="tabular-nums">{formatMoney(s.sipBook)} / month</span> : <Gap>No active SIP</Gap>}
          </Cell>
        )}
        <Cell label="Last meeting" href="#rel-activity">
          {s.lastMeeting ? formatDate(s.lastMeeting) : <Gap>No meeting recorded</Gap>}
        </Cell>
        <Cell label="Next review">
          {s.nextReview ? (
            <span className={cn(reviewLate && "text-destructive")}>
              {formatDate(s.nextReview)}
              {reviewLate && (
                <>
                  {" · overdue"}
                  <Link href={scheduleHref} className="ml-2 text-xs font-medium text-primary hover:underline">Schedule</Link>
                </>
              )}
            </span>
          ) : (
            <Gap>Not scheduled</Gap>
          )}
        </Cell>
        {show.risk && (
          <Cell label="Risk profile" href="#rel-risk">
            {s.riskCategory ? (
              <span>
                {humanise(s.riskCategory)}
                {s.risk !== "Completed" && (
                  <Badge raw tone="warning" className="ml-2">{s.risk}</Badge>
                )}
              </span>
            ) : (
              <Badge raw tone="warning">Not completed</Badge>
            )}
          </Cell>
        )}
        <Cell label="Open tasks" href="#rel-tasks">
          {s.openTasks > 0 ? <span className="tabular-nums">{formatCount(s.openTasks)}</span> : <Gap>None open</Gap>}
        </Cell>
        <Cell label="Open queries" href="#rel-srs">
          {s.openQueries > 0 ? <span className="tabular-nums">{formatCount(s.openQueries)}</span> : <Gap>None open</Gap>}
        </Cell>
        <Cell label="Pending proposal" href={s.pendingProposals > 0 ? "/dashboard/proposals" : undefined}>
          {s.pendingProposals > 0
            ? <span className="tabular-nums">
                {formatCount(s.pendingProposals)}{s.pendingProposalValue > 0 ? ` · ${formatMoney(s.pendingProposalValue)}` : ""}
              </span>
            : <Gap>None awaiting a decision</Gap>}
        </Cell>
        <Cell label="Insurance" href={s.policies > 0 ? `/dashboard/insurance?q=${encodeURIComponent(investorName)}` : undefined}>
          {s.policies > 0
            ? <span>
                {formatCount(s.policies)} active {s.policies === 1 ? "policy" : "policies"}
                {s.nextRenewal && <span className="block text-2xs font-normal text-muted-foreground">Renewal {formatDate(s.nextRenewal)}</span>}
                {s.openClaims > 0 && <span className="block text-2xs font-normal text-warning-foreground">{formatCount(s.openClaims)} open claim{s.openClaims === 1 ? "" : "s"}</span>}
              </span>
            // A record gap, not a statement about the client's cover.
            : <Gap>No CRM record</Gap>}
        </Cell>
      </dl>
    </Card>
  );
}
