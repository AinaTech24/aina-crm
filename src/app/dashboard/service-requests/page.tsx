import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Plus, LifeBuoy } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { ServiceRequestsTable } from "@/components/service-requests/ServiceRequestsTable";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { dateRangeCond } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { ColumnManager } from "@/components/common/ColumnManager";
import { MoreMenu } from "@/components/common/MoreMenu";
import { buttonClass } from "@/components/ui/button-class";
import { srPastSlaSql, srWhere } from "@/lib/metrics";
import { serviceRequestScopeSql, srClientVisibleSql } from "@/lib/service-requests/access";

const SR_COLUMNS = [
  { key: "ticket", label: "Ticket #", required: true },
  { key: "client", label: "Client", required: true },
  { key: "type", label: "Request type" },
  { key: "subject", label: "Subject" },
  { key: "assignee", label: "Assigned to" },
  { key: "due", label: "Due (SLA)" },
  { key: "status", label: "Status" },
  { key: "raised", label: "Raised on", defaultHidden: true },
  { key: "priority", label: "Priority", defaultHidden: true },
  { key: "tat", label: "Age (days)", defaultHidden: true },
  { key: "attachments", label: "Attachments", defaultHidden: true },
  { key: "actions", label: "Actions", required: true },
];

/**
 * Status tabs. Together they cover every status, so no ticket is ever in none
 * of them: Open is new + in progress, Closed is resolved + closed.
 */
const TABS = [
  { key: "open", label: "Open", statuses: ["open", "in_progress"] },
  { key: "escalated", label: "Escalated", statuses: ["escalated"] },
  { key: "waiting", label: "Waiting on client", statuses: ["waiting_customer"] },
  { key: "closed", label: "Closed", statuses: ["resolved", "closed"] },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const TYPE_LABEL: Record<string, string> = {
  nominee_update: "Nominee Update",
  bank_update: "Bank Update",
  mobile_update: "Mobile Update",
  email_update: "Email Update",
  kyc_update: "KYC Update",
  minor_to_major: "Minor to Major",
  capital_gain_report: "Capital Gain Report",
  statement_request: "Statement Request",
  redemption_request: "Redemption Request",
  switch_request: "Switch Request",
  transmission_case: "Transmission Case",
  folio_correction: "Folio Correction",
  other: "Other",
  // Legacy
  complaint: "Complaint",
  redemption_help: "Redemption Request",
  switch_help: "Switch Request",
  transaction_query: "Other",
};

export const dynamic = "force-dynamic";

export default async function ServiceRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  // The firm's public complaint link — for whoever runs the firm's tickets.
  const canSeeComplaintForm = (["service_request.view.all", "service_request.manage", "compliance.view"] as const)
    .some((cap) => can(session.roles, cap, session.permissions));
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = (sp.status ?? "").split(",").filter(Boolean);
  const breached = sp.breached === "1";
  // A tab picks the statuses, unless an explicit ?status= (an old link or a
  // saved view) already did — then no tab is highlighted. `breached=1` without
  // a tab spans every tab: the dashboard's "past SLA" count includes escalated
  // and waiting tickets too, so defaulting to Open would hide some of them.
  const tab: TabKey | null = status.length
    ? null
    : (TABS.find((t) => t.key === sp.tab)?.key ?? (breached ? null : "open"));
  const priority = (sp.priority ?? "").split(",").filter(Boolean);
  const srType = (sp.srtype ?? "").split(",").filter(Boolean);
  const mine = sp.mine === "1";
  const assigneeFilter = (sp.assignee ?? "").split(",").filter(Boolean);
  // rm / branch — the dashboard's service-request counts follow the CLIENT:
  // the ticket's client's RM / branch (lib/metrics/service.ts srWhere; a ticket
  // with no client then drops out). With neither, every ticket of the firm.
  const rmFilter = (sp.rm ?? "").split(",").filter(Boolean);
  const branchFilter = (sp.branch ?? "").split(",").filter(Boolean);

  // Build WHERE conditions
  const conds: any[] = [srWhere({ tenantId: session.tenantId, rmIds: rmFilter, branchIds: branchFilter })];
  if (mine) conds.push(sql`sr.assigned_to_user_id = ${session.userId}::uuid`);
  if (assigneeFilter.length)
    conds.push(sql`sr.assigned_to_user_id IN (${sql.join(assigneeFilter.map((v) => sql`${v}::uuid`), sql`, `)})`);
  if (q) {
    conds.push(
      sql`(sr.ticket_no ILIKE ${`%${q}%`} OR sr.subject ILIKE ${`%${q}%`} OR i.name ILIKE ${`%${q}%`} OR u.name ILIKE ${`%${q}%`})`
    );
  }
  if (status.length)
    conds.push(sql`sr.status IN (${sql.join(status.map((v) => sql`${v}`), sql`, `)})`);
  if (priority.length)
    conds.push(sql`sr.priority IN (${sql.join(priority.map((v) => sql`${v}`), sql`, `)})`);
  if (srType.length)
    conds.push(sql`sr.type IN (${sql.join(srType.map((v) => sql`${v}`), sql`, `)})`);
  // breached=1 — the dashboard's "service requests past SLA" (srPastSlaSql).
  if (breached) conds.push(srPastSlaSql("sr"));
  const dr = dateRangeCond(sp, "created", "sr.created_at");
  if (dr) conds.push(dr);
  // Tab counts are taken over every other filter, before the tab narrows.
  const countConds = [...conds];
  if (tab) {
    const st = TABS.find((t) => t.key === tab)!.statuses;
    conds.push(sql`sr.status IN (${sql.join(st.map((v) => sql`${v}`), sql`, `)})`);
  }

  const result = await withTenant(session.tenantId, async (tx) => {
    // Only tickets this viewer may see; a ticket assigned to them about a
    // client outside their book shows no client details.
    const scope = await serviceRequestScopeSql(tx, session, "sr");
    const clientVisible = await srClientVisibleSql(tx, session, "sr");
    const whereClause = sql`WHERE ${sql.join([...conds, scope], sql` AND `)}`;
    const countWhere = sql`WHERE ${sql.join([...countConds, scope], sql` AND `)}`;
    const rows = await tx.execute(sql`
      SELECT sr.id, sr.ticket_no, sr.type, sr.subject, sr.description,
             sr.status, sr.priority, sr.assigned_to_user_id,
             sr.sla_response_at, sr.sla_resolution_at, sr.responded_at, sr.resolved_at,
             sr.escalated_at, sr.escalated_to_user_id, sr.remarks,
             jsonb_array_length(COALESCE(sr.attachments, '[]'::jsonb)) AS attach_count,
             sr.created_at,
             CASE WHEN ${clientVisible} THEN i.name END AS investor_name,
             CASE WHEN ${clientVisible} THEN i.avatar_url END AS investor_avatar_url,
             CASE WHEN ${clientVisible} THEN sr.investor_id END AS investor_id,
             u.name AS assignee_name,
             CASE
               WHEN sr.resolved_at IS NOT NULL
                 THEN EXTRACT(DAY FROM sr.resolved_at - sr.created_at)::int
               ELSE EXTRACT(DAY FROM now() - sr.created_at)::int
             END AS tat_days,
             (sr.status NOT IN ('resolved','closed') AND sr.sla_resolution_at < now()) AS breached
      FROM service_requests sr
      LEFT JOIN investors i ON i.id = sr.investor_id
      LEFT JOIN users u ON u.id = sr.assigned_to_user_id
      ${whereClause}
      ORDER BY sr.created_at DESC
      LIMIT 200
    `);

    const countRows = await tx.execute(sql`
      SELECT
        count(*) FILTER (WHERE sr.status IN ('open','in_progress'))::int AS open,
        count(*) FILTER (WHERE sr.status = 'escalated')::int AS escalated,
        count(*) FILTER (WHERE sr.status = 'waiting_customer')::int AS waiting,
        count(*) FILTER (WHERE sr.status IN ('resolved','closed'))::int AS closed
      FROM service_requests sr
      LEFT JOIN investors i ON i.id = sr.investor_id
      LEFT JOIN users u ON u.id = sr.assigned_to_user_id
      ${countWhere}
    `);

    const rmRows = await tx.execute(sql`
      SELECT id, name FROM users
      WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
      ORDER BY name ASC
    `);
    return { rows: rows.rows as any[], rms: rmRows.rows as any[], counts: (countRows.rows[0] ?? {}) as Record<string, number> };
  });

  const rmOptions = (result.rms ?? []).map((r: any) => ({ value: String(r.id), label: r.name ?? "—" }));
  // A tab keeps every other filter; it replaces status and restarts the page.
  const tabHref = (key: TabKey) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "tab" && k !== "status" && k !== "page") p.set(k, v);
    // With breached=1 "no tab" means every tab, so Open must be named.
    if (key !== "open" || breached) p.set("tab", key);
    const qs = p.toString();
    return qs ? `/dashboard/service-requests?${qs}` : "/dashboard/service-requests";
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard title={<><LifeBuoy className="size-6 text-muted-foreground" /> Service Requests</>} actions={<><div className="flex items-center gap-2">
          {canSeeComplaintForm && (
            <MoreMenu
              label="More"
              items={[
                {
                  href: "/dashboard/complaints/website-form",
                  label: "Complaint form for your website",
                  description: "One link clients can use to send you a complaint",
                  tooltip:
                    "Put this link on your website. Every complaint sent through it arrives here as a complaint, with the 21-day clock started.",
                },
              ]}
            />
          )}
          <Link href="/dashboard/service-requests/new" className={buttonClass("primary")}>
            <Plus className="size-4" /> New request
          </Link>
        </div></>} />

      {/* Status tabs, with counts under the current filters. */}
      <nav role="tablist" aria-label="Ticket status" className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1">
        {TABS.map((t) => {
          const active = tab === t.key;
          const n = Number(result.counts[t.key] ?? 0);
          return (
            <Link
              key={t.key}
              href={tabHref(t.key)}
              role="tab"
              aria-selected={active}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-card/60"
              }`}
            >
              {t.label}
              <span className={`tabular-nums ${t.key === "escalated" && n > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                {n}
              </span>
            </Link>
          );
        })}
      </nav>

      <CompactFilterBar
        searchPlaceholder="Search ticket #, subject, or client…"
        totalCount={result.rows.length}
        filters={[
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "open", label: "Open" },
              { value: "in_progress", label: "In progress" },
              { value: "waiting_customer", label: "Waiting on client" },
              { value: "resolved", label: "Resolved" },
              { value: "closed", label: "Closed" },
              { value: "escalated", label: "Escalated" },
            ],
          },
          {
            type: "multi",
            key: "priority",
            label: "Priority",
            options: [
              { value: "urgent", label: "Urgent" },
              { value: "high", label: "High" },
              { value: "normal", label: "Normal" },
              { value: "low", label: "Low" },
            ],
          },
          {
            type: "multi",
            key: "srtype",
            label: "Type",
            options: Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })),
          },
          {
            type: "multi",
            key: "breached",
            label: "SLA",
            options: [{ value: "1", label: "Breached — past SLA" }],
          },
          {
            type: "multi",
            key: "mine",
            label: "Owner",
            options: [{ value: "1", label: "My tickets" }],
          },
          ...(rmOptions.length
            ? [{ type: "multi" as const, key: "assignee", label: "Assignee", options: rmOptions }]
            : []),
          { type: "date_range" as const, key: "created", label: "Date" },
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            <ColumnManager moduleKey="service-requests" columns={SR_COLUMNS} />
            <CustomViews
              viewsKey="views:service-requests"
              presets={[
                { id: "open", name: "Open + In-progress", params: "tab=open" },
                { id: "complaints", name: "Complaints (SEBI register)", params: "srtype=complaint&status=open,in_progress,waiting_customer,escalated,resolved,closed" },
                { id: "mine", name: "My open tickets", params: "mine=1&status=open,in_progress,waiting_customer,escalated" },
                { id: "breached", name: "Breached", params: "breached=1" },
                { id: "urgent", name: "Urgent priority", params: "priority=urgent,high" },
              ]}
            />
          </div>
        }
      />

      <ServiceRequestsTable rows={result.rows} />
    </div>
  );
}
