/**
 * §8 Client review management.
 *
 * ── Why the ordering matters more than the numbers ──────────────────────────
 *
 * The queue is sorted by how far overdue a review is, with category breaking
 * ties — A before B before C before D "when review dates are equally overdue",
 * in the brief's words — and size last. Category is deliberately NOT first:
 * that let a C client three days late outrank an A client a hundred days late.
 *
 * "Never reviewed" is its own figure, not part of "overdue". A client with no
 * review date has not missed one — nobody ever set one. Folding the two
 * together hides a scheduling gap inside a service failure, and they need
 * different fixes.
 */

import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import type { ReviewDesk } from "@/lib/dashboard/my/clients";
import { CategoryTag, Num, Section, SectionLink, Stat, StatGrid, Table } from "./Shared";
import { formatDate, formatMoney } from "@/lib/format";

export function MyReviewDesk({ data }: { data: ReviewDesk }) {
  return (
    <Section
      title="Client reviews"
      subtitle="Who is owed a review, worst first — and A/B clients ahead of the rest when they are equally late."
      icon={<CalendarCheck className="size-4" />}
      action={<SectionLink href="/dashboard/review-meetings/new?category=review">Book a review</SectionLink>}
      note="Clients with no review date are counted as never reviewed, not as overdue — nobody has missed a date that was never set."
    >
      <StatGrid cols={5}>
        <Stat
          label="Completed this month"
          value={data.completedThisMonth}
          tone={(data.completedThisMonth ?? 0) > 0 ? "good" : "neutral"}
          unavailable="No meeting has ever been logged against you, so completed reviews cannot be counted."
        />
        <Stat label="Due this month" value={data.dueThisMonth} tone={data.dueThisMonth > 0 ? "warn" : "neutral"} />
        <Stat label="Due in 30 days" value={data.dueNext30} />
        <Stat
          label="Overdue"
          value={data.overdue}
          tone={data.overdue > 0 ? "bad" : "good"}
          href="/dashboard/investors?mine=1&review=overdue"
        />
        <Stat
          label="Never reviewed"
          value={data.neverReviewed}
          tone={data.neverReviewed > 0 ? "warn" : "neutral"}
          hint="no review on record"
        />
      </StatGrid>

      <div className="mt-4">
        <Table
          rows={data.rows.length}
          empty="No review is due in the next 30 days."
          head={
            <>
              <th scope="col">Client</th>
              <th scope="col">Category</th>
              <th scope="col" className="text-right">AUM</th>
              <th scope="col">Last review</th>
              <th scope="col">Next review</th>
              <th scope="col" className="text-right">Days overdue</th>
              <th scope="col">Action</th>
            </>
          }
        >
          {data.rows.map((r) => {
            const over = r.daysOverdue != null && r.daysOverdue > 0;
            const ab = r.category === "A" || r.category === "B";
            return (
              <tr key={r.id}>
                <td className="py-2.5">
                  <Link href={`/dashboard/investors/${r.id}`} className="font-medium hover:text-primary hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="py-2.5"><CategoryTag value={r.category} /></td>
                <Num>{formatMoney(r.aum)}</Num>
                <td className="py-2.5 text-xs">
                  {r.lastReview ? formatDate(r.lastReview) : (
                    <span className="text-muted-foreground" title="No review has ever been recorded for this client.">Never</span>
                  )}
                </td>
                <td className="py-2.5 text-xs">
                  {r.nextReview ? formatDate(r.nextReview) : (
                    <span className="text-muted-foreground" title="No next review date is set.">Not scheduled</span>
                  )}
                </td>
                <Num tone={over && ab ? "bad" : over ? "warn" : "neutral"}>
                  {over ? r.daysOverdue : <span className="text-muted-foreground">—</span>}
                </Num>
                <td className="py-2.5">
                  <Link
                    href={`/dashboard/review-meetings/new?investorId=${r.id}&category=review`}
                    className="inline-flex min-h-6 items-center text-xs font-medium text-primary hover:underline"
                  >
                    {r.nextReview ? "Book" : "Schedule"}
                  </Link>
                </td>
              </tr>
            );
          })}
        </Table>
      </div>
    </Section>
  );
}
