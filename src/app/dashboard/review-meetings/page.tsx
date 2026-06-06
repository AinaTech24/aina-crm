import Link from "next/link";
import { sql } from "drizzle-orm";
import { Calendar, Plus, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatRelative } from "@/lib/utils";
import { FilterBar } from "@/components/common/FilterBar";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { ColumnManager } from "@/components/common/ColumnManager";
import { RowLink } from "@/components/common/RowLink";

const MEETINGS_COLUMNS = [
  { key: "date", label: "Date", required: true },
  { key: "client", label: "Client", required: true },
  { key: "category", label: "Category" },
  { key: "agenda", label: "Agenda" },
  { key: "mode", label: "Mode" },
  { key: "rm", label: "RM" },
  { key: "status", label: "Status" },
];

export const dynamic = "force-dynamic";

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

const CATEGORY_LABEL: Record<string, string> = {
  review: "Review",
  new: "New",
  follow_up: "Follow-up",
};

const CATEGORY_TONE: Record<string, string> = {
  review: "bg-brand-cyan-light text-brand-cyan-deep",
  new: "bg-violet-50 text-violet-700",
  follow_up: "bg-amber-50 text-amber-700",
};

const MODE_LABEL: Record<string, string> = {
  office: "Office",
  client_place: "Client Place",
  online: "Online",
  phone: "Phone",
};

const MODE_TONE: Record<string, string> = {
  office: "bg-blue-50 text-blue-700",
  client_place: "bg-purple-50 text-purple-700",
  online: "bg-cyan-50 text-cyan-700",
  phone: "bg-amber-50 text-amber-700",
};

const STATUS_TONE: Record<string, string> = {
  scheduled: "bg-blue-50 text-blue-700",
  confirmed: "bg-cyan-50 text-cyan-700",
  in_progress: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  rescheduled: "bg-slate-50 text-slate-700",
  cancelled: "bg-gray-50 text-gray-700",
  no_show: "bg-rose-50 text-rose-700",
};

export default async function ReviewMeetingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const categoryFilter = (sp.category ?? "").split(",").filter(Boolean);
  const statusFilter = (sp.status ?? "").split(",").filter(Boolean);
  const modeFilter = (sp.mode ?? "").split(",").filter(Boolean);
  const typeFilter = (sp.type ?? "").split(",").filter(Boolean);
  const rmFilter = (sp.rm ?? "").split(",").filter(Boolean);

  const data = await withTenant(session.tenantId, async (tx) => {
    const filters: any[] = [sql`m.tenant_id = ${session.tenantId}::uuid`];
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
      filters.push(
        sql`m.rm_id IN (${sql.join(rmFilter.map((v) => sql`${v}::uuid`), sql`, `)})`
      );
    }
    const dr = dateRangeCond(sp, "meeting", "m.meeting_date");
    if (dr) filters.push(dr);
    const whereSql = filters.length ? sql` WHERE ${sql.join(filters, sql` AND `)}` : sql``;

    const meetings = await tx.execute(sql`
      SELECT m.id, m.investor_id, m.lead_id, m.rm_id,
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
             CASE WHEN i.id IS NOT NULL THEN 'investor'
                  WHEN l.id IS NOT NULL THEN 'lead' END AS party_kind,
             i.pan AS investor_pan, i.segment_tag,
             u.name AS rm_name
      FROM review_meetings m
      LEFT JOIN investors i ON i.id = m.investor_id
      LEFT JOIN leads l ON l.id = m.lead_id
      LEFT JOIN users u ON u.id = m.rm_id
      ${whereSql}
      ORDER BY m.meeting_date DESC
      LIMIT 200
    `);

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
      FROM review_meetings
      WHERE tenant_id = ${session.tenantId}::uuid
    `);
    const s = stats.rows[0] as any;
    // RM roster for the "RM" filter dropdown (so the MFD can see meetings by RM).
    const rmRows = await tx.execute(sql`
      SELECT id, name FROM users
      WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
      ORDER BY name ASC
    `);
    return { rows: meetings.rows as any[], stats: s, rms: rmRows.rows as any[] };
  });

  const rmOptions = (data.rms ?? []).map((r: any) => ({ value: String(r.id), label: r.name ?? "—" }));

  const upcoming = data.rows.filter(
    (r) => ["scheduled", "confirmed"].includes(r.status) && new Date(r.meeting_date) >= new Date()
  );
  const past = data.rows.filter(
    (r) => !["scheduled", "confirmed"].includes(r.status) || new Date(r.meeting_date) < new Date()
  );
  const todays = data.rows
    .filter(
      (r) =>
        ["scheduled", "confirmed", "in_progress"].includes(r.status) &&
        new Date(r.meeting_date).toDateString() === new Date().toDateString()
    )
    .sort((a, b) => new Date(a.meeting_date).getTime() - new Date(b.meeting_date).getTime());

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <Calendar className="size-6 text-brand-cyan" /> Meetings
          </h1>
          <p className="page-subtitle">
            Review · New · Follow-up — schedule, run, capture notes; action items auto-fan-out
            into tasks.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/review-meetings/new?category=review"
            className="btn-primary"
          >
            <Plus className="size-4" /> Add Meeting
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat icon={Calendar} label="Upcoming" value={data.stats.upcoming} />
        <Stat icon={Clock} label="This week" value={data.stats.this_week} tone={data.stats.this_week > 0 ? "amber" : "muted"} />
        <Stat icon={AlertTriangle} label="Overdue" value={data.stats.overdue} tone={data.stats.overdue > 0 ? "rose" : "muted"} />
        <Stat icon={CheckCircle2} label="Completed MTD" value={data.stats.completed_mtd} tone="emerald" />
      </div>

      {todays.length > 0 && (
        <div className="card-surface p-4">
          <div className="flex items-center gap-2 mb-3 font-semibold text-sm">
            <Calendar className="size-4 text-brand-cyan" /> Today&apos;s agenda
            <span className="chip bg-brand-cyan-light text-brand-cyan-deep text-[10px]">{todays.length}</span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {todays.map((m) => (
              <Link
                key={m.id}
                href={`/dashboard/review-meetings/${m.id}`}
                className="min-w-[210px] rounded-lg border border-border p-3 hover:bg-secondary/40 transition-colors"
              >
                <div className="text-lg font-bold tabular-nums">
                  {new Date(m.meeting_date).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                </div>
                <div className="text-sm font-medium truncate">{m.party_name ?? "—"}</div>
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

      <FilterBar
        totalCount={data.rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search by client, notes, discussion points…" },
          {
            type: "multi",
            key: "category",
            label: "Category",
            options: [
              { value: "review", label: "Review" },
              { value: "new", label: "New" },
              { value: "follow_up", label: "Follow-up" },
            ],
          },
          {
            type: "multi",
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
            type: "multi",
            key: "mode",
            label: "Mode",
            options: [
              { value: "office", label: "Office" },
              { value: "client_place", label: "Client place" },
              { value: "online", label: "Online" },
              { value: "phone", label: "Phone" },
            ],
          },
          ...(rmOptions.length
            ? [{ type: "multi" as const, key: "rm", label: "RM", options: rmOptions }]
            : []),
          dateRangeFilter("meeting", "Meeting date"),
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            <ColumnManager moduleKey="meetings-upcoming" columns={MEETINGS_COLUMNS} />
            <CustomViews
              viewsKey="views:review-meetings"
              presets={[
                { id: "upcoming", name: "Upcoming", params: "status=scheduled,confirmed" },
                { id: "reviews", name: "Review meetings", params: "category=review" },
                { id: "new", name: "New / Follow-ups", params: "category=new,follow_up" },
                { id: "completed", name: "Completed", params: "status=completed" },
              ]}
            />
          </div>
        }
      />

      <div className="card-surface">
        <div className="border-b border-border px-4 py-2.5 font-semibold flex items-center justify-between">
          <span>Upcoming meetings ({upcoming.length})</span>
          {upcoming.length > 0 && (
            <span className="text-xs text-muted-foreground">Click a row to open</span>
          )}
        </div>
        {upcoming.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Calendar className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2">No meetings scheduled.</div>
          </div>
        ) : (
          <table className="w-full text-sm" data-table="meetings-upcoming">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th data-col="date" className="text-left px-4 py-2 font-medium">Date</th>
                <th data-col="client" className="text-left py-2 font-medium">Client</th>
                <th data-col="category" className="text-left py-2 font-medium">Category</th>
                <th data-col="agenda" className="text-left py-2 font-medium">Agenda</th>
                <th data-col="mode" className="text-left py-2 font-medium">Mode</th>
                <th data-col="rm" className="text-left py-2 font-medium">RM</th>
                <th data-col="status" className="text-left py-2 font-medium pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((m) => (
                <RowLink key={m.id} href={`/dashboard/review-meetings/${m.id}`} className="border-b last:border-0 hover:bg-secondary/40">
                  <td data-col="date" className="px-4 py-3 whitespace-nowrap">
                    <Link href={`/dashboard/review-meetings/${m.id}`} className="font-medium tabular-nums hover:underline">
                      {new Date(m.meeting_date).toLocaleString("en-IN", {
                        day: "numeric",
                        month: "short",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </Link>
                    <div className="text-[11px] text-muted-foreground">
                      in {Math.ceil((new Date(m.meeting_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000))} day(s)
                    </div>
                  </td>
                  <td data-col="client" className="py-3">
                    {m.party_name ? (
                      <Link
                        href={
                          m.party_kind === "lead"
                            ? `/dashboard/leads/${m.lead_id}`
                            : `/dashboard/investors/${m.investor_id}`
                        }
                        className="hover:underline"
                      >
                        {m.party_name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {m.party_kind === "lead" ? "Lead" : m.segment_tag ?? "—"}
                    </div>
                  </td>
                  <td data-col="category" className="py-3">
                    <span className={`chip text-[10px] ${CATEGORY_TONE[m.category ?? "review"] ?? ""}`}>
                      {CATEGORY_LABEL[m.category ?? "review"] ?? m.category}
                    </span>
                    {m.parent_meeting_id && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        ↳ follow-up
                      </div>
                    )}
                  </td>
                  <td data-col="agenda" className="py-3 text-xs">
                    {m.subject ? (
                      <>
                        <div className="font-medium max-w-[220px] truncate">{m.subject}</div>
                        <div className="text-[11px] text-muted-foreground">{TYPE_LABEL[m.meeting_type] ?? m.meeting_type}</div>
                      </>
                    ) : (
                      TYPE_LABEL[m.meeting_type] ?? m.meeting_type
                    )}
                  </td>
                  <td data-col="mode" className="py-3">
                    <span className={`chip ${MODE_TONE[m.meeting_mode] ?? ""}`}>
                      {MODE_LABEL[m.meeting_mode] ?? m.meeting_mode}
                    </span>
                  </td>
                  <td data-col="rm" className="py-3 text-xs">{m.rm_name ?? "—"}</td>
                  <td data-col="status" className="py-3 pr-4">
                    <span className={`chip capitalize ${STATUS_TONE[m.status] ?? ""}`}>
                      {m.status.replace(/_/g, " ")}
                    </span>
                  </td>
                </RowLink>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {past.length > 0 && (
        <div className="card-surface">
          <div className="border-b border-border px-4 py-2.5 font-semibold">
            Past meetings ({past.length})
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Date</th>
                <th className="text-left py-2 font-medium">Client</th>
                <th className="text-left py-2 font-medium">Type</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="text-right py-2 font-medium">Action items</th>
                <th className="text-right py-2 font-medium">Attachments</th>
                <th className="text-left py-2 font-medium pr-4">Notes</th>
              </tr>
            </thead>
            <tbody>
              {past.slice(0, 50).map((m) => (
                <RowLink key={m.id} href={`/dashboard/review-meetings/${m.id}`} className="border-b last:border-0 hover:bg-secondary/40">
                  <td className="px-4 py-3 text-xs tabular-nums whitespace-nowrap">
                    <Link href={`/dashboard/review-meetings/${m.id}`} className="font-medium hover:underline">
                      {formatDate(m.meeting_date)}
                    </Link>
                    <div className="text-[11px] text-muted-foreground">{formatRelative(m.meeting_date)}</div>
                  </td>
                  <td className="py-3">
                    {m.party_name ? (
                      <Link
                        href={
                          m.party_kind === "lead"
                            ? `/dashboard/leads/${m.lead_id}`
                            : `/dashboard/investors/${m.investor_id}`
                        }
                        className="hover:underline"
                      >
                        {m.party_name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-3 text-xs">
                    {m.subject ? <span className="font-medium">{m.subject}</span> : (TYPE_LABEL[m.meeting_type] ?? m.meeting_type)}
                  </td>
                  <td className="py-3">
                    <span className={`chip capitalize ${STATUS_TONE[m.status] ?? ""}`}>
                      {m.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="py-3 text-right tabular-nums">
                    {m.action_count > 0 ? (
                      <span className={m.follow_up_task_created === "true" ? "text-emerald-600" : "text-amber-600"}>
                        {m.action_count}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-3 text-right tabular-nums text-muted-foreground">
                    {m.attach_count > 0 ? m.attach_count : "—"}
                  </td>
                  <td className="py-3 pr-4 text-xs text-muted-foreground max-w-[260px] truncate">
                    {m.meeting_notes ?? <span className="italic">No notes yet</span>}
                  </td>
                </RowLink>
              ))}
            </tbody>
          </table>
        </div>
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
