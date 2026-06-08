import Link from "next/link";
import { sql } from "drizzle-orm";
import { Plus, LifeBuoy, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { ServiceRequestsTable } from "@/components/service-requests/ServiceRequestsTable";
import { FilterBar } from "@/components/common/FilterBar";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { ColumnManager } from "@/components/common/ColumnManager";
import { WorkSwitcher } from "@/components/layout/WorkSwitcher";

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
  const mine = sp.mine === "1";
  const assigneeFilter = (sp.assignee ?? "").split(",").filter(Boolean);

  // Build WHERE conditions
  const conds: any[] = [sql`sr.tenant_id = ${session.tenantId}::uuid`];
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
  if (breached) conds.push(sql`sr.status NOT IN ('resolved','closed') AND sr.sla_resolution_at < now()`);
  const dr = dateRangeCond(sp, "created", "sr.created_at");
  if (dr) conds.push(dr);
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
        ) AS avg_tat_days,
        -- SLA-hit %: response (responded before its SLA) + resolution (resolved before its SLA)
        COUNT(*) FILTER (WHERE responded_at IS NOT NULL AND sla_response_at IS NOT NULL)::int AS resp_total,
        COUNT(*) FILTER (WHERE responded_at IS NOT NULL AND sla_response_at IS NOT NULL AND responded_at <= sla_response_at)::int AS resp_met,
        COUNT(*) FILTER (WHERE resolved_at IS NOT NULL AND sla_resolution_at IS NOT NULL)::int AS reso_total,
        COUNT(*) FILTER (WHERE resolved_at IS NOT NULL AND sla_resolution_at IS NOT NULL AND resolved_at <= sla_resolution_at)::int AS reso_met,
        -- Aging buckets among open tickets (by age since raised)
        COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed') AND (now() - created_at) <= interval '2 days')::int AS age_0_2,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed') AND (now() - created_at) > interval '2 days' AND (now() - created_at) <= interval '7 days')::int AS age_3_7,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed') AND (now() - created_at) > interval '7 days')::int AS age_7p,
        -- CSAT (last 90 days)
        ROUND(AVG(csat_rating) FILTER (WHERE csat_rating IS NOT NULL AND csat_at >= now() - interval '90 days')::numeric, 1) AS csat_avg,
        COUNT(*) FILTER (WHERE csat_rating IS NOT NULL AND csat_at >= now() - interval '90 days')::int AS csat_n
      FROM service_requests
      WHERE tenant_id = ${session.tenantId}::uuid
    `);

    // Per-assignee open load + breaches (owner accountability cut).
    const byAssignee = await tx.execute(sql`
      SELECT COALESCE(u.name, '— Unassigned —') AS assignee_name,
             COUNT(*)::int AS open_count,
             COUNT(*) FILTER (WHERE sr.sla_resolution_at < now())::int AS breached_count
      FROM service_requests sr
      LEFT JOIN users u ON u.id = sr.assigned_to_user_id
      WHERE sr.tenant_id = ${session.tenantId}::uuid
        AND sr.status NOT IN ('resolved','closed')
      GROUP BY COALESCE(u.name, '— Unassigned —')
      ORDER BY breached_count DESC, open_count DESC
      LIMIT 12
    `);
    const rmRows = await tx.execute(sql`
      SELECT id, name FROM users
      WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
      ORDER BY name ASC
    `);
    return { rows: rows.rows as any[], stats: stats.rows[0] as any, byAssignee: byAssignee.rows as any[], rms: rmRows.rows as any[] };
  });

  const s = result.stats;
  const rmOptions = (result.rms ?? []).map((r: any) => ({ value: String(r.id), label: r.name ?? "—" }));
  const respPct = Number(s.resp_total) > 0 ? Math.round((Number(s.resp_met) / Number(s.resp_total)) * 100) : null;
  const resoPct = Number(s.reso_total) > 0 ? Math.round((Number(s.reso_met) / Number(s.reso_total)) * 100) : null;

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
        <div className="flex items-center gap-3">
          <WorkSwitcher current="/dashboard/service-requests" />
          <Link href="/dashboard/service-requests/new" className="btn-primary">
            <Plus className="size-4" /> New ticket
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3">
        <Stat icon={LifeBuoy} label="Open" value={result.stats.open ?? 0} />
        <Stat icon={Clock} label="SLA at risk (<24h)" value={result.stats.at_risk ?? 0} tone={result.stats.at_risk > 0 ? "amber" : "muted"} />
        <Stat icon={AlertTriangle} label="SLA breached" value={result.stats.breached ?? 0} tone={result.stats.breached > 0 ? "rose" : "muted"} />
        <Stat icon={AlertTriangle} label="Escalated" value={result.stats.escalated ?? 0} tone={result.stats.escalated > 0 ? "rose" : "muted"} />
        <Stat icon={CheckCircle2} label="Avg TAT (MTD, days)" value={result.stats.avg_tat_days ?? "—"} tone="emerald" />
      </div>

      {/* SLA scorecard · aging · CSAT */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="card-surface p-5">
          <h3 className="font-semibold text-sm mb-3">SLA scorecard <span className="text-xs font-normal text-muted-foreground">(met %)</span></h3>
          <div className="space-y-3">
            <SlaBar label="First response" pct={respPct} />
            <SlaBar label="Resolution (TAT)" pct={resoPct} />
          </div>
        </div>
        <div className="card-surface p-5">
          <h3 className="font-semibold text-sm mb-3">Open ticket aging</h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            <AgeBucket label="0–2 days" value={Number(s.age_0_2)} tone="emerald" />
            <AgeBucket label="3–7 days" value={Number(s.age_3_7)} tone="amber" />
            <AgeBucket label="> 7 days" value={Number(s.age_7p)} tone="rose" />
          </div>
        </div>
        <div className="card-surface p-5">
          <h3 className="font-semibold text-sm mb-3">Client satisfaction <span className="text-xs font-normal text-muted-foreground">(90d)</span></h3>
          {Number(s.csat_n) > 0 ? (
            <div>
              <div className="text-3xl font-bold text-amber-500">{s.csat_avg}<span className="text-base text-muted-foreground"> / 5</span></div>
              <div className="text-xs text-muted-foreground mt-1">{s.csat_n} rating{Number(s.csat_n) === 1 ? "" : "s"}</div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No ratings yet — captured on resolved tickets.</p>
          )}
        </div>
      </div>

      {result.byAssignee.length > 0 && (
        <div className="card-surface p-5">
          <h3 className="font-semibold text-sm mb-3">Open tickets by assignee</h3>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 text-sm">
            {result.byAssignee.map((r: any) => (
              <li key={r.assignee_name} className="flex items-center justify-between gap-2">
                <span className="truncate">{r.assignee_name}</span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {Number(r.breached_count) > 0 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">{r.breached_count} breached</span>
                  )}
                  <span className="text-xs font-bold tabular-nums px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground min-w-[1.6rem] text-center">{r.open_count}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <FilterBar
        totalCount={result.rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search ticket #, subject, or client…" },
          dateRangeFilter("created", "Date"),
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
          {
            type: "select",
            key: "mine",
            label: "Owner",
            options: [{ value: "1", label: "My tickets" }],
          },
          ...(rmOptions.length
            ? [{ type: "multi" as const, key: "assignee", label: "Assignee", options: rmOptions }]
            : []),
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            <ColumnManager moduleKey="service-requests" columns={SR_COLUMNS} />
            <CustomViews
              viewsKey="views:service-requests"
              presets={[
                { id: "open", name: "Open + In-progress", params: "status=open,in_progress" },
                { id: "mine", name: "My open tickets", params: "mine=1&status=open,in_progress,waiting_customer" },
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

function SlaBar({ label, pct }: { label: string; pct: number | null }) {
  const tone = pct === null ? "bg-slate-300" : pct >= 90 ? "bg-emerald-500" : pct >= 70 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-bold tabular-nums">{pct === null ? "—" : `${pct}%`}</span>
      </div>
      <div className="h-2 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full ${tone} transition-all`} style={{ width: `${pct ?? 0}%` }} />
      </div>
    </div>
  );
}

function AgeBucket({ label, value, tone }: { label: string; value: number; tone: "emerald" | "amber" | "rose" }) {
  const color = tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-rose-600";
  return (
    <div className="rounded-md bg-secondary/40 py-2">
      <div className={`text-xl font-bold tabular-nums ${value > 0 ? color : "text-muted-foreground"}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
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
