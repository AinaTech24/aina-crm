"use client";

/**
 * MeetingsBulkTable — the review-meetings "Upcoming" and "Past" lists rendered
 * through the generic BulkTable so rows can be selected and bulk-acted (set
 * status / reassign RM / cancel). Cell rendering mirrors the previous
 * server-rendered tables; the label/tone maps are duplicated from the page.
 */

import Link from "next/link";
import { Calendar } from "lucide-react";
import { formatDate, formatRelative } from "@/lib/utils";
import { REVIEW_MEETING_STATUSES } from "@/db/schema/review_meetings";
import { BulkTable, type BulkColumn, type BulkAction } from "@/components/common/BulkTable";
import { Avatar } from "@/components/ui/Avatar";

const TYPE_LABEL: Record<string, string> = {
  portfolio_review: "Portfolio Review", goal_review: "Goal Review", new_investment_discussion: "New Investment",
  service_discussion: "Service Discussion", family_review: "Family Review", complaint_discussion: "Complaint Discussion",
  discovery_call: "Discovery Call", new_client_kickoff: "Client Kickoff", product_demo: "Product Demo",
  sales_pitch: "Sales Pitch", follow_up_call: "Follow-up Call", follow_up_visit: "Follow-up Visit", other: "Other",
};
const CATEGORY_LABEL: Record<string, string> = { review: "Review", new: "New", follow_up: "Follow-up" };
const CATEGORY_TONE: Record<string, string> = {
  review: "bg-brand-cyan-light text-brand-cyan-deep", new: "bg-violet-50 text-violet-700", follow_up: "bg-amber-50 text-amber-700",
};
const MODE_LABEL: Record<string, string> = { office: "Office", client_place: "Client Place", online: "Online", phone: "Phone" };
const MODE_TONE: Record<string, string> = {
  office: "bg-blue-50 text-blue-700", client_place: "bg-purple-50 text-purple-700", online: "bg-cyan-50 text-cyan-700", phone: "bg-amber-50 text-amber-700",
};
const STATUS_TONE: Record<string, string> = {
  scheduled: "bg-blue-50 text-blue-700", confirmed: "bg-cyan-50 text-cyan-700", in_progress: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700", rescheduled: "bg-slate-50 text-slate-700", cancelled: "bg-gray-50 text-gray-700", no_show: "bg-rose-50 text-rose-700",
};

type Row = Record<string, any> & { id: string };

// Relationship badge — the whole point of the "Client" column is to tell, at a
// glance, whether a past/upcoming meeting was with an existing CLIENT or a
// prospect (LEAD). A meeting tied to neither is flagged "Unlinked".
const RELATION: Record<"lead" | "investor", { label: string; cls: string }> = {
  lead: { label: "Lead", cls: "bg-violet-50 text-violet-700 border-violet-200" },
  investor: { label: "Client", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

const clientCell = (m: Row) => {
  const isLead = m.party_kind === "lead";
  const eid = isLead ? m.lead_id : m.investor_id;
  const pk = m.party_kind as "lead" | "investor" | null | undefined;
  const rel = pk === "lead" || pk === "investor" ? RELATION[pk] : null;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Avatar src={m.party_avatar_url && eid ? `/api/${isLead ? "leads" : "investors"}/${eid}/avatar` : null} name={m.party_name} size={26} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          {m.party_name ? (
            <Link href={isLead ? `/dashboard/leads/${m.lead_id}` : `/dashboard/investors/${m.investor_id}`} className="hover:underline font-medium truncate">
              {m.party_name}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {rel ? (
            <span className={`shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${rel.cls}`}>{rel.label}</span>
          ) : (
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-slate-50 text-slate-500 border-slate-200">Unlinked</span>
          )}
        </div>
        {m.party_kind === "investor" && m.segment_tag ? (
          <div className="text-[11px] text-muted-foreground truncate">{m.segment_tag}</div>
        ) : null}
      </div>
    </div>
  );
};

function actionsFor(rmOptions: { value: string; label: string }[]): BulkAction[] {
  return [
    { kind: "status", label: "Set status", options: REVIEW_MEETING_STATUSES.map((s) => [s, s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())] as [string, string]) },
    ...(rmOptions.length ? [{ kind: "assign", label: "Reassign RM", options: rmOptions } as BulkAction] : []),
    { kind: "delete", label: "Cancel" },
  ];
}

export function MeetingsBulkTable({
  upcoming,
  past,
  rmOptions,
}: {
  upcoming: Row[];
  past: Row[];
  rmOptions: { value: string; label: string }[];
}) {
  const actions = actionsFor(rmOptions);

  const upcomingCols: BulkColumn<Row>[] = [
    {
      key: "date", header: "Date", tdClass: "px-4 py-3 whitespace-nowrap",
      render: (m) => (
        <>
          <Link href={`/dashboard/review-meetings/${m.id}`} className="font-medium tabular-nums hover:underline">
            {new Date(m.meeting_date).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
          </Link>
          <div className="text-[11px] text-muted-foreground">
            in {Math.ceil((new Date(m.meeting_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000))} day(s)
          </div>
        </>
      ),
    },
    { key: "client", header: "Client", tdClass: "py-3", render: clientCell },
    {
      key: "category", header: "Category", tdClass: "py-3",
      render: (m) => (
        <>
          <span className={`chip text-[10px] ${CATEGORY_TONE[m.category ?? "review"] ?? ""}`}>{CATEGORY_LABEL[m.category ?? "review"] ?? m.category}</span>
          {m.parent_meeting_id && <div className="text-[10px] text-muted-foreground mt-0.5">↳ follow-up</div>}
        </>
      ),
    },
    {
      key: "agenda", header: "Agenda", tdClass: "py-3 text-xs",
      render: (m) =>
        m.subject ? (
          <>
            <div className="font-medium max-w-[220px] truncate">{m.subject}</div>
            <div className="text-[11px] text-muted-foreground">{TYPE_LABEL[m.meeting_type] ?? m.meeting_type}</div>
          </>
        ) : (
          TYPE_LABEL[m.meeting_type] ?? m.meeting_type
        ),
    },
    { key: "mode", header: "Mode", tdClass: "py-3", render: (m) => <span className={`chip ${MODE_TONE[m.meeting_mode] ?? ""}`}>{MODE_LABEL[m.meeting_mode] ?? m.meeting_mode}</span> },
    { key: "rm", header: "RM", tdClass: "py-3 text-xs", render: (m) => m.rm_name ?? "—" },
    { key: "status", header: "Status", thClass: "text-left py-2 font-medium pr-4", tdClass: "py-3 pr-4", render: (m) => <span className={`chip capitalize ${STATUS_TONE[m.status] ?? ""}`}>{String(m.status).replace(/_/g, " ")}</span> },
  ];

  const pastCols: BulkColumn<Row>[] = [
    {
      key: "date", header: "Date", tdClass: "px-4 py-3 text-xs tabular-nums whitespace-nowrap",
      render: (m) => (
        <>
          <Link href={`/dashboard/review-meetings/${m.id}`} className="font-medium hover:underline">{formatDate(m.meeting_date)}</Link>
          <div className="text-[11px] text-muted-foreground">{formatRelative(m.meeting_date)}</div>
        </>
      ),
    },
    { key: "client", header: "Client", tdClass: "py-3", render: clientCell },
    {
      key: "type", header: "Type", tdClass: "py-3 text-xs",
      render: (m) =>
        m.subject ? (
          <>
            <div className="font-medium max-w-[220px] truncate">{m.subject}</div>
            <div className="text-[11px] text-muted-foreground">{TYPE_LABEL[m.meeting_type] ?? m.meeting_type}</div>
          </>
        ) : (
          TYPE_LABEL[m.meeting_type] ?? m.meeting_type
        ),
    },
    { key: "status", header: "Status", tdClass: "py-3", render: (m) => <span className={`chip capitalize ${STATUS_TONE[m.status] ?? ""}`}>{String(m.status).replace(/_/g, " ")}</span> },
    {
      key: "actions", header: "Action items", thClass: "text-right py-2 font-medium", tdClass: "py-3 text-right tabular-nums",
      render: (m) => (m.action_count > 0 ? <span className={m.follow_up_task_created === "true" ? "text-emerald-600" : "text-amber-600"}>{m.action_count}</span> : "—"),
    },
    { key: "attach", header: "Attachments", thClass: "text-right py-2 font-medium", tdClass: "py-3 text-right tabular-nums text-muted-foreground", render: (m) => (m.attach_count > 0 ? m.attach_count : "—") },
    {
      key: "notes", header: "Notes", thClass: "text-left py-2 font-medium pr-4", tdClass: "py-3 pr-4 text-xs text-muted-foreground max-w-[260px] truncate",
      render: (m) =>
        m.meeting_notes
          ? m.meeting_notes
          : m.status === "completed"
            ? <Link href={`/dashboard/review-meetings/${m.id}`} className="italic text-amber-600 hover:underline">Add outcome →</Link>
            : <span className="italic">No notes yet</span>,
    },
  ];

  return (
    <>
      <div className="card-surface">
        <div className="border-b border-border px-4 py-2.5 font-semibold flex items-center justify-between">
          <span>Upcoming meetings ({upcoming.length})</span>
          {upcoming.length > 0 && <span className="text-xs text-muted-foreground">Select rows for bulk actions</span>}
        </div>
        {upcoming.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Calendar className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2">No meetings scheduled.</div>
          </div>
        ) : (
          <BulkTable rows={upcoming} columns={upcomingCols} endpoint="/api/review-meetings/bulk" actions={actions} itemLabel="meeting" />
        )}
      </div>

      {past.length > 0 && (
        <div className="card-surface">
          <div className="border-b border-border px-4 py-2.5 font-semibold">Past meetings ({past.length})</div>
          <BulkTable rows={past.slice(0, 50)} columns={pastCols} endpoint="/api/review-meetings/bulk" actions={actions} itemLabel="meeting" scrollBody />
        </div>
      )}
    </>
  );
}
