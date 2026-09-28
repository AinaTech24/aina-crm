/**
 * §5 My client book, §6 category distribution and §7 my key clients.
 *
 * The category table is the part worth defending. The brief says it plainly —
 * "Do not only show the number of clients" — and the reason is that headcount
 * and money rank differently: a book can be 60% C-category by head and 8% by
 * value, and only one of those two facts tells you where to spend Tuesday.
 * So every row carries clients, AUM, SIP book and share of MY AUM, and the
 * bar is drawn on AUM, not on the count.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Users, Star } from "lucide-react";
import type { ClientBook, KeyClient, KeyClientSort } from "@/lib/dashboard/my/clients";
import { CategoryTag, Figure, Num, Section, SectionLink, Stat, StatGrid, Table } from "./Shared";
import { formatDate, formatMoney, formatPercent, pickMoneyScale } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MY_VOICE, type Voice } from "./voice";

export function MyClientBook({ book, voice = MY_VOICE, extra }: {
  book: ClientBook;
  voice?: Voice;
  /** Rendered at the end of the section — the branch view's RM breakdown. */
  extra?: ReactNode;
}) {
  const v = voice;
  // One unit PER COLUMN. AUM and SIP book are each the same measure sliced
  // five ways, so each column shares a scale — but they are not the same
  // measure as each other, and forcing one scale across both printed an ₹8
  // Lakh SIP book as "₹0.08 Cr" next to ₹12.39 Cr of AUM.
  const aumScale = pickMoneyScale(book.categories.map((c) => c.aum));
  const sipScale = pickMoneyScale(book.categories.map((c) => c.sipBook));
  const maxAum = Math.max(1, ...book.categories.map((c) => c.aum));

  // 7 clients in families and 0 heads is not a bug, it is a mapping gap — say
  // so, rather than letting the two figures look like they contradict.
  const headsMissing = book.familyHeads === 0 && book.familyMembers > 0;

  return (
    <Section
      title={v.title("client book")}
      subtitle={v.say(
        "The shape of the book I carry — who is in it, and where the money actually sits.",
        "Who the branch serves, and where the money actually sits.",
      )}
      icon={<Users className="size-4" />}
      action={<SectionLink href={v.clients()}>{v.say("All my clients", "All clients in view")}</SectionLink>}
    >
      <StatGrid cols={4}>
        <Stat label="Total clients" value={book.total} href={v.clients()} />
        <Stat label="Active" value={book.active} tone={book.active > 0 ? "good" : "neutral"} />
        <Stat
          label="Family heads"
          value={book.familyHeads}
          hint={headsMissing ? "no head designated on any family" : undefined}
          tone={headsMissing ? "warn" : "neutral"}
          href="/dashboard/families"
        />
        <Stat label="In a family" value={book.familyMembers} href="/dashboard/families" />
        <Stat label="Individuals" value={book.individuals} hint="not mapped to a family" />
        <Stat label="New this month" value={book.newThisMonth} />
        <Stat label="Added FY to date" value={book.newFytd} />
        <Stat
          label="No category set"
          value={book.uncategorised}
          tone={book.uncategorised > 0 ? "warn" : "good"}
          hint={book.uncategorised > 0 ? "segmentation below is incomplete" : undefined}
          href={v.clients("category=none")}
        />
      </StatGrid>

      <div className="mt-5">
        <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Category distribution &mdash; by money, not only by headcount
        </h3>
        <Table
          rows={book.categories.length}
          empty={v.say("No clients on your book yet.", "No clients are recorded against this branch yet.")}
          head={
            <>
              <th scope="col">Category</th>
              <th scope="col" className="text-right">Clients</th>
              <th scope="col" className="text-right">AUM</th>
              <th scope="col" className="text-right">SIP book</th>
              <th scope="col" className="text-right">{v.say("Share of my book", "Share of AUM")}</th>
              <th scope="col" className="w-32" />
            </>
          }
        >
          {book.categories.map((c) => (
            <tr key={c.key}>
              <td className="py-2.5">
                <Link href={c.href} className="font-medium hover:text-primary hover:underline">
                  {c.label}
                </Link>
              </td>
              <Num>{c.clients}</Num>
              <Num>{formatMoney(c.aum, { scale: aumScale })}</Num>
              <Num>{formatMoney(c.sipBook, { scale: sipScale })}</Num>
              <Num tone={c.share != null && c.share >= 0.3 ? "neutral" : "neutral"}>
                {c.share == null ? (
                  <span className="text-muted-foreground" title="The book holds nothing yet, so there is no share to take.">—</span>
                ) : (
                  formatPercent(c.share * 100, 1)
                )}
              </Num>
              <td className="py-2.5">
                <span className="block h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <span
                    className={cn("block h-full rounded-full", c.key === "?" ? "bg-warning" : "bg-primary/60")}
                    style={{ width: `${(c.aum / maxAum) * 100}%` }}
                  />
                </span>
              </td>
            </tr>
          ))}
        </Table>
      </div>
      {extra}
    </Section>
  );
}

const SORT_LABEL: Record<KeyClientSort, string> = {
  aum: "AUM",
  sip: "SIP",
  interaction: "Longest since contact",
  review: "Review due",
  category: "Category",
};

export function MyKeyClients({
  clients,
  sort,
  baseHref,
  today,
  voice = MY_VOICE,
}: {
  voice?: Voice;
  clients: KeyClient[];
  sort: KeyClientSort;
  /** Current URL with everything except `myclients=` preserved. */
  baseHref: string;
  today: string;
}) {
  const now = new Date(today);
  return (
    <Section
      title={voice.title("key clients")}
      subtitle="The relationships that carry the book, and what each of them is waiting on."
      icon={<Star className="size-4" />}
      action={
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-2xs text-muted-foreground">Sort</span>
          {(Object.keys(SORT_LABEL) as KeyClientSort[]).map((k) => (
            <Link
              key={k}
              href={`${baseHref}myclients=${k}`}
              scroll={false}
              aria-current={k === sort ? "true" : undefined}
              className={cn(
                "inline-flex min-h-6 items-center rounded-md px-2 py-1 text-2xs font-medium transition-colors",
                k === sort ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {SORT_LABEL[k]}
            </Link>
          ))}
        </div>
      }
    >
      <Table
        rows={clients.length}
        empty={voice.say("No clients are assigned to you yet.", "No clients in this view yet.")}
        head={
          <>
            <th scope="col">Client</th>
            <th scope="col">Category</th>
            <th scope="col" className="text-right">AUM</th>
            <th scope="col" className="text-right">SIP</th>
            <th scope="col">Last meeting</th>
            <th scope="col">Next review</th>
            <th scope="col" className="text-right">Open</th>
            <th scope="col">Insurance</th>
            <th scope="col">Last transaction</th>
          </>
        }
      >
        {clients.map((c) => {
          const overdue = c.reviewDaysOver != null && c.reviewDaysOver > 0;
          return (
            <tr key={c.id}>
              <td className="py-2.5">
                <Link href={`/dashboard/investors/${c.id}`} className="font-medium hover:text-primary hover:underline">
                  {c.name}
                </Link>
                {c.family && <span className="ml-1.5 text-2xs text-muted-foreground">{c.family}</span>}
              </td>
              <td className="py-2.5"><CategoryTag value={c.category} /></td>
              <Num>{formatMoney(c.aum)}</Num>
              <Num>{c.sip > 0 ? formatMoney(c.sip) : <span className="text-muted-foreground">—</span>}</Num>
              <td className="py-2.5 text-xs">
                {c.lastMeeting ? formatDate(c.lastMeeting) : <span className="text-muted-foreground" title="No completed meeting recorded.">Not recorded</span>}
              </td>
              <td className="py-2.5 text-xs">
                {c.nextReview ? (
                  <span className={overdue ? "font-medium text-destructive" : undefined}>
                    {formatDate(c.nextReview)}
                    {overdue && <span className="ml-1 text-2xs">({c.reviewDaysOver}d over)</span>}
                  </span>
                ) : (
                  <span className="text-muted-foreground" title="No review date set for this client.">Not scheduled</span>
                )}
              </td>
              <Num tone={c.openQueries + c.pendingTasks > 0 ? "warn" : "neutral"}>
                {c.openQueries + c.pendingTasks === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span title={`${c.openQueries} query / ${c.pendingTasks} task`}>
                    {c.openQueries > 0 && `${c.openQueries}Q`}
                    {c.openQueries > 0 && c.pendingTasks > 0 && " "}
                    {c.pendingTasks > 0 && `${c.pendingTasks}T`}
                  </span>
                )}
              </Num>
              <td className="py-2.5 text-xs">
                {c.insurance === "No record" ? (
                  <span className="text-muted-foreground" title="The CRM holds no policy for this client. That is a record gap, not a statement about their cover.">
                    No record
                  </span>
                ) : (
                  c.insurance
                )}
              </td>
              <td className="py-2.5 text-xs">
                {c.lastTransaction ? formatDate(c.lastTransaction) : <span className="text-muted-foreground">Not recorded</span>}
              </td>
            </tr>
          );
        })}
      </Table>
    </Section>
  );
}
