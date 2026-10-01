/**
 * §7 Meeting management and §8 meeting preparation.
 *
 * The prep card is relationship preparation, not a sales script (§8): the
 * book, the last conversation, what is open, what is due. It never suggests a
 * product. The meeting page's own prep pack is one click away for the rest.
 */

import Link from "next/link";
import { CalendarDays, ClipboardList } from "lucide-react";
import type { MeetingDesk } from "@/lib/dashboard/my/pipeline";
import { humanStatus, timeIST, type MeetingPrep } from "@/lib/dashboard/my/desk";
import { CategoryTag, Figure, Section, SectionLink, Stat, StatGrid, Table, Unavailable } from "@/components/dashboards/my/Shared";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DeskMeetings({
  desk, prep, periodLabel, staffIds, target, today,
}: {
  desk: MeetingDesk;
  prep: MeetingPrep[];
  periodLabel: string;
  staffIds: string;
  /** The month's share of the annual meetings target, and what is done so far. */
  target: { target: number | null; actual: number; missing: string | null };
  /** yyyy-mm-dd, local — never a UTC slice. */
  today: string;
}) {
  const never = desk.total == null;
  return (
    <Section
      title="Meeting management"
      subtitle={`Today, this week and ${periodLabel} — and a preparation card for each coming client meeting.`}
      icon={<CalendarDays className="size-4" />}
      action={<SectionLink href={`/dashboard/review-meetings?rm=${staffIds}`}>All my meetings</SectionLink>}
    >
      {never ? (
        <Unavailable>
          No meeting has ever been logged against you, so there is nothing to count or prepare. Meetings booked
          in the CRM appear here with a preparation card each.
        </Unavailable>
      ) : (
        <StatGrid cols={6}>
          <Stat label="Meetings today" value={desk.today} href={`/dashboard/review-meetings?rm=${staffIds}&status=scheduled`} />
          <Stat label="This week" value={desk.thisWeek} hint="next 7 days" />
          <Stat label="New meetings" value={desk.newMeetings} hint={periodLabel} />
          <Stat label="Review meetings" value={desk.reviewMeetings} hint={periodLabel} />
          <Stat
            label="Meeting target"
            display={target.target == null
              ? <span className="text-muted-foreground" title={target.missing ?? "No target set."}>—</span>
              : <>{target.actual}<span className="text-sm font-normal text-muted-foreground"> / {Math.round(target.target * 10) / 10}</span></>}
            hint={target.target == null ? target.missing ?? "no target set" : "held this month / month's target"}
          />
          <Stat label="Follow-up pending" value={desk.followUpsPending}
                tone={(desk.followUpsPending ?? 0) > 0 ? "warn" : "neutral"} hint="met, nothing booked after" />
        </StatGrid>
      )}

      <h3 className="mb-2 mt-5 text-2xs font-semibold text-muted-foreground">Upcoming meetings</h3>
      <Table
        rows={desk.upcoming.length}
        empty="Nothing in the diary."
        head={
          <>
            <th scope="col">Client</th>
            <th scope="col">Category</th>
            <th scope="col">Type</th>
            <th scope="col">Date</th>
            <th scope="col">Time</th>
            <th scope="col">Purpose</th>
            <th scope="col">Last meeting</th>
            <th scope="col">Preparation</th>
            <th scope="col" className="text-right">Client 360</th>
          </>
        }
      >
        {desk.upcoming.map((m) => (
          <tr key={m.id}>
            <td className="py-2.5">
              <Link href={m.href} className="font-medium hover:text-primary hover:underline">{m.client}</Link>
            </td>
            <td className="py-2.5">{m.clientId ? <CategoryTag value={m.category} /> : <span className="text-2xs text-muted-foreground">Lead</span>}</td>
            <td className="py-2.5 text-xs">{m.meetingCategory === "review" ? "Review" : humanStatus(m.type)}</td>
            <td className="whitespace-nowrap py-2.5 text-xs">{formatDate(m.when)}</td>
            <td className="whitespace-nowrap py-2.5 text-xs tabular-nums">{timeIST(m.when)}</td>
            <td className="max-w-xs truncate py-2.5 text-xs" title={m.purpose ?? undefined}>
              {m.purpose ?? <span className="text-muted-foreground">Not set</span>}
            </td>
            <td className="whitespace-nowrap py-2.5 text-xs">
              {m.lastMeeting ? formatDate(m.lastMeeting) : <span className="text-muted-foreground">None recorded</span>}
            </td>
            <td className="py-2.5">
              {m.prepared
                ? <span className="chip bg-success/10 text-success">Agenda set</span>
                : <span className="chip bg-warning/10 text-warning-foreground">No agenda</span>}
            </td>
            <td className="py-2.5 text-right">
              {m.clientId
                ? <Link href={`/dashboard/investors/${m.clientId}`} className="inline-flex min-h-6 items-center text-xs font-medium text-primary hover:underline">Open</Link>
                : <span className="text-2xs text-muted-foreground">—</span>}
            </td>
          </tr>
        ))}
      </Table>

      {prep.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 flex items-center gap-1.5 text-2xs font-semibold text-muted-foreground">
            <ClipboardList className="size-3.5" aria-hidden /> Preparation — next {prep.length} client meeting{prep.length === 1 ? "" : "s"}
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {prep.map((p) => <PrepCard key={p.meetingId} p={p} today={today} />)}
          </div>
        </>
      )}
    </Section>
  );
}

function PrepCard({ p, today }: { p: MeetingPrep; today: string }) {
  const reviewLate = p.nextReview != null && p.nextReview.slice(0, 10) < today;
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/dashboard/investors/${p.clientId}`} className="font-semibold text-foreground hover:text-primary hover:underline">
            {p.client}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
            <CategoryTag value={p.category} />
            {p.family && <span>{p.family}</span>}
          </div>
        </div>
        <div className="text-right text-2xs text-muted-foreground">
          <div className="font-medium text-foreground">{formatDate(p.when)} · {timeIST(p.when)}</div>
          <div>{p.type}{p.purpose ? ` — ${p.purpose}` : ""}</div>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-2xs sm:grid-cols-3">
        <div><dt className="text-muted-foreground">AUM</dt><dd className="font-medium tabular-nums"><Figure value={p.aum} /></dd></div>
        <div><dt className="text-muted-foreground">SIP book</dt><dd className="font-medium tabular-nums">{p.sipBook > 0 ? `${formatMoney(p.sipBook)}/mo` : "No active SIP"}</dd></div>
        <div><dt className="text-muted-foreground">Last meeting</dt><dd className="font-medium">{p.lastMeeting ? formatDate(p.lastMeeting) : "None recorded"}</dd></div>
        <div><dt className="text-muted-foreground">Open tasks</dt><dd className={cn("font-medium tabular-nums", p.openTasks > 0 && "text-warning-foreground")}>{p.openTasks}</dd></div>
        <div><dt className="text-muted-foreground">Open service requests</dt><dd className={cn("font-medium tabular-nums", p.openQueries > 0 && "text-warning-foreground")}>{p.openQueries}</dd></div>
        <div><dt className="text-muted-foreground">Review due</dt><dd className={cn("font-medium", reviewLate && "text-destructive")}>{p.nextReview ? formatDate(p.nextReview) : "Not scheduled"}</dd></div>
        <div>
          <dt className="text-muted-foreground">Risk profile</dt>
          <dd className={cn("font-medium", p.risk === "Not completed" && "text-warning-foreground")}>
            {p.risk}{p.risk !== "Not completed" && p.riskSigned ? ` · ${formatDate(p.riskSigned)}` : ""}
          </dd>
        </div>
        <div><dt className="text-muted-foreground">Insurance renewal</dt><dd className="font-medium">{p.renewalDue ? formatDate(p.renewalDue) : "None on record"}</dd></div>
        <div>
          <dt className="text-muted-foreground">Pending proposal</dt>
          <dd className="font-medium">{p.pendingProposals > 0 ? `${p.pendingProposals} · ${formatMoney(p.pendingProposalValue)}` : "None"}</dd>
        </div>
      </dl>

      <div className="mt-3 border-t border-border/60 pt-2 text-2xs">
        <div className="text-muted-foreground">Recent transactions</div>
        {p.recent.length === 0 ? (
          <div className="text-muted-foreground">None recorded.</div>
        ) : (
          <ul className="mt-0.5 space-y-0.5">
            {p.recent.map((t, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="truncate">{formatDate(t.date)} · {humanStatus(t.type)}{t.scheme ? ` · ${t.scheme}` : ""}</span>
                <span className="shrink-0 font-medium tabular-nums">{formatMoney(t.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 text-muted-foreground">Previous meeting notes</div>
        <p className="line-clamp-3 text-foreground">{p.lastNotes ?? <span className="text-muted-foreground">No notes recorded.</span>}</p>
      </div>
      <div className="mt-2 flex flex-wrap gap-3">
        <SectionLink href={`/dashboard/review-meetings/${p.meetingId}`}>Open meeting &amp; prep pack</SectionLink>
        <SectionLink href={`/dashboard/investors/${p.clientId}`}>Client 360</SectionLink>
      </div>
    </article>
  );
}
