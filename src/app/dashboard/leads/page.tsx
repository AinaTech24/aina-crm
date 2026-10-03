import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
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
import { branches, customFieldDefs, investors, leads, subDistributors, users } from "@/db/schema";
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
import { dateRangeFilter } from "@/lib/filters/date-range";
import { leadCreatedInSql, leadOpenSql, leadStageKeySql, leadWhere, textList } from "@/lib/metrics";
import { CustomViews } from "@/components/common/CustomViews";
import { EmptyState } from "@/components/common/EmptyState";
import { RowActions } from "@/components/common/RowActions";
import { ColumnManager } from "@/components/common/ColumnManager";
import { leadExtraCells, leadExtraColumns, type LeadCustomFieldDef } from "@/lib/leads/table-columns";
import { leadFieldFilterConds, leadFieldFilterDefs, loadLeadFilterOptions } from "@/lib/leads/field-filters";

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

/**
 * A lead ON THE BOARD: not converted, and its stored stage (trimmed, lower
 * case — as lib/metrics/leads.ts leadStageKeySql reads it) is one of the
 * columns' values, legacy ones included, or blank (New) or the insurance
 * branch's "not proceeded" (Lost). What is left — converted leads and leads
 * already in onboarding — is the rest of the dashboard's Won bucket, which
 * `include_won=1` adds.
 */
const BOARD_STAGE_VALUES = [...LEAD_PIPELINE_STAGE_VALUES, "", "insurance_lost"];
const ON_BOARD = sql`(leads.converted_investor_id IS NULL
  AND lower(btrim(COALESCE(leads.stage::text, ''))) IN (${textList(BOARD_STAGE_VALUES)}))`;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Header "⋯": the other lead views the old "Module" dropdown switched to. */
const MORE_ITEMS = [
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
];
// Every other lead field follows (lib/leads/table-columns.ts), then Actions.
const ACTIONS_COLUMN = { key: "actions", label: "Actions", required: true };

/** The lead who referred this one may be a client: their name, when no name was typed. */
const referredClient = alias(investors, "referred_client");

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
  // include_won=1 — the dashboard's Won count: converted leads and leads
  // already in onboarding too, which are not on the board.
  const includeWon = sp.include_won === "1";
  // followup_due=1 — the dashboard's "need follow-up today".
  const followupDue = sp.followup_due === "1";
  const createdFrom = ISO_DATE.test(sp.created_from ?? "") ? sp.created_from! : "";
  const createdTo = ISO_DATE.test(sp.created_to ?? "") ? sp.created_to! : "";
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
  // A Won drill-down (include_won=1) opens as a list unless the URL asks for
  // the board: converted and onboarding leads have no column to sit in.
  const requestedView =
    parseLeadsView(sp.view) ??
    (includeWon ? "table" : parseLeadsView((await cookies()).get(LEADS_VIEW_COOKIE)?.value));
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
  // Any narrowing at all (a dashboard drill-down included) — an empty result
  // then reads "no matches", never "no leads yet".
  const filtering = !!q || stageFilter.length > 0 || sourceFilter.length > 0 || ownerFilter.length > 0
    || branchFilter.length > 0 || includeWon || followupDue || !!createdFrom || !!createdTo
    || Object.values(qf).some(Boolean);

  const data = await withTenant(session.tenantId, async (tx) => {
    // The whole book in scope, before any filter: tenant, not soft-deleted
    // (archived leads carry the __deleted__ sentinel — lib/metrics leadWhere),
    // on the board, and the role scope — RMs see only their own leads, branch
    // heads only their branch, owner/managers the whole book. RLS isolates by
    // TENANT only, so this owner/branch slice MUST be applied in the query (the
    // API enforces the same via leadScopeCondition — the page used to skip it,
    // exposing the whole firm's pipeline to every RM).
    const bookConds: any[] = [
      leadWhere({ tenantId: session.tenantId }, "leads"),
      ON_BOARD,
      leadScopeSql(session, "leads"),
    ];
    // include_won=1 lifts "on the board" only; deletion and role scope stay.
    const conds: any[] = includeWon ? [bookConds[0], bookConds[2]] : [...bookConds];
    // The firm's own lead fields — one list column and one filter each.
    const customDefs: (LeadCustomFieldDef & { options: string[] | null })[] = await tx
      .select({ key: customFieldDefs.key, label: customFieldDefs.label, type: customFieldDefs.type, options: customFieldDefs.options })
      .from(customFieldDefs)
      .where(sql`${customFieldDefs.tenantId} = ${session.tenantId}::uuid AND ${customFieldDefs.entity} = 'lead'`)
      .orderBy(asc(customFieldDefs.sortOrder), asc(customFieldDefs.label));
    // Every other lead field's filter (lib/leads/field-filters.ts).
    const fieldConds = leadFieldFilterConds(sp, customDefs);
    conds.push(...fieldConds);
    if (q) {
      conds.push(
        sql`(leads.name ILIKE ${`%${q}%`} OR leads.phone ILIKE ${`%${q}%`} OR leads.email ILIKE ${`%${q}%`} OR users.name ILIKE ${`%${q}%`})`
      );
    }
    if (stageFilter.length) {
      // stage=<column key> — the dashboard's Lead pipeline counts: the column a
      // lead sits in, exactly as lib/metrics/leads.ts leadStageKeySql decides it,
      // so every stored value folded into the column matches (legacy
      // "contacted", "qualified", mixed case…). A legacy value in the URL
      // (?stage=contacted) means its column. Without this, ?stage=call_done
      // returned nothing for a firm whose rows still say "contacted".
      const keys = [...new Set(stageFilter.map((s) => leadPipelineColumn(s)?.key ?? s))];
      conds.push(sql`(${leadStageKeySql("leads")}) IN (${textList(keys)})`);
    }
    // owner / branch / source — the dashboard's lead scope, with its rules
    // (lib/metrics leadWhere): branch = captured in the branch or, where no
    // capture branch was recorded, owned by someone in it. Only narrows;
    // leadScopeSql above still applies.
    if (sourceFilter.length || ownerFilter.length || branchFilter.length) {
      conds.push(leadWhere({
        tenantId: session.tenantId, rmIds: ownerFilter, branchIds: branchFilter, leadSources: sourceFilter,
      }, "leads"));
    }
    // followup_due=1 — the dashboard's "need follow-up today" (getOpenLeads):
    // open leads whose next follow-up falls today or earlier, India dates.
    if (followupDue) {
      conds.push(sql`${leadOpenSql("leads")} AND leads.next_follow_up_at IS NOT NULL
        AND (leads.next_follow_up_at AT TIME ZONE 'Asia/Kolkata')::date <= (now() AT TIME ZONE 'Asia/Kolkata')::date`);
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
    // created_from / created_to — the dashboard's period: the India date the
    // lead was created on, both ends inclusive (lib/metrics leadCreatedInSql).
    if (createdFrom || createdTo) {
      conds.push(leadCreatedInSql({ from: createdFrom || "1900-01-01", to: createdTo || "9999-12-31" }, "leads"));
    }

    const whereClause: any = sql.join(conds, sql` AND `);

    // The size rule looks at the whole book in scope, not the filtered result,
    // so narrowing a filter never flips the view underneath the user.
    let view = requestedView;
    if (!view) {
      const bookRes = await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(leads)
        .where(sql.join(bookConds, sql` AND `) as any);
      view = Number(bookRes[0]?.c ?? 0) > LEADS_LIST_THRESHOLD ? "table" : "kanban";
    }

    const baseQuery = tx
      .select({
        lead: leads,
        owner: users.name,
        branch: branches.name,
        subDistributor: subDistributors.name,
        referredClient: referredClient.name,
      })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.ownerId))
      .leftJoin(branches, eq(branches.id, leads.branchId))
      .leftJoin(subDistributors, eq(subDistributors.id, leads.subDistributorId))
      .leftJoin(referredClient, eq(referredClient.id, leads.referredByInvestorId));
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
    // Pick lists for the field filters — values from the viewer's own book
    // (not deleted, role scope), won and lost leads included.
    const filterOptions = await loadLeadFilterOptions(tx, session.tenantId, sql.join([bookConds[0], bookConds[2]], sql` AND `));
    return { rows, rms: rmRows.rows as any[], total, view, customDefs, filterOptions, fieldFilterCount: fieldConds.length };
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
  const extraColumns = leadExtraColumns(data.customDefs);
  const anyFiltering = filtering || data.fieldFilterCount > 0;
  const columnDefs = [
    ...LEADS_COLUMNS,
    ...extraColumns.map((c) => ({ key: c.key, label: c.label, group: c.group })),
    ACTIONS_COLUMN,
  ];
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
      cells: leadExtraCells(
        l,
        { branch: r.branch ?? null, subDistributor: r.subDistributor ?? null, referredClient: r.referredClient ?? null },
        data.customDefs,
      ),
    };
  });
  if (sortKey === "score") tableRows.sort((a, b) => (dir === "asc" ? a.score - b.score : b.score - a.score));

  return (
    <div className="space-y-6">
      {/* Restores the last-used view (kanban/list) when arriving with no ?view param. */}
      <LeadsViewPersist explicitView={sp.view ?? null} />
      {/* Header */}
      <PageHeaderCard title={<><UserPlus className="size-6 text-muted-foreground" /> Leads</>} actions={<><div className="flex gap-2 items-center">
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
          ...leadFieldFilterDefs(data.filterOptions, data.customDefs),
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
              <ColumnManager compact moduleKey="leads" columns={columnDefs} />
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
      {data.rows.length === 0 && !anyFiltering ? (
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
          <LeadsTable rows={tableRows} extraColumns={extraColumns} sort={sortKey} dir={dir} />
          <Pager page={page} totalPages={Math.ceil(data.total / PAGE_SIZE)} total={data.total} pageSize={PAGE_SIZE} />
        </div>
      )}

    </div>
  );
}
