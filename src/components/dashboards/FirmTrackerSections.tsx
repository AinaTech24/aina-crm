import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { Bucket, FirmTracker } from "@/lib/dashboard/firm-tracker";
import { formatINR } from "@/lib/utils";

/**
 * Firm tracker — every headline figure the firm asked to be able to see and
 * track, in one place, under the Date / Branch / Team-member filters.
 *
 * Each tile shows the number and links to the screen that OWNS it. Nothing here
 * re-implements a module: the lead funnel, KYC tracker, SIP health board,
 * insurance renewals and task list already exist and remain the place where the
 * detail — and the definition of the metric — lives. That keeps one source of
 * truth per number, which is the opposite of what the dashboard had before
 * (two AUM figures, both labelled "AUM", 34% apart).
 *
 * Tiles are grouped and each group has a heading, because this is a long page
 * by design; the grouping is what makes it scannable rather than a wall.
 */

const BAR = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-6"];

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="section-title">{title}</h2>
        {hint && <span className="text-2xs text-muted-foreground">{hint}</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function Tile({
  label,
  href,
  linkLabel,
  children,
  note,
}: {
  label: string;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="card-surface p-4 flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {note && <span className="text-2xs text-muted-foreground whitespace-nowrap">{note}</span>}
      </div>
      <div className="flex-1">{children}</div>
      <Link
        href={href}
        className="text-2xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-auto"
      >
        {linkLabel} <ArrowRight className="size-3" />
      </Link>
    </div>
  );
}

function Big({ value, sub }: { value: string; sub?: string }) {
  return (
    <div>
      <div className="text-2xl font-bold tracking-tight tabular-nums leading-tight">{value}</div>
      {sub && <div className="text-2xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

/** A labelled distribution with proportion bars — the workhorse tile body. */
function Breakdown({
  rows,
  money,
  max = 5,
}: {
  rows: Bucket[];
  money?: boolean;
  max?: number;
}) {
  if (!rows.length) {
    return <div className="text-sm text-muted-foreground">Nothing recorded yet.</div>;
  }
  const shown = rows.slice(0, max);
  const peak = Math.max(...shown.map((r) => (money ? (r.amount ?? 0) : r.count)), 1);
  return (
    <div className="flex flex-col gap-1.5">
      {shown.map((r, i) => {
        const v = money ? (r.amount ?? 0) : r.count;
        return (
          <div key={r.label} className="flex items-center gap-2 text-sm">
            <span className="w-28 shrink-0 truncate capitalize" title={r.label}>
              {r.label.replace(/_/g, " ")}
            </span>
            <span className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
              <span
                className={`block h-full rounded-full ${BAR[i % BAR.length]}`}
                style={{ width: `${Math.max(3, (v / peak) * 100)}%` }}
              />
            </span>
            <span className="tabular-nums text-2xs text-muted-foreground w-20 text-right shrink-0">
              {money ? formatINR(v) : v.toLocaleString("en-IN")}
            </span>
          </div>
        );
      })}
      {rows.length > max && (
        <div className="text-2xs text-muted-foreground">+{rows.length - max} more</div>
      )}
    </div>
  );
}

/** New / Out / Net — the shape SIP and equity business are read in. */
function Flow({
  inLabel,
  inValue,
  outLabel,
  outValue,
  net,
  money,
}: {
  inLabel: string;
  inValue: number;
  outLabel: string;
  outValue: number;
  net: number;
  money?: boolean;
}) {
  const f = (v: number) => (money ? formatINR(v) : v.toLocaleString("en-IN"));
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="flex justify-between gap-2">
        <span className="text-muted-foreground">{inLabel}</span>
        <span className="tabular-nums font-medium text-success">{f(inValue)}</span>
      </div>
      <div className="flex justify-between gap-2">
        <span className="text-muted-foreground">{outLabel}</span>
        <span className="tabular-nums font-medium text-destructive">{f(outValue)}</span>
      </div>
      <div className="flex justify-between gap-2 border-t border-border pt-1.5">
        <span className="font-medium">Net</span>
        <span className={`tabular-nums font-bold ${net >= 0 ? "text-success" : "text-destructive"}`}>
          {net >= 0 ? "+" : ""}
          {f(net)}
        </span>
      </div>
    </div>
  );
}

export function FirmTrackerSections({ data, periodLabel }: { data: FirmTracker; periodLabel: string }) {
  const { leads, clients, business, insurance, team } = data;
  // "current" = a book-state figure that deliberately ignores the date filter.
  const win = periodLabel;

  return (
    <div className="space-y-7">
      <Section title="Leads" hint={`new leads counted for ${win}; stages are current`}>
        <Tile label="New leads by source" href="/dashboard/reports/lead-funnel" linkLabel="Lead funnel" note={win}>
          <Breakdown rows={leads.bySource} />
        </Tile>
        <Tile label="Conversion ratio" href="/dashboard/leads" linkLabel="Open leads" note={win}>
          <Big
            value={`${leads.conversionPct.toFixed(1)}%`}
            sub={`${leads.converted} converted of ${leads.totalInWindow} new`}
          />
        </Tile>
        <Tile label="Lead stage tracking" href="/dashboard/pipeline-board" linkLabel="Pipeline board" note="current">
          <Breakdown rows={leads.byStage} />
        </Tile>
      </Section>

      <Section title="Clients" hint="book state unless marked otherwise">
        <Tile label="New clients onboarded" href="/dashboard/investors" linkLabel="All clients" note={win}>
          <Big value={clients.onboardedInWindow.toLocaleString("en-IN")} sub="joined in this window" />
        </Tile>
        <Tile label="Family-wise clients" href="/dashboard/families" linkLabel="Family mapping" note="current">
          <Big
            value={clients.families.toLocaleString("en-IN")}
            sub={`${clients.clientsInFamilies} clients mapped into families`}
          />
        </Tile>
        {/* "Category-wise AUM" stood here and was the same GROUP BY segment_tag,
            SUM(aum) that Overview draws as the "AUM by Segment" donut — the same
            numbers, one tab apart. Same reason the "Total AUM & SIP book" tile
            below was removed: surface the number once, link to its owner. The
            SIP cut stays; nothing else plots it. */}
        <Tile label="Category-wise SIP book" href="/dashboard/sips" linkLabel="SIP book" note="current">
          <Breakdown rows={clients.byCategorySip} money />
        </Tile>
        <Tile label="Risk profiling" href="/dashboard/risk-profiles" linkLabel="Risk profiles" note="current">
          <div className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Signed</span><span className="tabular-nums font-medium">{clients.riskDone}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Provisional</span><span className="tabular-nums font-medium text-warning-foreground">{clients.riskProvisional}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Not started</span><span className="tabular-nums font-medium text-destructive">{clients.riskPending}</span></div>
          </div>
        </Tile>
        <Tile label="KYC status" href="/dashboard/reports/kyc-tracker" linkLabel="KYC tracker" note="current">
          <Breakdown rows={clients.byKyc} />
        </Tile>
        <Tile label="Client stage tracking" href="/dashboard/lifecycle" linkLabel="Lifecycle" note="current">
          <Breakdown rows={clients.byStatus} />
        </Tile>
        <Tile label="Review frequency" href="/dashboard/review-meetings" linkLabel="Meetings" note="current">
          <Breakdown rows={clients.byReviewFrequency} />
        </Tile>
      </Section>

      <Section title="Business" hint={`flows counted for ${win}`}>
        <Tile label="SIP business" href="/dashboard/sips" linkLabel="SIP book" note={win}>
          <Flow inLabel="Started" inValue={business.sipNew} outLabel="Stopped / paused" outValue={business.sipStopped} net={business.sipNet} />
        </Tile>
        <Tile label="Equity purchase" href="/dashboard/equity" linkLabel="Equity desk" note={win}>
          <Flow inLabel="Purchase" inValue={business.equityPurchase} outLabel="Redemption" outValue={business.equityRedemption} net={business.equityNet} money />
        </Tile>
        {/* A "Total AUM & SIP book" tile stood here and was a THIRD copy of two
            figures the Firm Pulse strip already owns. Adding it contradicted this
            file's own rule — surface the number once, link to its owner. Growth
            MIS is reachable from the AUM breakdown tiles instead. */}
        <Tile label="AIF · PMS · SIF · Liquid" href="/dashboard/business-entries/dashboard" linkLabel="Business entries" note={win}>
          <Breakdown rows={business.byProduct} money />
        </Tile>
        <Tile label="Average ticket size" href="/dashboard/reports/business-mis" linkLabel="Business MIS" note="current / window">
          <div className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">SIP</span><span className="tabular-nums font-medium">{formatINR(business.avgSipTicket)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Lumpsum</span><span className="tabular-nums font-medium">{formatINR(business.avgLumpsumTicket)}</span></div>
          </div>
        </Tile>
        <Tile label="Commission & brokerage" href="/dashboard/commission-reconciliation" linkLabel="Reconciliation" note="current">
          <div className="text-sm text-muted-foreground leading-relaxed">
            Brokerage received vs expected, per AMC and ARN.
          </div>
        </Tile>
      </Section>

      <Section title="Insurance" hint="policy book is current; renewals are this calendar month">
        <Tile label="Policies by type" href="/dashboard/insurance" linkLabel="Insurance book" note="current">
          <Breakdown rows={insurance.byType} />
        </Tile>
        <Tile label="Policy book value" href="/dashboard/insurance/commission" linkLabel="Commission" note="current">
          <Big
            value={insurance.policiesTotal.toLocaleString("en-IN")}
            sub={`${formatINR(insurance.premiumTotal)} annual premium`}
          />
        </Tile>
        <Tile label="Renewals due" href="/dashboard/insurance/renewals" linkLabel="Renewals" note="this month">
          <Big value={insurance.renewalsDue.toLocaleString("en-IN")} sub="policies due this month" />
        </Tile>
        <Tile label="Claims by status" href="/dashboard/insurance-claims" linkLabel="Claims" note="current">
          <Breakdown rows={insurance.claimsByStatus} />
        </Tile>
      </Section>

      <Section title="Team & service" hint={`activity counted for ${win}; queues are current`}>
        <Tile label="Calls logged" href="/dashboard/activities" linkLabel="Activity log" note={win}>
          <Big value={team.callsInWindow.toLocaleString("en-IN")} sub="calls recorded in this window" />
        </Tile>
        <Tile label="Activity mix" href="/dashboard/activities" linkLabel="Activity log" note={win}>
          <Breakdown rows={team.activitiesByStatus} />
        </Tile>
        <Tile label="Meetings by status" href="/dashboard/review-meetings" linkLabel="Meetings" note={win}>
          <Breakdown rows={team.meetingsByStatus} />
        </Tile>
        <Tile label="Task tracker" href="/dashboard/tasks" linkLabel="All tasks" note="current">
          <Breakdown rows={team.tasksByStatus} />
        </Tile>
        <Tile label="Open tasks by member" href="/dashboard/tasks" linkLabel="All tasks" note="current">
          <Breakdown rows={team.tasksByAssignee} />
        </Tile>
        <Tile label="Service requests" href="/dashboard/service-requests" linkLabel="Service requests" note="current">
          <Breakdown rows={team.serviceRequestsByStatus} />
        </Tile>
        <Tile label="Client feedback" href="/dashboard/support/feedback" linkLabel="Feedback" note="current">
          {team.feedbackResponses > 0 ? (
            <Big
              value={`${team.feedbackAvg.toFixed(1)} / 5`}
              sub={`${team.feedbackResponses} rated ${team.feedbackResponses === 1 ? "request" : "requests"}`}
            />
          ) : (
            <div className="text-sm text-muted-foreground leading-relaxed">
              No ratings yet. Clients are asked to rate a service request once it is resolved.
            </div>
          )}
        </Tile>
        <Tile label="ARN / EUIN validity" href="/dashboard/reports/arn-euin-tracker" linkLabel="ARN &amp; EUIN tracker" note="current">
          <div className="text-sm text-muted-foreground leading-relaxed">
            Expiry dates and renewal reminders for every ARN and EUIN on the firm.
          </div>
        </Tile>
      </Section>
    </div>
  );
}
