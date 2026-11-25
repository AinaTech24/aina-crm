import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { attendeeIsAnyUser } from "@/lib/review-meetings/attendees";
import { meetingScopeSql } from "@/lib/review-meetings/scope";
import { dataWallApplies } from "@/lib/investors/access";
import { Calendar, CheckCircle2, Clock, AlertTriangle, FileUp } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
import { can } from "@/lib/auth/rbac";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { Avatar } from "@/components/ui/Avatar";
import { dateRangeCond } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { ColumnManager } from "@/components/common/ColumnManager";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { ExportButton } from "@/components/export/ExportButton";
import { AddMeetingButton } from "@/components/review-meetings/AddMeetingButton";
import { MeetingsBulkTable } from "@/components/review-meetings/MeetingsBulkTable";
import { MeetingsKanban } from "@/components/review-meetings/MeetingsKanban";
import { LayoutList, KanbanSquare } from "lucide-react";
import { loadTenantLicense } from "@/lib/auth/license";
import { isFieldAllowed } from "@/lib/auth/field-gate";
import { readColumnPrefs } from "@/lib/list-columns/server";
import { EXTRA_PREFIX, orderKeys } from "@/lib/list-columns/prefs";
import { allowedMeetingExtraKeys, loadMeetingExtra, meetingExtraOptions } from "@/lib/list-columns/meeting-fields";

type MeetingRow = Parameters<typeof MeetingsKanban>[0]["meetings"][number];

const MEETINGS_COLUMNS = [
  { key: "date", label: "Date", required: true },
  { key: "client", label: "Client", required: true },
  { key: "category", label: "Category" },
  { key: "agenda", label: "Agenda / type" },
  { key: "mode", label: "Mode" },
  { key: "rm", label: "RM" },
  { key: "status", label: "Status" },
  // Drawn by the Past meetings list only.
  { key: "actions", label: "Action items" },
  { key: "attach", label: "Attachments" },
  { key: "notes", label: "Notes" },
];

export const dynamic = "force-dynamic";

/** Rows per page — the Upcoming and Past lists each page on their own (`upage`, `ppage`). */
const MEETINGS_PAGE_SIZE = 25;

const TYPE_LABEL: Record<string, string> = {
  portfolio_review: "Portfolio Review",
  goal_review: "Goal Review",
  new_investment_discussion: "New Investment",
  service_discussion: "Service Discussion",
  family_review: "Family Review",
  complaint_discussion: "Complaint Discussion",
  discovery_call: "Discovery Call",
  new_client_kickoff: "Client Kickoff",
  product_demo: "Product Demo",
  sales_pitch: "Sales Pitch",
  follow_up_call: "Follow-up Call",
  follow_up_visit: "Follow-up Visit",
  other: "Other",
};

const MODE_LABEL: Record<string, string> = {
  office: "Office",
  client_place: "Client Place",
  online: "Online",
  phone: "Phone",
};

const STATUS_TONE: Record<string, string> = {
  scheduled: "bg-blue-50 text-blue-700",
  confirmed: "bg-cyan-50 text-cyan-700",
  in_progress: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  rescheduled: "bg-secondary text-foreground",
  cancelled: "bg-secondary text-foreground",
  no_show: "bg-rose-50 text-rose-700",
};

export default async function ReviewMeetingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  // The person's saved column order and the fields they added (More fields in the column menu).
  const colPrefs = await readColumnPrefs("meetings-upcoming");
  const license = await loadTenantLicense(session.tenantId, session.roles);
  const extraOptions = meetingExtraOptions((f) => isFieldAllowed(license, "investor", f));
  const extraAllowed = allowedMeetingExtraKeys(extraOptions);
  const extraKeys = colPrefs.extra.filter((k) => extraAllowed.has(k));
  const q = (sp.q ?? "").trim();
  const categoryFilter = (sp.category ?? "").split(",").filter(Boolean);
  const statusFilter = (sp.status ?? "").split(",").filter(Boolean);
  const modeFilter = (sp.mode ?? "").split(",").filter(Boolean);
  const typeFilter = (sp.type ?? "").split(",").filter(Boolean);
  const rmFilter = (sp.rm ?? "").split(",").filter(Boolean);
  // Sort the (past) list by meeting date — newest or oldest first. The upcoming
  // list always leads with the soonest meeting, so this drives the past list.
  const sortKey = sp.sort === "meeting_asc" ? "meeting_asc" : "meeting_desc";
  const view = sp.view === "kanban" ? "kanban" : "table";
  // Preserve the active filters when toggling Table ⇄ Kanban.
  const viewParams = new URLSearchParams(
    Object.entries(sp).filter(([, v]) => typeof v === "string" && v) as [string, string][]
  );
  const viewHref = (v: string) => {
    const p = new URLSearchParams(viewParams);
    p.set("view", v);
    return `?${p.toString()}`;
  };

  const data = await withTenant(session.tenantId, async (tx) => {
    // Under the data wall: own + attended meetings; with manage.all, also
    // those whose client / lead the viewer may see (lib/review-meetings/scope.ts)
    // — same rule as the API. Without it the page lists every meeting, as before.
    const scope = (await dataWallApplies(tx, session)) ? await meetingScopeSql(tx, session, "m") : sql`TRUE`;
    const filters: any[] = [sql`m.tenant_id = ${session.tenantId}::uuid`, scope];
    if (q) {
      filters.push(
        sql`(i.name ILIKE ${`%${q}%`} OR l.name ILIKE ${`%${q}%`} OR u.name ILIKE ${`%${q}%`} OR m.discussion_points ILIKE ${`%${q}%`} OR m.meeting_notes ILIKE ${`%${q}%`})`
      );
    }
    if (categoryFilter.length) {
      filters.push(
        sql`m.category IN (${sql.join(categoryFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (statusFilter.length) {
      filters.push(
        sql`m.status IN (${sql.join(statusFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (modeFilter.length) {
      filters.push(
        sql`m.meeting_mode IN (${sql.join(modeFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (typeFilter.length) {
      filters.push(
        sql`m.meeting_type IN (${sql.join(typeFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (rmFilter.length) {
      // A person's meetings are the ones they own AND the ones they attend.
      filters.push(
        sql`(m.rm_id IN (${sql.join(rmFilter.map((v) => sql`${v}::uuid`), sql`, `)}) OR ${attendeeIsAnyUser(rmFilter)})`
      );
    }
    const dr = dateRangeCond(sp, "meeting", "m.meeting_date");
    if (dr) filters.push(dr);
    const whereSql = filters.length ? sql` WHERE ${sql.join(filters, sql` AND `)}` : sql``;

    const cols = sql`
      m.id, m.investor_id, m.lead_id, m.rm_id,
             m.category, m.parent_meeting_id,
             m.meeting_type, m.subject, m.meeting_date,
             m.duration_minutes, m.meeting_mode, m.location_or_link, m.status,
             m.discussion_points, m.meeting_notes, m.next_review_date,
             m.follow_up_task_created,
             jsonb_array_length(COALESCE(m.action_items, '[]'::jsonb)) AS action_count,
             jsonb_array_length(COALESCE(m.attachments, '[]'::jsonb)) AS attach_count,
             m.created_at,
             -- A meeting is tied to EITHER an investor or a lead (pre-conversion).
             -- Surface whichever name exists so the Client column is never blank.
             COALESCE(i.name, l.name) AS party_name,
             COALESCE(i.avatar_url, l.avatar_url) AS party_avatar_url,
             CASE WHEN i.id IS NOT NULL THEN 'investor'
                  WHEN l.id IS NOT NULL THEN 'lead' END AS party_kind,
             i.pan AS investor_pan, i.segment_tag,
             u.name AS rm_name`;
    const joins = sql`
      FROM review_meetings m
      LEFT JOIN investors i ON i.id = m.investor_id
      LEFT JOIN leads l ON l.id = m.lead_id
      LEFT JOIN users u ON u.id = m.rm_id`;
    // Upcoming = still to happen; everything else is Past. Split in SQL so each list
    // can be counted and paged on its own.
    const isUpcoming = sql`(m.status IN ('scheduled','confirmed') AND m.meeting_date >= now())`;
    const pastOrder = sortKey === "meeting_asc" ? sql`m.meeting_date ASC, m.id` : sql`m.meeting_date DESC, m.id`;

    const counts = (
      await tx.execute(sql`
        SELECT COUNT(*) FILTER (WHERE ${isUpcoming})::int AS upcoming,
               COUNT(*) FILTER (WHERE NOT ${isUpcoming})::int AS past
        ${joins} ${whereSql}
      `)
    ).rows[0] as { upcoming?: number; past?: number } | undefined;
    const upcomingTotal = Number(counts?.upcoming ?? 0);
    const pastTotal = Number(counts?.past ?? 0);
    const upcomingPages = Math.max(1, Math.ceil(upcomingTotal / MEETINGS_PAGE_SIZE));
    const pastPages = Math.max(1, Math.ceil(pastTotal / MEETINGS_PAGE_SIZE));
    const upcomingPage = Math.min(Math.max(1, Math.floor(Number(sp.upage)) || 1), upcomingPages);
    const pastPage = Math.min(Math.max(1, Math.floor(Number(sp.ppage)) || 1), pastPages);

    // Kanban draws every meeting on one board (capped), the table draws one page of each list.
    const kanbanRows =
      view === "kanban"
        ? (await tx.execute(sql`SELECT ${cols} ${joins} ${whereSql} ORDER BY ${pastOrder} LIMIT 200`)).rows
        : [];
    const upcomingRows =
      view === "kanban"
        ? []
        : (
            await tx.execute(sql`
              SELECT ${cols} ${joins} ${whereSql} AND ${isUpcoming}
              ORDER BY m.meeting_date ASC, m.id
              LIMIT ${MEETINGS_PAGE_SIZE} OFFSET ${(upcomingPage - 1) * MEETINGS_PAGE_SIZE}
            `)
          ).rows;
    const pastRows =
      view === "kanban"
        ? []
        : (
            await tx.execute(sql`
              SELECT ${cols} ${joins} ${whereSql} AND NOT ${isUpcoming}
              ORDER BY ${pastOrder}
              LIMIT ${MEETINGS_PAGE_SIZE} OFFSET ${(pastPage - 1) * MEETINGS_PAGE_SIZE}
            `)
          ).rows;
    // Today's agenda: meetings still on for today (India date), under the same filters.
    const todayRows = (
      await tx.execute(sql`
        SELECT ${cols} ${joins} ${whereSql}
          AND m.status IN ('scheduled','confirmed','in_progress')
          AND (m.meeting_date AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
        ORDER BY m.meeting_date ASC
      `)
    ).rows;

    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('scheduled','confirmed')
          AND meeting_date >= now())::int AS upcoming,
        COUNT(*) FILTER (WHERE status IN ('scheduled','confirmed')
          AND meeting_date >= date_trunc('week', now())
          AND meeting_date < date_trunc('week', now()) + interval '7 days')::int AS this_week,
        COUNT(*) FILTER (WHERE status = 'completed'
          AND meeting_date >= date_trunc('month', now()))::int AS completed_mtd,
        COUNT(*) FILTER (WHERE status IN ('scheduled','confirmed','in_progress')
          AND meeting_date < now())::int AS overdue
      FROM review_meetings m
      WHERE m.tenant_id = ${session.tenantId}::uuid AND ${scope}
    `);
    const s = stats.rows[0] as any;
    // RM roster for the "RM" filter dropdown (so the MFD can see meetings by RM).
    const rmRows = await tx.execute(sql`
      SELECT id, name FROM users
      WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
      ORDER BY name ASC
    `);
    // Values of the fields this person added, for the meetings on this page only.
    const extraValues =
      view === "kanban"
        ? {}
        : await loadMeetingExtra(tx, [...upcomingRows, ...pastRows].map((r) => String((r as { id: unknown }).id)), extraKeys, extraAllowed);
    return {
      kanban: kanbanRows as unknown as MeetingRow[],
      upcoming: upcomingRows as unknown as MeetingRow[],
      past: pastRows as unknown as MeetingRow[],
      todays: todayRows as unknown as MeetingRow[],
      upcomingTotal, pastTotal, upcomingPage, pastPage,
      stats: s, rms: rmRows.rows as Array<Record<string, any>>, extraValues,
    };
  });

  const rmOptions = (data.rms ?? []).map((r: any) => ({ value: String(r.id), label: r.name ?? "—" }));

  const upcoming = data.upcoming;
  const past = data.past;
  const todays = data.todays;

  // The columns in the person's order: the ones the tables draw, then the fields
  // they added. The date stays first (the cancel / delete slot stays last).
  const colOrder = orderKeys(
    [...MEETINGS_COLUMNS.map((c) => c.key), ...extraKeys.map((k) => EXTRA_PREFIX + k)],
    colPrefs.order,
    ["date"],
    [],
  );
  const extraCols = extraKeys.map((k) => ({ key: k, label: extraOptions.find((o) => o.key === k)?.label ?? k }));
  const withExtra = (r: any) => ({ ...r, extra: data.extraValues[String(r.id)] ?? {} });

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard title={<><Calendar className="size-6 text-muted-foreground" /> Meetings</>} actions={<><div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs">
            <Link
              href={viewHref("table")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 ${view === "table" ? "bg-brand-cyan text-white" : "bg-card text-muted-foreground hover:bg-secondary"}`}
            >
              <LayoutList className="size-3.5" /> Table
            </Link>
            <Link
              href={viewHref("kanban")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 border-l border-border ${view === "kanban" ? "bg-brand-cyan text-white" : "bg-card text-muted-foreground hover:bg-secondary"}`}
            >
              <KanbanSquare className="size-3.5" /> Kanban
            </Link>
          </div>
          <ExportButton module="meetings" />
          {can(session.roles, "review_meeting.manage.all", session.permissions) && (
            <Link href="/dashboard/review-meetings/import" className={buttonClass("secondary")}>
              <FileUp className="size-4" /> Import
            </Link>
          )}
          <AddMeetingButton />
        </div></>} />

      {todays.length > 0 && (
        <div className="card-surface p-4">
          <div className="flex items-center gap-2 mb-3 font-semibold text-sm">
            <Calendar className="size-4 text-muted-foreground" /> Today&apos;s agenda
            <span className="chip bg-secondary text-muted-foreground text-2xs">{todays.length}</span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {todays.map((m) => (
              <Link
                key={m.id}
                href={`/dashboard/review-meetings/${m.id}`}
                className="min-w-[210px] rounded-lg border border-border p-3 hover:border-foreground/20 hover:bg-secondary/50 transition-colors"
              >
                <div className="text-lg font-bold tabular-nums">
                  {new Date(m.meeting_date).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <Avatar
                    src={m.party_avatar_url ? `/api/${m.party_kind === "lead" ? "leads" : "investors"}/${m.party_kind === "lead" ? m.lead_id : m.investor_id}/avatar` : null}
                    name={m.party_name}
                    size={24}
                  />
                  <div className="text-sm font-medium truncate">{m.party_name ?? "—"}</div>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {m.subject
                    ? m.subject
                    : `${TYPE_LABEL[m.meeting_type] ?? m.meeting_type} · ${MODE_LABEL[m.meeting_mode] ?? m.meeting_mode}`}
                </div>
                <span className={`chip capitalize mt-1.5 inline-block ${STATUS_TONE[m.status] ?? ""}`}>
                  {m.status.replace(/_/g, " ")}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {view === "kanban" ? (
        <MeetingsKanban meetings={data.kanban} />
      ) : (
        <MeetingsBulkTable
          upcoming={upcoming.map(withExtra)}
          past={past.map(withExtra)}
          upcomingTotal={data.upcomingTotal}
          pastTotal={data.pastTotal}
          upcomingPage={data.upcomingPage}
          pastPage={data.pastPage}
          pageSize={MEETINGS_PAGE_SIZE}
          rmOptions={rmOptions}
          colOrder={colOrder}
          extraCols={extraCols}
          toolbar={
            <CompactFilterBar
              bare
              searchPlaceholder="Search meetings…"
              sort={{
                key: "sort",
                options: [
                  { value: "meeting_desc", label: "Date — latest first" },
                  { value: "meeting_asc", label: "Date — earliest first" },
                ],
              }}
              filters={[
                {
                  type: "multi" as const,
                  key: "category",
                  label: "Category",
                  options: [
                    { value: "review", label: "Review" },
                    { value: "new", label: "New" },
                    { value: "follow_up", label: "Follow-up" },
                  ],
                },
                {
                  type: "multi" as const,
                  key: "status",
                  label: "Status",
                  options: [
                    { value: "scheduled", label: "Scheduled" },
                    { value: "confirmed", label: "Confirmed" },
                    { value: "in_progress", label: "In progress" },
                    { value: "completed", label: "Completed" },
                    { value: "rescheduled", label: "Rescheduled" },
                    { value: "cancelled", label: "Cancelled" },
                    { value: "no_show", label: "No show" },
                  ],
                },
                {
                  type: "multi" as const,
                  key: "mode",
                  label: "Mode",
                  options: [
                    { value: "office", label: "Office" },
                    { value: "client_place", label: "Client place" },
                    { value: "online", label: "Online" },
                    { value: "phone", label: "Phone" },
                  ],
                },
                {
                  type: "multi" as const,
                  key: "type",
                  label: "Agenda",
                  options: Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })),
                },
                ...(rmOptions.length ? [{ type: "multi" as const, key: "rm", label: "RM", options: rmOptions }] : []),
                { type: "date_range" as const, key: "meeting", label: "Meeting date" },
              ]}
              rightSlot={
                <>
                  <ColumnManager compact moduleKey="meetings-upcoming" columns={MEETINGS_COLUMNS} extraFields={extraOptions} prefs={colPrefs} pinFirst={["date"]} />
                  <CustomViews
                    compact
                    viewsKey="views:review-meetings"
                    presets={[
                      { id: "upcoming", name: "Upcoming", params: "status=scheduled,confirmed" },
                      { id: "reviews", name: "Review meetings", params: "category=review" },
                      { id: "new", name: "New / Follow-ups", params: "category=new,follow_up" },
                      { id: "completed", name: "Completed", params: "status=completed" },
                    ]}
                  />
                </>
              }
            />
          }
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone?: "rose" | "amber" | "emerald" | "muted";
  icon?: any;
}) {
  const color =
    tone === "rose"
      ? "text-rose-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "emerald"
          ? "text-emerald-600"
          : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
