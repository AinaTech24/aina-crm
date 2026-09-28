import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { eq, sql, inArray, isNull } from "drizzle-orm";
import {
  Plus,
  Sparkles,
  UserPlus,
  FileUp,
  Filter,
  LayoutGrid,
  List,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { leads, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { requireLeadView, leadScopeSql } from "@/lib/leads/access";

import { LeadsKanban } from "@/components/leads/LeadsKanban";
import { LeadsTable } from "@/components/leads/LeadsTable";
import { LeadsViewPersist } from "@/components/leads/LeadsViewPersist";
import { LeadQuickFilters } from "@/components/leads/LeadQuickFilters";
import { MoreMenu } from "@/components/common/MoreMenu";
import { buttonClass } from "@/components/ui/button-class";
import { cookies } from "next/headers";
import { LEAD_PIPELINE, LEAD_PIPELINE_STAGE_VALUES, leadPipelineColumn, leadStageDisplay } from "@/lib/leads/stages";
import { LEAD_SOURCE_OPTIONS } from "@/lib/leads/sources";
import { LEADS_VIEW_COOKIE, LEADS_LIST_THRESHOLD, parseLeadsView } from "@/lib/leads/view-pref";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { Pager } from "@/components/common/Pager";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { EmptyState } from "@/components/common/EmptyState";
import { RowActions } from "@/components/common/RowActions";
import { ColumnManager } from "@/components/common/ColumnManager";

/**
 * Kanban columns and stage filter options — the six-step pipeline from
 * src/lib/leads/stages.ts, the one place stage names are defined (the
 * dashboard's lead pipeline reads the same file). Each column's `aliases` are
 * the other stage values folded into it: the call-back loops, and legacy /
 * imported vocabularies.
 */
const STAGES = LEAD_PIPELINE.map((c) => ({
  key: c.key,
  label: c.label,
  tone: c.tone,
  aliases: c.members.filter((m) => m !== c.key),
}));

const LEAD_PHASE_STAGES = [...LEAD_PIPELINE_STAGE_VALUES];

/** Header "⋯": the other lead views the old "Module" dropdown switched to. */
const MORE_ITEMS = [
  { href: "/dashboard/pipeline-board", label: "Pipeline Board", description: "Separate stage flows for each sales process" },
  { href: "/dashboard/lifecycle", label: "Lead-to-client lifecycle", description: "Each lead's path through to becoming a client" },
  { href: "/dashboard/leads/nurture", label: "Lead Nurturing", description: "Keep not-yet-ready leads warm" },
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
  // Authorization: a role with no lead visibility is blocked here (defense in
  // depth — the sidebar already hides the module).
  requireLeadView(session);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const stageFilter = (sp.stage ?? "").split(",").filter(Boolean);
  const sourceFilter = (sp.source ?? "").split(",").filter(Boolean);
  const ownerFilter = (sp.owner ?? "").split(",").filter(Boolean);
  const branchFilter = (sp.branch ?? "").split(",").filter((v) => /^[0-9a-f-]{36}$/i.test(v));
  // Describes the active narrowing so the empty state can name it.
  const activeFilterLabel = [
    q ? `matching “${q}”` : "",
    ...stageFilter.map((s) => s.replace(/_/g, " ")),
    ...sourceFilter.map((s) => s.replace(/_/g, " ")),
  ]
    .filter(Boolean)
    .join(" · ");
  // Kanban or List: the URL's choice, else the one this browser saved, else by
  // size — past LEADS_LIST_THRESHOLD leads a board is columns of scrolling, so
  // a list is the better first view. (Decided inside the query, once the
  // count is known.)
  const requestedView =
    parseLeadsView(sp.view) ?? parseLeadsView((await cookies()).get(LEADS_VIEW_COOKIE)?.value);
  // Table sort: "score" (default — hottest first) or "recent". Both default to
  // descending; an explicit `dir` (set by re-clicking the column header) flips
  // to ascending so the user can see coldest leads / oldest-created first.
  const sortKey = sp.sort === "recent" ? "recent" : "score";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  // Pagination (table view). The kanban shows a bounded top-N slice.
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const PAGE_SIZE = 50;
  const KANBAN_CAP = 400;

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
      isNull(leads.convertedInvestorId),
      // Hide soft-deleted (archived) leads — they carry the __deleted__ sentinel.
      sql`leads.lost_reason IS DISTINCT FROM '__deleted__'`,
      // Role scope: RMs see only their own leads, branch heads only their
      // branch, owner/managers the whole book. RLS isolates by TENANT only, so
      // this owner/branch slice MUST be applied in the query (the API enforces
      // the same via leadScopeCondition — the page used to skip it, exposing the
      // whole firm's pipeline to every RM).
      leadScopeSql(session, "leads"),
    ];
    if (q) {
      conds.push(
        sql`(leads.name ILIKE ${`%${q}%`} OR leads.phone ILIKE ${`%${q}%`} OR leads.email ILIKE ${`%${q}%`} OR users.name ILIKE ${`%${q}%`})`
      );
    }
    if (stageFilter.length) {
      // Match the canonical key AND the legacy values folded onto it. Without
      // this, ?stage=call_done returns nothing for a firm whose rows still say
      // "contacted" — and every link that counts leads by canonical stage (the
      // dashboard's Lead pipeline, the kanban columns) would show a number the
      // filtered list then contradicts.
      const wanted = new Set<string>();
      for (const s of stageFilter) {
        wanted.add(s);
        const col = STAGES.find((c) => c.key === s);
        for (const a of col?.aliases ?? []) wanted.add(a);
      }
      conds.push(
        sql`leads.stage IN (${sql.join([...wanted].map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (sourceFilter.length)
      conds.push(sql`leads.source IN (${sql.join(sourceFilter.map((v) => sql`${v}`), sql`, `)})`);
    if (ownerFilter.length)
      conds.push(sql`leads.owner_id IN (${sql.join(ownerFilter.map((v) => sql`${v}::uuid`), sql`, `)})`);
    // Branch — the branch command centre's drill-down, with the same rule its
    // lead counts use (lib/dashboard/my/window.ts, leadsMatch): captured in the
    // branch, or — where no capture branch was recorded — owned by someone in
    // it. Only narrows; leadScopeSql above still applies.
    if (branchFilter.length) {
      const ids = sql.join(branchFilter.map((v) => sql`${v}::uuid`), sql`, `);
      conds.push(sql`(leads.branch_id IN (${ids})
        OR (leads.branch_id IS NULL AND leads.owner_id IN (SELECT id FROM users WHERE branch_id IN (${ids}))))`);
    }

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

    // The size rule looks at the whole book in scope, not the filtered result,
    // so narrowing a filter never flips the view underneath the user.
    let view = requestedView;
    if (!view) {
      const bookRes = await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(leads)
        .where(sql.join(conds.slice(0, 4), sql` AND `) as any);
      view = Number(bookRes[0]?.c ?? 0) > LEADS_LIST_THRESHOLD ? "table" : "kanban";
    }

    const baseQuery = tx
      .select({ lead: leads, owner: users.name })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.ownerId));
    // Default ordering: hottest (highest persisted score) first, recency as
    // tiebreaker. Index-backed via leads_score_idx (tenant_id, lead_score DESC).
    const dirSql = sql.raw(dir === "asc" ? "ASC" : "DESC");
    const orderBy =
      sortKey === "recent"
        ? sql`leads.updated_at ${dirSql}`
        : sql`leads.lead_score ${dirSql}, leads.updated_at DESC`;
    const isTable = view === "table";
    // Total matching count (for the table pager) — same predicate + join.
    const totalRes = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.ownerId))
      .where(whereClause as any);
    const total = Number(totalRes[0]?.c ?? 0);
    const rows = await baseQuery
      .where(whereClause as any)
      .orderBy(orderBy as any)
      .limit(isTable ? PAGE_SIZE : KANBAN_CAP)
      .offset(isTable ? (page - 1) * PAGE_SIZE : 0);
    // Roster for the "Owner (RM)" filter — so owners/managers can slice the
    // pipeline by the RM who owns each lead.
    const rmRows = await tx.execute(sql`
      SELECT id, name FROM users
      WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
      ORDER BY name ASC
    `);
    return { rows, rms: rmRows.rows as any[], total, view };
  });

  const rmOptions = (data.rms ?? []).map((r: any) => ({ value: String(r.id), label: r.name ?? "—" }));
  const view = data.view;
  // The view toggle keeps every other filter; only the page resets.
  const viewHref = (v: "kanban" | "table") => {
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries(sp)) if (val && k !== "view" && k !== "page") p.set(k, val);
    p.set("view", v);
    return `/dashboard/leads?${p.toString()}`;
  };

  // Enrich rows for the table view with a deterministic priority score, and
  // sort hottest-first by default (or most-recent when ?sort=recent).
  const toIso = (v: any) => (v ? new Date(v as any).toISOString() : null);
  const tableRows = data.rows.map((r) => {
    const l = r.lead as any;
    const column = leadPipelineColumn(l.stage);
    return {
      id: l.id,
      name: l.name,
      avatarUrl: l.avatarUrl ?? null,
      phone: l.phone ?? null,
      email: l.email ?? null,
      stage: l.stage,
      stageLabel: leadStageDisplay(l.stage),
      stageTone: column?.tone ?? "slate",
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
  if (sortKey === "score") tableRows.sort((a, b) => (dir === "asc" ? a.score - b.score : b.score - a.score));

  return (
    <div className="space-y-6">
      {/* Restores the last-used view (kanban/list) when arriving with no ?view param. */}
      <LeadsViewPersist explicitView={sp.view ?? null} />
      {/* Header */}
      <PageHeaderCard title={<><UserPlus className="size-6 text-muted-foreground" /> Leads</>} subtitle={<>Prospects you are working on, from first contact through to conversion.</>} actions={<><div className="flex gap-2 items-center">
          {/* One primary action, one secondary, the rest behind ⋯. The old
              "Module" dropdown (Pipeline Board, Lifecycle) lives in ⋯ now, and
              the Kanban / List toggle sits with the other view controls in the
              filter bar. */}
          <MoreMenu items={MORE_ITEMS} label="More lead views" />
          <Link href="/dashboard/leads/import" className={buttonClass("secondary")}>
            <FileUp className="size-4" /> Import
          </Link>
          <Link href="/dashboard/leads/new" className={buttonClass("primary")}>
            <Plus className="size-4" /> New lead
          </Link>
        </div></>} />

      <div className="card-surface p-2.5 space-y-2.5 relative z-30">
      <CompactFilterBar
        bare
        totalCount={data.total}
        searchPlaceholder="Search lead by name, phone, email…"
        filters={[
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
            options: [...LEAD_SOURCE_OPTIONS],
          },
          ...(rmOptions.length
            ? [{ type: "multi" as const, key: "owner", label: "Owner (RM)", options: rmOptions }]
            : []),
          dateRangeFilter("created", "Created"),
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            {/* View toggle — Kanban vs List. The choice is remembered. */}
            <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5" role="group" aria-label="View">
              <Link
                href={viewHref("kanban")}
                aria-current={view === "kanban" ? "true" : undefined}
                className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${view === "kanban"
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                <LayoutGrid className="size-3.5" /> Kanban
              </Link>
              <Link
                href={viewHref("table")}
                aria-current={view === "table" ? "true" : undefined}
                className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${view === "table"
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                <List className="size-3.5" /> List
              </Link>
            </div>
            {view === "table" && (
              <ColumnManager compact moduleKey="leads" columns={LEADS_COLUMNS} />
            )}
            <CustomViews
              compact
              viewsKey="views:leads"
              presets={[
                {
                  id: "open",
                  name: "All open",
                  // Column keys: each one also matches the stages folded into it.
                  params: "stage=new,call_done,meeting_scheduled,meeting_done,won_lead",
                },
                { id: "referrals", name: "Referrals only", params: "source=referral,existing_client" },
                { id: "won", name: "Won", params: "stage=won_lead" },
                { id: "lost", name: "Lost", params: "stage=not_qualified" },
              ]}
            />
          </div>
        }
      />
      <LeadQuickFilters sources={LEAD_SOURCE_OPTIONS} rms={rmOptions} />
      </div>

      {/* Kanban — drag-and-drop enabled. Show a friendly empty-state when
          there are no leads yet AND no filters are active, so a brand-new
          tenant sees a clear "Add your first lead" path. */}
      {data.rows.length === 0 && !q && stageFilter.length === 0 && sourceFilter.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No leads yet — let's add the first one"
          description="A lead is anyone who's shown interest in your services but hasn't invested yet. The CRM tracks them from New through Contacted and Meeting to Won."
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
              <span>
                {data.total} total leads{data.total > data.rows.length ? ` · showing top ${data.rows.length}` : ""}
              </span>
            </div>
            <span className="text-2xs text-muted-foreground">
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
          {/* Name what was filtered on, so an empty result reads as "this filter
              found nothing" rather than "the list is broken". */}
          {activeFilterLabel ? (
            <>
              No <span className="font-medium text-foreground">{activeFilterLabel}</span> leads.{" "}
              <Link href="/dashboard/leads" className="text-brand-cyan-deep hover:underline">
                Clear filters
              </Link>
            </>
          ) : (
            <>
              No leads match these filters.{" "}
              <Link href="/dashboard/leads/new" className="text-brand-cyan-deep hover:underline">
                Add one manually
              </Link>
            </>
          )}
          .
        </div>
      ) : (
        <div>
          <LeadsTable rows={tableRows} sort={sortKey} dir={dir} />
          <Pager page={page} totalPages={Math.ceil(data.total / PAGE_SIZE)} total={data.total} pageSize={PAGE_SIZE} />
        </div>
      )}

    </div>
  );
}
