import Link from "next/link";
import { sql } from "drizzle-orm";
import { Cake, HeartHandshake, PartyPopper, CalendarCheck, ArrowRight } from "lucide-react";

import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { Avatar } from "@/components/ui/Avatar";
import { formatINR } from "@/lib/utils";
import { EmptySection } from "./EmptySection";

/**
 * Client moments — the next seven days of reasons to contact a client for a
 * GOOD reason rather than an administrative one.
 *
 * Why this exists: the owner cockpit was entirely retrospective — AUM, net
 * sales, persistency, data gaps. Every panel answered "how did the firm do?"
 * and none answered "who should we delight this week?". The RM dashboard has a
 * 30-day touchpoint list (RmInsightsSection, insight 7) but it is scoped to one
 * RM's own book, so a firm owner had no firm-wide view of it at all.
 *
 * Four moment kinds, all from data the firm already holds:
 *   birthday      — investors.dob
 *   anniversary   — investors.anniversary_date
 *   client-since  — investors.onboarded_at (the "you've been with us N years"
 *                   note that MFDs use and almost never remember to send)
 *   review due    — review_meetings.next_review_date
 *
 * Deliberately NOT another chart: it is a worklist, so every card names the
 * client, the day, the owning RM, and links straight to the client where
 * QuickComms can send the message.
 */

type Moment = {
  kind: "birthday" | "anniversary" | "client_since" | "review";
  investor_id: string;
  name: string;
  rm_name: string | null;
  aum: string | null;
  on_date: string;
  years: number | null;
};

const META: Record<
  Moment["kind"],
  { icon: typeof Cake; label: (m: Moment) => string; tone: string }
> = {
  birthday: {
    icon: Cake,
    label: () => "Birthday",
    tone: "text-chart-4",
  },
  anniversary: {
    icon: HeartHandshake,
    label: () => "Anniversary",
    tone: "text-chart-1",
  },
  client_since: {
    icon: PartyPopper,
    // "3 years with you" is the sentence an RM actually wants to send.
    label: (m) => (m.years && m.years > 0 ? `${m.years} ${m.years === 1 ? "year" : "years"} with you` : "Client since"),
    tone: "text-chart-2",
  },
  review: {
    icon: CalendarCheck,
    label: () => "Review due",
    tone: "text-chart-3",
  },
};

function dayLabel(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export async function ClientMomentsStrip({ session }: { session: SessionUser }) {
  const rows = await withTenant(
    session.tenantId,
    async (tx) => {
      /**
       * `nextOccurrence` maps a stored anniversary date onto the coming year so
       * the window works across 31 Dec. The naive `to_char(d,'MM-DD') BETWEEN
       * to_char(now) AND to_char(now + 7 days)` comparison silently returns
       * NOTHING for any window spanning New Year, because '12-28' > '01-04'.
       */
      const nextOccurrence = (col: string) => sql`
        CASE
          WHEN to_date(to_char(current_date, 'YYYY') || to_char(${sql.raw(col)}, 'MMDD'), 'YYYYMMDD') >= current_date
            THEN to_date(to_char(current_date, 'YYYY') || to_char(${sql.raw(col)}, 'MMDD'), 'YYYYMMDD')
          ELSE to_date(to_char(current_date + interval '1 year', 'YYYY') || to_char(${sql.raw(col)}, 'MMDD'), 'YYYYMMDD')
        END`;

      const res = await tx.execute(sql`
        WITH live AS (
          SELECT i.id, i.name, i.dob, i.anniversary_date, i.onboarded_at, i.aum, i.rm_id
            FROM investors i
           WHERE i.deleted_at IS NULL
             AND i.status = 'active'
             AND i.merged_into_id IS NULL
        )
        SELECT * FROM (
          SELECT 'birthday' AS kind, l.id AS investor_id, l.name,
                 u.name AS rm_name, l.aum::text AS aum,
                 ${nextOccurrence("l.dob")} AS on_date,
                 NULL::int AS years
            FROM live l LEFT JOIN users u ON u.id = l.rm_id
           WHERE l.dob IS NOT NULL

          UNION ALL
          SELECT 'anniversary', l.id, l.name, u.name, l.aum::text,
                 ${nextOccurrence("l.anniversary_date")},
                 NULL::int
            FROM live l LEFT JOIN users u ON u.id = l.rm_id
           WHERE l.anniversary_date IS NOT NULL

          UNION ALL
          SELECT 'client_since', l.id, l.name, u.name, l.aum::text,
                 ${nextOccurrence("l.onboarded_at")},
                 EXTRACT(YEAR FROM age(current_date, l.onboarded_at::date))::int + 1
            FROM live l LEFT JOIN users u ON u.id = l.rm_id
           WHERE l.onboarded_at IS NOT NULL
             -- a client onboarded this year has no anniversary to celebrate yet
             AND l.onboarded_at::date <= current_date - interval '11 months'

          UNION ALL
          SELECT 'review', l.id, l.name, u.name, l.aum::text,
                 rm.next_review_date::date,
                 NULL::int
            FROM review_meetings rm
            JOIN live l ON l.id = rm.investor_id
            LEFT JOIN users u ON u.id = l.rm_id
           WHERE rm.next_review_date IS NOT NULL
        ) m
        WHERE m.on_date BETWEEN current_date AND current_date + interval '7 days'
        ORDER BY m.on_date, m.name
        LIMIT 12
      `);
      return res.rows as unknown as Moment[];
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  if (!rows.length) {
    return (
      <EmptySection
        icon={Cake}
        title="Client moments"
        note="No birthdays, anniversaries or reviews in the next 7 days."
        href="/dashboard/calendar"
        linkLabel="Calendar"
      />
    );
  }

  return (
    <div className="card-surface p-4">
      <Header count={rows.length} />
      <div className="flex gap-3 overflow-x-auto pb-1 mt-3">
        {rows.map((m, i) => {
          const meta = META[m.kind];
          const Icon = meta.icon;
          const aum = m.aum ? Number(m.aum) : 0;
          return (
            <Link
              key={`${m.kind}-${m.investor_id}-${i}`}
              href={`/dashboard/investors/${m.investor_id}`}
              className="group min-w-[220px] rounded-lg border border-border p-3 hover:border-foreground/20 hover:bg-secondary/50 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide ${meta.tone}`}>
                  <Icon className="size-3.5" /> {meta.label(m)}
                </span>
                <span className="text-2xs text-muted-foreground whitespace-nowrap">{dayLabel(m.on_date)}</span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Avatar name={m.name} size={26} />
                <span className="text-sm font-medium truncate">{m.name}</span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-1.5 text-2xs text-muted-foreground">
                <span className="truncate">{m.rm_name ? `RM ${m.rm_name}` : "No RM assigned"}</span>
                {aum > 0 && <span className="tabular-nums whitespace-nowrap">{formatINR(aum)}</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Header({ count }: { count: number }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2">
        <span className="section-title">Client moments &mdash; next 7 days</span>
        {count > 0 && <span className="chip bg-secondary text-muted-foreground text-2xs">{count}</span>}
      </div>
      <Link
        href="/dashboard/calendar"
        className="text-2xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        Calendar <ArrowRight className="size-3" />
      </Link>
    </div>
  );
}
