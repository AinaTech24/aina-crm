import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { Plus, LifeBuoy, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { withTenant } from "@/db/client";
import { serviceRequests, investors, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils";
import { RowActions } from "@/components/common/RowActions";
import { FilterBar } from "@/components/common/FilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { ColumnManager } from "@/components/common/ColumnManager";

const SR_COLUMNS = [
  { key: "ticket", label: "Ticket", required: true },
  { key: "client", label: "Client", required: true },
  { key: "type", label: "Service Type" },
  { key: "raised", label: "Raised on" },
  { key: "assignee", label: "Assigned to" },
  { key: "priority", label: "Priority" },
  { key: "status", label: "Status" },
  { key: "expected", label: "Expected resolution" },
  { key: "closed", label: "Closed on", defaultHidden: true },
  { key: "tat", label: "TAT (days)" },
  { key: "remarks", label: "Remarks", defaultHidden: true },
  { key: "attachments", label: "Attachments", defaultHidden: true },
  { key: "actions", label: "Actions", required: true },
];

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

const STATUS_TONE: Record<string, string> = {
  open: "bg-blue-50 text-blue-700",
  in_progress: "bg-amber-50 text-amber-700",
  waiting_customer: "bg-slate-50 text-slate-700",
  resolved: "bg-emerald-50 text-emerald-700",
  closed: "bg-gray-50 text-gray-700",
  escalated: "bg-rose-50 text-rose-700",
};

const PRIORITY_TONE: Record<string, string> = {
  urgent: "text-rose-600",
  high: "text-amber-600",
  normal: "text-foreground",
  low: "text-muted-foreground",
};

export const dynamic = "force-dynamic";

export default async function ServiceRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = (sp.status ?? "").split(",").filter(Boolean);
  const priority = (sp.priority ?? "").split(",").filter(Boolean);
  const srType = (sp.srtype ?? "").split(",").filter(Boolean);
  const breached = sp.breached === "1";

  // Build WHERE conditions
  const conds: any[] = [];
  if (q) {
    conds.push(
      sql`(sr.ticket_no ILIKE ${`%${q}%`} OR sr.subject ILIKE ${`%${q}%`} OR i.name ILIKE ${`%${q}%`})`
    );
  }
  if (status.length)
    conds.push(sql`sr.status IN (${sql.join(status.map((v) => sql`${v}`), sql`, `)})`);
  if (priority.length)
    conds.push(sql`sr.priority IN (${sql.join(priority.map((v) => sql`${v}`), sql`, `)})`);
  if (srType.length)
    conds.push(sql`sr.type IN (${sql.join(srType.map((v) => sql`${v}`), sql`, `)})`);
  if (breached) conds.push(sql`sr.status NOT IN ('resolved','closed') AND sr.sla_resolution_at < now()`);
  const whereClause =
    conds.length === 0 ? sql`` : sql`WHERE ${sql.join(conds, sql` AND `)}`;

  const result = await withTenant(session.tenantId, async (tx) => {
    const rows = await tx.execute(sql`
      SELECT sr.id, sr.ticket_no, sr.investor_id, sr.type, sr.subject, sr.description,
             sr.status, sr.priority, sr.assigned_to_user_id,
             sr.sla_response_at, sr.sla_resolution_at, sr.responded_at, sr.resolved_at,
             sr.escalated_at, sr.escalated_to_user_id, sr.remarks,
             jsonb_array_length(COALESCE(sr.attachments, '[]'::jsonb)) AS attach_count,
             sr.created_at,
             i.name AS investor_name, u.name AS assignee_name,
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

    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('open', 'in_progress', 'waiting_customer'))::int AS open,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed')
          AND sla_resolution_at < now() + interval '24 hours'
          AND sla_resolution_at >= now())::int AS at_risk,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed')
          AND sla_resolution_at < now())::int AS breached,
        COUNT(*) FILTER (WHERE status = 'escalated' OR escalated_at IS NOT NULL)::int AS escalated,
        COUNT(*) FILTER (WHERE status IN ('resolved', 'closed')
          AND resolved_at >= date_trunc('month', now()))::int AS closed_mtd,
        ROUND(
          AVG(EXTRACT(DAY FROM resolved_at - created_at))
            FILTER (WHERE status IN ('resolved','closed')
              AND resolved_at >= date_trunc('month', now()))::numeric,
          1
        ) AS avg_tat_days
      FROM service_requests
    `);
    return { rows: rows.rows as any[], stats: stats.rows[0] as any };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <LifeBuoy className="size-6 text-brand-cyan" /> Service Requests
          </h1>
          <p className="text-muted-foreground text-sm">
            13 service types · TAT clock per ticket · escalation to owner when SLA breaches.
          </p>
        </div>
        <Link href="/dashboard/service-requests/new" className="btn-primary">
          <Plus className="size-4" /> New ticket
        </Link>
      </div>

      <div className="grid grid-cols-5 gap-3">
        <Stat icon={LifeBuoy} label="Open" value={result.stats.open ?? 0} />
        <Stat icon={Clock} label="SLA at risk (<24h)" value={result.stats.at_risk ?? 0} tone={result.stats.at_risk > 0 ? "amber" : "muted"} />
        <Stat icon={AlertTriangle} label="SLA breached" value={result.stats.breached ?? 0} tone={result.stats.breached > 0 ? "rose" : "muted"} />
        <Stat icon={AlertTriangle} label="Escalated" value={result.stats.escalated ?? 0} tone={result.stats.escalated > 0 ? "rose" : "muted"} />
        <Stat icon={CheckCircle2} label="Avg TAT (MTD, days)" value={result.stats.avg_tat_days ?? "—"} tone="emerald" />
      </div>

      <FilterBar
        totalCount={result.rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search ticket #, subject, or client…" },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "open", label: "Open" },
              { value: "in_progress", label: "In progress" },
              { value: "waiting_customer", label: "Waiting customer" },
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
            type: "select",
            key: "breached",
            label: "Breached?",
            options: [{ value: "1", label: "Yes — past SLA" }],
          },
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            <ColumnManager moduleKey="service-requests" columns={SR_COLUMNS} />
            <CustomViews
              viewsKey="views:service-requests"
              presets={[
                { id: "open", name: "Open + In-progress", params: "status=open,in_progress" },
                { id: "breached", name: "Breached", params: "breached=1" },
                { id: "urgent", name: "Urgent priority", params: "priority=urgent,high" },
              ]}
            />
          </div>
        }
      />

      <div className="card-surface">
        {result.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <LifeBuoy className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No service requests match these filters.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              Click <strong>New ticket</strong> to raise a request. Tickets auto-track TAT and
              escalate to the firm owner if the SLA breaches.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-table="service-requests">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th data-col="ticket" className="text-left px-4 py-2 font-medium">Ticket</th>
                  <th data-col="client" className="text-left py-2 font-medium">Client</th>
                  <th data-col="type" className="text-left py-2 font-medium">Service Type</th>
                  <th data-col="raised" className="text-left py-2 font-medium">Raised</th>
                  <th data-col="assignee" className="text-left py-2 font-medium">Assigned to</th>
                  <th data-col="priority" className="text-left py-2 font-medium">Priority</th>
                  <th data-col="status" className="text-left py-2 font-medium">Status</th>
                  <th data-col="expected" className="text-left py-2 font-medium">Expected</th>
                  <th data-col="closed" className="text-left py-2 font-medium">Closed</th>
                  <th data-col="tat" className="text-right py-2 font-medium">TAT (d)</th>
                  <th data-col="remarks" className="text-left py-2 font-medium">Remarks</th>
                  <th data-col="attachments" className="text-right py-2 font-medium pr-4">Att.</th>
                  <th data-col="actions" className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((sr) => (
                  <tr
                    key={sr.id}
                    className={`border-b last:border-0 hover:bg-secondary/40 ${
                      sr.breached ? "bg-rose-50/30" : ""
                    }`}
                  >
                    <td data-col="ticket" className="px-4 py-3 font-mono text-xs whitespace-nowrap">{sr.ticket_no}</td>
                    <td data-col="client" className="py-3 whitespace-nowrap">
                      {sr.investor_id ? (
                        <Link href={`/dashboard/investors/${sr.investor_id}`} className="hover:underline">
                          {sr.investor_name}
                        </Link>
                      ) : (
                        sr.investor_name ?? "—"
                      )}
                    </td>
                    <td data-col="type" className="py-3 text-xs">
                      <div className="font-medium">{TYPE_LABEL[sr.type] ?? sr.type}</div>
                      {sr.subject && (
                        <div className="text-[11px] text-muted-foreground max-w-[180px] truncate">
                          {sr.subject}
                        </div>
                      )}
                    </td>
                    <td data-col="raised" className="py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {formatDate(sr.created_at)}
                    </td>
                    <td data-col="assignee" className="py-3 text-xs whitespace-nowrap">{sr.assignee_name ?? "—"}</td>
                    <td data-col="priority" className={`py-3 text-xs capitalize ${PRIORITY_TONE[sr.priority]}`}>
                      {sr.priority}
                    </td>
                    <td data-col="status" className="py-3">
                      <span className={`chip ${STATUS_TONE[sr.status] ?? ""}`}>
                        {sr.status.replace(/_/g, " ")}
                      </span>
                      {sr.escalated_at && (
                        <div className="text-[10px] text-rose-600 font-semibold mt-0.5">
                          escalated
                        </div>
                      )}
                    </td>
                    <td data-col="expected" className="py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {sr.sla_resolution_at ? formatDate(sr.sla_resolution_at) : "—"}
                    </td>
                    <td data-col="closed" className="py-3 text-xs whitespace-nowrap">
                      {sr.resolved_at ? (
                        <span className="text-emerald-600 font-medium tabular-nums">
                          {formatDate(sr.resolved_at)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td data-col="tat" className="py-3 text-right tabular-nums">
                      {sr.breached ? (
                        <span className="text-rose-600 font-bold">{sr.tat_days}</span>
                      ) : sr.resolved_at ? (
                        <span className="text-emerald-600 font-medium">{sr.tat_days}</span>
                      ) : (
                        <span className="text-muted-foreground">{sr.tat_days}</span>
                      )}
                    </td>
                    <td data-col="remarks" className="py-3 text-xs text-muted-foreground max-w-[160px] truncate">
                      {sr.remarks ?? "—"}
                    </td>
                    <td data-col="attachments" className="py-3 text-right tabular-nums text-muted-foreground">
                      {sr.attach_count > 0 ? sr.attach_count : "—"}
                    </td>
                    <td data-col="actions" className="px-4 py-3 text-right">
                      <RowActions
                        deleteUrl={`/api/service-requests/${sr.id}`}
                        itemLabel="ticket"
                        itemName={sr.ticket_no}
                        verb="Close"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
  value: number | string;
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
