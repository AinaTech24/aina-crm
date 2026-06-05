import Link from "next/link";
import { eq, sql, inArray, isNull } from "drizzle-orm";
import {
  Plus,
  Sparkles,
  Users,
  Target,
  TrendingUp,
  UploadCloud,
  Filter,
  Flame,
  AlertCircle,
  IndianRupee,
  LayoutGrid,
  List,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { leads, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatINR, formatDate } from "@/lib/utils";
import { LeadsKanban } from "@/components/leads/LeadsKanban";
import { LeadsTable } from "@/components/leads/LeadsTable";
import { LeadQuickFilters } from "@/components/leads/LeadQuickFilters";
import { LeadInsightsSection } from "@/components/leads/LeadInsightsSection";
import { FilterBar } from "@/components/common/FilterBar";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { EmptyState } from "@/components/common/EmptyState";
import { RowActions } from "@/components/common/RowActions";
import { ColumnManager } from "@/components/common/ColumnManager";

/**
 * Pipeline columns — exact mirror of the 12 lead-phase blueprint stages
 * (stages 1-12 of LEAD_TO_CLIENT_STAGES, before the Convert-to-Client
 * boundary). The platform now speaks a single vocabulary: stage ===
 * blueprint stage. Drag-drop here calls the blueprint advance engine.
 *
 * Aliases fold legacy stage values from before the unification onto the
 * canonical blueprint key.
 */
/**
 * Kanban columns — 10 lead-phase blueprint stages. Aliases fold legacy
 * stage values onto the canonical key so historic leads land in the
 * right column.
 */
const STAGES = [
  { key: "new", label: "New", tone: "blue", aliases: [] as string[] },
  { key: "call_done", label: "Call Done", tone: "cyan", aliases: ["contacted", "first_call_pending"] },
  { key: "call_back_later", label: "Call Back Later", tone: "cyan", aliases: [] },
  { key: "call_not_connected", label: "Call Not Connected", tone: "slate", aliases: [] },
  { key: "contact_in_future", label: "Contact in Future", tone: "slate", aliases: ["follow_up"] },
  { key: "meeting_scheduled", label: "Meeting Scheduled", tone: "amber", aliases: ["appointment_scheduled", "qualified"] },
  { key: "meeting_pending", label: "Meeting Pending", tone: "amber", aliases: [] },
  { key: "meeting_done", label: "Meeting Done", tone: "indigo", aliases: ["meeting_done"] },
  { key: "won_lead", label: "Won Lead", tone: "emerald", aliases: ["converted", "post_meeting_qualified"] },
  { key: "not_qualified", label: "Not Qualified", tone: "rose", aliases: ["lost", "not_interested", "cold"] },
] as const;

const LEAD_PHASE_STAGES = [
  "new",
  "call_done", "contacted", "first_call_pending",
  "call_back_later",
  "call_not_connected",
  "contact_in_future", "follow_up",
  "meeting_scheduled", "appointment_scheduled", "qualified",
  "meeting_pending",
  "meeting_done",
  "won_lead", "converted", "post_meeting_qualified",
  "not_qualified", "lost", "not_interested", "cold"
];

const LEADS_COLUMNS = [
  { key: "score", label: "Score" },
  { key: "name", label: "Name", required: true },
  { key: "stage", label: "Stage" },
  { key: "intendedAmount", label: "Intended Amount" },
  { key: "source", label: "Source" },
  { key: "nextFollowUpAt", label: "Next Follow-Up" },
  { key: "lastContactAt", label: "Last Contacted" },
  { key: "owner", label: "Owner (RM)" },
  { key: "createdAt", label: "Created At" },
  { key: "actions", label: "Actions", required: true },
];

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const stageFilter = (sp.stage ?? "").split(",").filter(Boolean);
  const sourceFilter = (sp.source ?? "").split(",").filter(Boolean);
  const ownerFilter = (sp.owner ?? "").split(",").filter(Boolean);
  const view = sp.view === "table" ? "table" : "kanban";
  // Table sort: "score" (default — hottest first) or "recent".
  const sortKey = sp.sort === "recent" ? "recent" : "score";

  // Quick-filter chip params (from LeadQuickFilters)
  const qf = {
    mine: sp.mine === "1",
    unassigned: sp.unassigned === "1",
    hot: sp.hot === "1",
    stuck: sp.stuck === "1",
    followup_today: sp.followup_today === "1",
    followup_overdue: sp.followup_overdue === "1",
    new_week: sp.new_week === "1",
  };
  const userId = session.userId;

  const data = await withTenant(session.tenantId, async (tx) => {
    const conds: any[] = [
      inArray(leads.stage, LEAD_PHASE_STAGES as any),
      isNull(leads.convertedInvestorId)
    ];
    if (q) {
      conds.push(
        sql`(leads.name ILIKE ${`%${q}%`} OR leads.phone ILIKE ${`%${q}%`} OR leads.email ILIKE ${`%${q}%`} OR users.name ILIKE ${`%${q}%`})`
      );
    }
    if (stageFilter.length) {
      conds.push(sql`leads.stage IN (${sql.join(stageFilter.map((v) => sql`${v}`), sql`, `)})`);
    }
    if (sourceFilter.length)
      conds.push(sql`leads.source IN (${sql.join(sourceFilter.map((v) => sql`${v}`), sql`, `)})`);
    if (ownerFilter.length)
      conds.push(sql`leads.owner_id IN (${sql.join(ownerFilter.map((v) => sql`${v}::uuid`), sql`, `)})`);

    // Quick-filter conditions — each adds a constraint; AND-combined.
    if (qf.mine) conds.push(sql`leads.owner_id = ${userId}`);
    if (qf.unassigned) conds.push(sql`leads.owner_id IS NULL`);
    // "Hot" now means a high deterministic score (persisted), not just a
    // late-funnel stage — so a fresh referral with a scheduled meeting ranks
    // hot even before it advances.
    if (qf.hot) {
      conds.push(sql`leads.score_band = 'hot'`);
    }
    if (qf.stuck) {
      conds.push(
        sql`COALESCE(leads.stage_changed_at, leads.updated_at, leads.created_at) < now() - interval '14 days'`
      );
    }
    if (qf.followup_today) {
      conds.push(sql`leads.next_follow_up_at::date = current_date`);
    }
    if (qf.followup_overdue) {
      conds.push(sql`leads.next_follow_up_at IS NOT NULL AND leads.next_follow_up_at < now()`);
    }
    if (qf.new_week) {
      conds.push(sql`leads.created_at >= now() - interval '7 days'`);
    }
    const dr = dateRangeCond(sp, "created", "leads.created_at");
    if (dr) conds.push(dr);

    const whereClause: any = sql.join(conds, sql` AND `);

    const baseQuery = tx
      .select({ lead: leads, owner: users.name })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.ownerId));
    // Default ordering: hottest (highest persisted score) first, recency as
    // tiebreaker. Index-backed via leads_score_idx (tenant_id, lead_score DESC).
    const orderBy =
      sortKey === "recent"
        ? sql`leads.updated_at DESC`
        : sql`leads.lead_score DESC, leads.updated_at DESC`;
    const rows = await baseQuery.where(whereClause as any).orderBy(orderBy as any);
    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (
          WHERE stage IN (
            'new', 'call_done', 'contacted', 'first_call_pending', 'call_back_later',
            'call_not_connected', 'contact_in_future', 'follow_up', 'meeting_scheduled',
            'appointment_scheduled', 'qualified', 'meeting_pending', 'meeting_done',
            'won_lead', 'post_meeting_qualified'
          ) AND converted_investor_id IS NULL
        )::int AS open_count,
        COUNT(*) FILTER (
          WHERE created_at >= now() - interval '7 days' AND converted_investor_id IS NULL
        )::int AS new_this_week,
        COUNT(*) FILTER (
          WHERE converted_investor_id IS NOT NULL AND converted_at >= date_trunc('month', now())
        )::int AS converted_mtd,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE converted_investor_id IS NOT NULL
        )::int AS converted_total,
        ROUND(
          100.0 * COUNT(*) FILTER (
            WHERE converted_investor_id IS NOT NULL
          )
          / NULLIF(COUNT(*), 0),
        1) AS conv_pct,
        COALESCE(SUM(
          COALESCE(
            expected_business_amount,
            NULLIF(regexp_replace(COALESCE(intended_amount, ''), '[^0-9.]', '', 'g'), '')::numeric
          )
        ) FILTER (
          WHERE converted_investor_id IS NULL
            AND stage = ANY(ARRAY[
              'new','call_done','contacted','first_call_pending','call_back_later',
              'call_not_connected','contact_in_future','follow_up','meeting_scheduled',
              'appointment_scheduled','qualified','meeting_pending','meeting_done',
              'won_lead','post_meeting_qualified'
            ])
        ), 0)::numeric AS pipeline_value,
        COUNT(*) FILTER (
          WHERE converted_investor_id IS NULL
            AND stage IN (
              'meeting_scheduled','meeting_done','won_lead','post_meeting_qualified',
              'proposal_shared','proposal_approved','risk_profiled','docs_received'
            )
            AND (last_contact_at IS NULL OR last_contact_at >= now() - interval '7 days')
        )::int AS hot_count,
        COUNT(*) FILTER (
          WHERE converted_investor_id IS NULL
            AND next_follow_up_at IS NOT NULL
            AND next_follow_up_at < now()
        )::int AS overdue_count,
        (
          SELECT ROUND(AVG(EXTRACT(EPOCH FROM (converted_at - created_at)) / 86400)::numeric, 1)
          FROM leads
          WHERE converted_investor_id IS NOT NULL
            AND converted_at >= now() - interval '90 days'
        ) AS avg_days_to_convert
      FROM leads
    `);
    // Roster for the "Owner (RM)" filter — so owners/managers can slice the
    // pipeline by the RM who owns each lead.
    const rmRows = await tx.execute(sql`
      SELECT id, name FROM users
      WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
      ORDER BY name ASC
    `);
    return { rows, s: stats.rows[0] as any, rms: rmRows.rows as any[] };
  });

  const rmOptions = (data.rms ?? []).map((r: any) => ({ value: String(r.id), label: r.name ?? "—" }));

  // Enrich rows for the table view with a deterministic priority score, and
  // sort hottest-first by default (or most-recent when ?sort=recent).
  const toIso = (v: any) => (v ? new Date(v as any).toISOString() : null);
  const tableRows = data.rows.map((r) => {
    const l = r.lead as any;
    const stageObj = STAGES.find(
      (s) => s.key === l.stage || (s.aliases as readonly string[]).includes(l.stage)
    );
    return {
      id: l.id,
      name: l.name,
      phone: l.phone ?? null,
      email: l.email ?? null,
      stage: l.stage,
      stageLabel: stageObj?.label ?? l.stage,
      stageTone: stageObj?.tone ?? "slate",
      source: l.source,
      intendedAmount: l.intendedAmount ?? null,
      nextFollowUpAt: toIso(l.nextFollowUpAt),
      lastContactAt: toIso(l.lastContactAt),
      createdAt: toIso(l.createdAt),
      owner: r.owner ?? null,
      // Persisted deterministic score (src/lib/leads/score.ts) — written on
      // create + every stage transition, backfilled for historic rows.
      score: l.leadScore ?? 0,
    };
  });
  if (sortKey === "score") tableRows.sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <Sparkles className="size-6 text-brand-cyan" /> Leads
          </h1>
          <p className="page-subtitle">
            Drip-nurtured, UTM-tagged, owner-attributed pipeline · 10 stages · pipeline ₹{" "}
            {formatINR(Number(data.s.pipeline_value ?? 0))}.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {/* View toggle — Kanban vs List */}
          <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5 mr-1">
            <Link
              href="/dashboard/leads"
              className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                view === "kanban"
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="size-3.5" /> Kanban
            </Link>
            <Link
              href="/dashboard/leads?view=table"
              className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                view === "table"
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <List className="size-3.5" /> List
            </Link>
          </div>

          {view === "table" && (
            <ColumnManager moduleKey="leads" columns={LEADS_COLUMNS} />
          )}

          <Link href="/dashboard/leads/import" className="btn-secondary text-xs">
            <UploadCloud className="size-3.5" /> Import Excel
          </Link>
          <Link href="/dashboard/leads/new" className="btn-primary">
            <Plus className="size-4" /> New lead
          </Link>
        </div>
      </div>

      {/* KPI strip — original 4 + 4 new (pipeline / hot / overdue / avg days) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile
          label="Open Leads"
          value={String(data.s.open_count ?? 0)}
          sub={`${data.s.total ?? 0} all-time`}
          icon={Users}
          accent="cyan"
        />
        <KpiTile
          label="New this Week"
          value={String(data.s.new_this_week ?? 0)}
          sub="last 7 days"
          icon={Sparkles}
          accent="violet"
        />
        <KpiTile
          label="Converted MTD"
          value={String(data.s.converted_mtd ?? 0)}
          sub={`${data.s.converted_total ?? 0} lifetime`}
          icon={Target}
          accent="emerald"
        />
        <KpiTile
          label="Conversion %"
          value={data.s.conv_pct != null ? `${Number(data.s.conv_pct).toFixed(1)}%` : "—"}
          sub="overall"
          icon={TrendingUp}
          accent="emerald"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile
          label="Pipeline value"
          value={formatINR(Number(data.s.pipeline_value ?? 0))}
          sub="open leads · expected ₹"
          icon={IndianRupee}
          accent="emerald"
        />
        <KpiTile
          label="🔥 Hot leads"
          value={String(data.s.hot_count ?? 0)}
          sub="late funnel + active"
          icon={Flame}
          accent="amber"
        />
        <KpiTile
          label="Overdue follow-ups"
          value={String(data.s.overdue_count ?? 0)}
          sub={data.s.overdue_count > 0 ? "action needed" : "all clear"}
          icon={AlertCircle}
          accent="amber"
        />
        <KpiTile
          label="Avg days to convert"
          value={
            data.s.avg_days_to_convert != null
              ? `${Number(data.s.avg_days_to_convert).toFixed(1)}d`
              : "—"
          }
          sub="last 90 days"
          icon={Target}
          accent="cyan"
        />
      </div>

      {/* Quick-filter chip strip — server-side counts, deep links into same page */}
      <div className="card-surface p-3">
        <LeadQuickFilters session={session} active={sp as Record<string, string | undefined>} />
      </div>

      <FilterBar
        totalCount={data.rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search lead by name, phone, email…" },
          {
            type: "multi",
            key: "stage",
            label: "Stage",
            options: STAGES.map((s) => ({ value: s.key, label: s.label })),
          },
          {
            type: "multi",
            key: "source",
            label: "Source",
            options: [
              { value: "referral", label: "Client Referral" },
              { value: "existing_client", label: "Existing Client Reference" },
              { value: "website", label: "Website" },
              { value: "social_media", label: "Social Media" },
              { value: "webinar", label: "Webinar" },
              { value: "seminar", label: "Seminar" },
              { value: "walk_in", label: "Walk-in" },
              { value: "google", label: "Google" },
              { value: "cold_call", label: "Cold Call" },
              { value: "manual", label: "Manual entry" },
              { value: "other", label: "Other" },
            ],
          },
          ...(rmOptions.length
            ? [{ type: "multi" as const, key: "owner", label: "Owner (RM)", options: rmOptions }]
            : []),
          dateRangeFilter("created", "Created"),
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:leads"
            presets={[
              {
                id: "open",
                name: "All open",
                params: "stage=new,call_done,call_back_later,call_not_connected,contact_in_future,meeting_scheduled,meeting_pending,meeting_done,won_lead",
              },
              { id: "referrals", name: "Referrals only", params: "source=referral,existing_client" },
              { id: "won", name: "Won leads", params: "stage=won_lead,converted" },
              { id: "lost", name: "Not qualified / lost", params: "stage=not_qualified,lost,not_interested" },
            ]}
          />
        }
      />

      {/* Kanban — drag-and-drop enabled. Show a friendly empty-state when
          there are no leads yet AND no filters are active, so a brand-new
          tenant sees a clear "Add your first lead" path. */}
      {data.rows.length === 0 && !q && stageFilter.length === 0 && sourceFilter.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No leads yet — let's add the first one"
          description="A lead is anyone who's shown interest in your services but hasn't invested yet. The CRM tracks them through 8 stages from First Contact to Converted."
          tip="Click + at the top right to add manually, or import an Excel file of leads in seconds."
          primary={{ href: "/dashboard/leads/new", label: "+ Add first lead" }}
          secondary={{ href: "/dashboard/leads/import", label: "Import from Excel" }}
        />
      ) : view === "kanban" ? (
        <div className="card-surface p-3">
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Filter className="size-3.5" />
              <span className="font-medium">Pipeline view</span>
              <span>·</span>
              <span>{data.rows.length} total leads</span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              Drag a card to move it between stages
            </span>
          </div>
          <LeadsKanban
            stages={STAGES.map((s) => ({ ...s, aliases: [...s.aliases] }))}
            initialRows={data.rows.map((r) => ({
              lead: {
                id: r.lead.id,
                name: r.lead.name,
                phone: (r.lead as any).phone ?? null,
                stage: r.lead.stage,
                source: r.lead.source,
                updatedAt: r.lead.updatedAt,
                stageChangedAt: r.lead.stageChangedAt
                  ? new Date(r.lead.stageChangedAt as any).toISOString()
                  : null,
                createdAt: r.lead.createdAt
                  ? new Date(r.lead.createdAt as any).toISOString()
                  : null,
                lastContactAt: r.lead.lastContactAt
                  ? new Date(r.lead.lastContactAt as any).toISOString()
                  : null,
                lastFollowUpAt: r.lead.lastFollowUpAt
                  ? new Date(r.lead.lastFollowUpAt as any).toISOString()
                  : null,
                nextFollowUpAt: r.lead.nextFollowUpAt
                  ? new Date(r.lead.nextFollowUpAt as any).toISOString()
                  : null,
                intendedAmount: r.lead.intendedAmount ?? null,
                convertedInvestorId: r.lead.convertedInvestorId ?? null,
                utmParams: r.lead.utmParams ?? null,
              },
              owner: r.owner ?? null,
            }))}
          />
        </div>
      ) : data.rows.length === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          No leads match these filters.{" "}
          <Link href="/dashboard/leads/new" className="text-brand-cyan-deep hover:underline">
            Add one manually
          </Link>
          .
        </div>
      ) : (
        <LeadsTable rows={tableRows} sort={sortKey} />
      )}

      {/* ---------- Lead Insights — pipeline analytics ---------- */}
      <LeadInsightsSection session={session} />
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: any;
  accent: "cyan" | "violet" | "emerald" | "amber";
}) {
  const bg: Record<string, string> = {
    cyan: "bg-brand-cyan-light text-brand-cyan-deep",
    violet: "bg-violet-50 text-violet-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
  };
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        <div className={`size-8 rounded-lg grid place-items-center ${bg[accent]}`}>
          <Icon className="size-4" />
        </div>
      </div>
      <div className="text-2xl font-bold mt-2 tabular-nums tracking-tight">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
