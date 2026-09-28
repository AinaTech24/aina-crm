/**
 * §9 meetings, §10 lead funnel, §11 proposals.
 *
 * ── Why the funnel narrows ──────────────────────────────────────────────────
 *
 * Each bar counts the leads that REACHED that step or went past it, not the
 * ones sitting in it. A bar chart of current stage does not narrow — a stage
 * nobody is parked in shows as empty even though everyone passed through it —
 * so it cannot answer the only question a funnel is for: where do we lose
 * people?
 *
 * Lost leads are reported beside the funnel rather than inside it. The CRM
 * records where a lead stopped, not every stage it passed, so distributing
 * them back up the steps would be invention.
 */

import Link from "next/link";
import { CalendarDays, Filter, FileText, Video, MapPin, Phone, Building2 } from "lucide-react";
import type { LeadFunnel, MeetingDesk, ProposalDesk } from "@/lib/dashboard/my/pipeline";
import { Figure, Num, Section, SectionLink, Stat, StatGrid, Table, Unavailable } from "./Shared";
import { formatCount, formatDate, formatMoney, formatPercent, humanise, pluralDays } from "@/lib/format";
import { cn } from "@/lib/utils";

const MODE_ICON: Record<string, React.ReactNode> = {
  online: <Video className="size-3" />,
  office: <Building2 className="size-3" />,
  client_place: <MapPin className="size-3" />,
  phone: <Phone className="size-3" />,
};

export function MyMeetings({ desk, periodLabel, staffIds }: {
  desk: MeetingDesk;
  periodLabel: string;
  /** Comma list of the book's people — the meetings list reads `?rm=a,b,c`. */
  staffIds: string;
}) {
  const never = desk.total == null;
  return (
    <Section
      title="My meetings"
      subtitle={`Conversations I ran in ${periodLabel}, and what is in the diary next.`}
      icon={<CalendarDays className="size-4" />}
      action={<SectionLink href={`/dashboard/review-meetings?rm=${staffIds}`}>All my meetings</SectionLink>}
    >
      {never ? (
        <Unavailable>
          No meeting has ever been logged against you, so there is nothing to count. This fills
          in as soon as meetings are scheduled through the CRM rather than only in a calendar.
        </Unavailable>
      ) : (
        <StatGrid cols={6}>
          <Stat label="New meetings" value={desk.newMeetings} />
          <Stat label="Review meetings" value={desk.reviewMeetings} />
          <Stat label="Total" value={desk.total} />
          <Stat label="Completed" value={desk.completed} tone={(desk.completed ?? 0) > 0 ? "good" : "neutral"} />
          <Stat label="Cancelled" value={desk.cancelled} tone={(desk.cancelled ?? 0) > 0 ? "warn" : "neutral"} />
          <Stat
            label="No follow-up raised"
            value={desk.followUpsPending}
            tone={(desk.followUpsPending ?? 0) > 0 ? "warn" : "neutral"}
            hint="met, nothing booked after"
          />
        </StatGrid>
      )}

      {desk.trend.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Meetings completed this financial year
          </h3>
          <div className="flex items-end gap-1.5">
            {desk.trend.map((t) => {
              const max = Math.max(1, ...desk.trend.map((x) => x.completed));
              return (
                <div key={t.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span className="text-2xs tabular-nums text-muted-foreground">{t.completed || ""}</span>
                  <span
                    className="w-full rounded-t bg-primary/50"
                    style={{ height: `${Math.max(3, (t.completed / max) * 48)}px` }}
                  />
                  <span className="text-2xs text-muted-foreground">{t.month}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4">
        <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Coming up
        </h3>
        <Table
          rows={desk.upcoming.length}
          empty="Nothing in the diary."
          head={
            <>
              <th scope="col">Client</th>
              <th scope="col">When</th>
              <th scope="col">Type</th>
              <th scope="col">Where</th>
              <th scope="col">Purpose</th>
              <th scope="col">Prepared</th>
            </>
          }
        >
          {desk.upcoming.map((m) => (
            <tr key={m.id}>
              <td className="py-2.5">
                <Link href={m.href} className="font-medium hover:text-primary hover:underline">{m.client}</Link>
              </td>
              <td className="py-2.5 text-xs">{formatDate(m.when, "dateTime")}</td>
              <td className="py-2.5 text-xs">{humanise(m.type)}</td>
              <td className="py-2.5 text-xs">
                <span className="inline-flex items-center gap-1">
                  {m.mode && MODE_ICON[m.mode]}
                  {m.mode ? humanise(m.mode) : <span className="text-muted-foreground">Not set</span>}
                </span>
              </td>
              <td className="py-2.5 text-xs">{m.purpose ?? <span className="text-muted-foreground">—</span>}</td>
              <td className="py-2.5">
                {m.prepared ? (
                  <span className="chip bg-success/10 text-success">Agenda set</span>
                ) : (
                  <span className="chip bg-warning/10 text-warning-foreground">No agenda</span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </div>
    </Section>
  );
}

/** The narrowing bars themselves — shared with the branch command centre. */
export function FunnelBars({ funnel }: { funnel: LeadFunnel }) {
  const top = funnel.steps[0]?.reached ?? 0;
  return (
    <div className="space-y-1.5">
      {funnel.steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-3">
          <span className="w-36 shrink-0 truncate text-xs text-foreground">{s.label}</span>
          <span className="h-6 flex-1 overflow-hidden rounded-md bg-secondary">
            <span
              className={cn(
                "flex h-full items-center rounded-md px-2 text-2xs font-semibold text-primary-foreground",
                i === funnel.steps.length - 1 ? "bg-success" : "bg-primary/75",
              )}
              // A floor keeps a small count visible; zero draws nothing, so an
              // empty step can never read as a thin one.
              style={{ width: `${s.reached > 0 ? Math.max(4, (s.reached / Math.max(1, top)) * 100) : 0}%` }}
            >
              {s.reached > 0 && formatCount(s.reached)}
            </span>
          </span>
          <span className="w-16 shrink-0 text-right text-2xs tabular-nums text-muted-foreground">
            {s.stepConversion == null ? "—" : formatPercent(s.stepConversion * 100, 0)}
          </span>
          <span className="w-24 shrink-0 text-right text-2xs tabular-nums text-muted-foreground" title="Potential business sitting at this step right now">
            {s.value > 0 ? formatMoney(s.value) : "—"}
          </span>
        </div>
      ))}
      <div className="flex items-center gap-3 pt-1 text-2xs text-muted-foreground">
        <span className="w-36 shrink-0" />
        <span className="flex-1" />
        <span className="w-16 shrink-0 text-right">Step %</span>
        <span className="w-24 shrink-0 text-right">Value here</span>
      </div>
    </div>
  );
}

export function MyFunnel({ funnel }: { funnel: LeadFunnel }) {
  const top = funnel.steps[0]?.reached ?? 0;
  return (
    <Section
      title="My lead funnel"
      subtitle="Where my prospects are, and where they stop."
      icon={<Filter className="size-4" />}
      action={<SectionLink href="/dashboard/leads?mine=1">All my leads</SectionLink>}
      note="Each bar counts leads that reached that step or went past it, so the funnel narrows. Lost leads are shown separately — the CRM records where a lead stopped, not every step it passed through."
    >
      {top === 0 ? (
        <Unavailable>No leads are owned by you, so there is no funnel to draw.</Unavailable>
      ) : (
        <FunnelBars funnel={funnel} />
      )}

      <StatGrid cols={4}>
        <Stat label="Leads owned" value={funnel.total} href="/dashboard/leads?mine=1" />
        <Stat
          label="Onboarded"
          value={funnel.steps[funnel.steps.length - 1]?.reached ?? 0}
          tone="good"
        />
        <Stat label="Lost / not proceeding" value={funnel.lost} tone={funnel.lost > 0 ? "warn" : "neutral"} />
        <Stat
          label={`Stale (${funnel.staleAfterDays}d+)`}
          value={funnel.stale}
          tone={funnel.stale > 0 ? "bad" : "good"}
          hint={funnel.staleValue > 0 ? `${formatMoney(funnel.staleValue)} at risk` : "no untouched leads"}
          href="/dashboard/leads?mine=1"
        />
      </StatGrid>

      {funnel.staleRows.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Untouched longest
          </h3>
          <Table
            rows={funnel.staleRows.length}
            empty="Nothing stale."
            head={
              <>
                <th scope="col">Lead</th>
                <th scope="col">Stage</th>
                <th scope="col" className="text-right">Silent for</th>
                <th scope="col" className="text-right">Potential</th>
              </>
            }
          >
            {funnel.staleRows.map((r) => (
              <tr key={r.id}>
                <td className="py-2.5">
                  <Link href={`/dashboard/leads/${r.id}`} className="font-medium hover:text-primary hover:underline">{r.name}</Link>
                </td>
                <td className="py-2.5 text-xs">{humanise(r.stage)}</td>
                <Num tone="warn">{pluralDays(r.days)}</Num>
                <Num>{r.value > 0 ? formatMoney(r.value) : <span className="text-muted-foreground">Not recorded</span>}</Num>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Section>
  );
}

export function MyProposals({ desk, periodLabel }: { desk: ProposalDesk; periodLabel: string }) {
  return (
    <Section
      title="My proposals"
      subtitle={`Written in ${periodLabel}, and what is still waiting on a client.`}
      icon={<FileText className="size-4" />}
      action={<SectionLink href="/dashboard/proposals?mine=1">All proposals</SectionLink>}
      note="Conversion is measured against proposals that have been DECIDED — accepted or rejected. Counting undecided ones as losses would make a healthy pipeline look like a bad month."
    >
      {desk.created == null ? (
        <Unavailable>You have not created a proposal yet, so there is nothing to track here.</Unavailable>
      ) : (
        <>
          <StatGrid cols={6}>
            <Stat label="Created" value={desk.created} />
            <Stat label="Value proposed" value={desk.amount} format="currency" />
            <Stat label="Shared" value={desk.shared} />
            <Stat
              label="Awaiting reply"
              value={desk.followUpPending}
              tone={desk.followUpPending > 0 ? "warn" : "neutral"}
            />
            <Stat label="Converted" value={desk.converted} tone={desk.converted > 0 ? "good" : "neutral"} />
            <Stat
              label="Conversion"
              display={
                desk.conversionPct == null ? (
                  <span className="text-muted-foreground" title="Nothing has been decided yet — no proposal accepted or rejected.">—</span>
                ) : (
                  formatPercent(desk.conversionPct * 100, 0)
                )
              }
              hint="of decided proposals"
            />
          </StatGrid>

          <div className="mt-4">
            <Table
              rows={desk.rows.length}
              empty="No proposals beyond draft."
              head={
                <>
                  <th scope="col">Client</th>
                  <th scope="col">Date</th>
                  <th scope="col">Product</th>
                  <th scope="col" className="text-right">Proposed</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">Days pending</th>
                  <th scope="col">Valid until</th>
                </>
              }
            >
              {desk.rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2.5">
                    <Link href={`/dashboard/proposals/${r.id}`} className="font-medium hover:text-primary hover:underline">{r.client}</Link>
                  </td>
                  <td className="py-2.5 text-xs">{r.date ? formatDate(r.date) : "—"}</td>
                  <td className="py-2.5 text-xs">{humanise(r.product)}</td>
                  <Num>{formatMoney(r.amount)}</Num>
                  <td className="py-2.5">
                    <span
                      className={cn(
                        "chip",
                        ["accepted", "executed", "partially_approved"].includes(r.status) ? "bg-success/10 text-success"
                        : ["rejected", "expired"].includes(r.status) ? "bg-destructive/10 text-destructive"
                        : "bg-warning/10 text-warning-foreground",
                      )}
                    >
                      {humanise(r.status)}
                    </span>
                  </td>
                  <Num tone={r.daysPending != null && r.daysPending > 7 ? "bad" : "neutral"}>
                    {r.daysPending == null ? <span className="text-muted-foreground">—</span> : `${r.daysPending}d`}
                  </Num>
                  <td className="py-2.5 text-xs">
                    {r.nextFollowUp ? formatDate(r.nextFollowUp) : <span className="text-muted-foreground">Not set</span>}
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </Section>
  );
}
