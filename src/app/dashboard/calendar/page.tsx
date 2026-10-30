import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { Calendar } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { InteractiveCalendar } from "@/components/calendar/InteractiveCalendar";
import { getCalendarItems } from "@/lib/calendar/items";
import crypto from "node:crypto";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; view?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const now = new Date();
  const month = sp.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [yyyy, mm] = month.split("-").map(Number);

  const monthStart = new Date(yyyy, mm - 1, 1);
  // Build the ISO bounds directly (no toISOString, which would shift the day in
  // a non-UTC server timezone).
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(yyyy, mm, 0).getDate();
  const monthStartIso = `${yyyy}-${pad(mm)}-01`;
  const monthEndIso = `${yyyy}-${pad(mm)}-${pad(lastDay)}`;
  // ?view=week (the top bar's "This week") opens the week view. A week can
  // cross into the next or previous month, so it loads six days either side.
  const view: "week" | "month" = sp.view === "week" ? "week" : "month";
  const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromIso = view === "week" ? isoOf(new Date(yyyy, mm - 1, 1 - 6)) : monthStartIso;
  const toIso = view === "week" ? isoOf(new Date(yyyy, mm - 1, lastDay + 6)) : monthEndIso;

  // Scope to the viewer's book (managers see the whole firm). RLS only isolates
  // by tenant — without this, every RM's calendar showed the entire firm.
  const items = await withTenant(session.tenantId, async (tx) =>
    getCalendarItems(tx, {
      fromIso,
      toIso,
      scope: {
        userId: session.userId,
        tasksAll: can(session.roles, "task.view.all", session.permissions),
        leadsAll: can(session.roles, "lead.view.all", session.permissions),
        investorsAll: can(session.roles, "investor.view.all", session.permissions),
        session,
      },
    })
  );

  const prevMonth = new Date(yyyy, mm - 2, 1);
  const nextMonth = new Date(yyyy, mm, 1);
  const monthLabel = formatDate(monthStart, "monthYear");
  const monthHref = (d: Date) =>
    `/dashboard/calendar?month=${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}${view === "week" ? "&view=week" : ""}`;

  // iCal subscription link — signed per user. Fail closed: if no signing secret
  // is configured, hand out NO link rather than one keyed on a public default.
  const secret = process.env.NEXTAUTH_SECRET;
  const icalSubscriptionUrl = secret
    ? `${process.env.APP_URL ?? "http://localhost:3000"}/api/calendar/feed?userId=${session.userId}&token=${crypto
      .createHmac("sha256", secret)
      .update(session.userId)
      .digest("hex")}`
    : null;

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard title={<><Calendar className="size-6 text-muted-foreground" /> Calendar</>} actions={<><div className="flex items-center gap-2">
          <Link
            href={monthHref(prevMonth)}
            className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent"
          >
            ← {prevMonth.toLocaleDateString("en-IN", { month: "short" })}
          </Link>
          <div className="text-sm font-medium min-w-[140px] text-center">{monthLabel}</div>
          <Link
            href={monthHref(nextMonth)}
            className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent"
          >
            {nextMonth.toLocaleDateString("en-IN", { month: "short" })} →
          </Link>
        </div></>} />

      <InteractiveCalendar
        key={`${month}-${view}`}
        initialItems={items}
        yyyy={yyyy}
        mm={mm}
        monthLabel={monthLabel}
        initialView={view}
        icalSubscriptionUrl={icalSubscriptionUrl}
      />
    </div>
  );
}
