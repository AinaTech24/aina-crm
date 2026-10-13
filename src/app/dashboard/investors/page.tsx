import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { Plus, LayoutGrid, List, FileUp, CopyPlus, ArrowRight } from "lucide-react";
import { and, asc, desc, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { customFieldDefs, investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { investorScopeCondition, investorScopeSql, requireInvestorView } from "@/lib/investors/access";
import { RecomputeTiersButton } from "@/components/investors/RecomputeTiersButton";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { dateRangeFilter } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { EmptyState } from "@/components/common/EmptyState";
import { Users } from "lucide-react";
import { InvestorsKanban, type InvestorRow } from "@/components/investors/InvestorsKanban";
import { ColumnManager } from "@/components/common/ColumnManager";
import { loadTenantLicense } from "@/lib/auth/license";
import { isFieldAllowed } from "@/lib/auth/field-gate";
import { dormancyDays, type HealthBand } from "@/lib/investors/health";
import { InvestorsTable, type InvestorTableRow } from "@/components/investors/InvestorsTable";
import { InvestorSortSelect } from "@/components/investors/InvestorSortSelect";
import { buildInvestorWhere } from "@/lib/investors/list-filters";
import { investorFieldFilterDefs, loadInvestorFilterOptions, type InvestorCustomFieldDef } from "@/lib/investors/field-filters";
import { Pager } from "@/components/common/Pager";
import { countPossibleDuplicates } from "@/lib/investors/duplicates";
import { clientCompleteness } from "@/lib/investors/completeness";
import { ExportButton } from "@/components/export/ExportButton";
import { RecordMenu, RecordMenuSeparator } from "@/components/common/RecordMenu";
import { TableDensitySwitch } from "@/components/common/TableDensityToggle";
import { buttonClass } from "@/components/ui/button-class";
import { MENU_ICON, MENU_ITEM } from "@/components/ui/menu-item-class";
import { formatMoney } from "@/lib/format";
import type { MassUpdateOptions } from "@/components/investors/MassUpdateDialog";
import { ensureHealthFresh } from "@/lib/metrics/health";

/** AUM bands for the filter: lower bound inclusive, upper exclusive. */
const AUM_PRESETS = [
  { label: "No AUM", max: 1 },
  { label: "Under ₹1 L", min: 1, max: 1e5 },
  { label: "₹1 L – ₹10 L", min: 1e5, max: 1e6 },
  { label: "₹10 L – ₹50 L", min: 1e6, max: 5e6 },
  { label: "₹50 L – ₹1 Cr", min: 5e6, max: 1e7 },
  { label: "₹1 Cr – ₹5 Cr", min: 1e7, max: 5e7 },
  { label: "₹5 Cr and above", min: 5e7 },
];

const INVESTORS_COLUMNS = [
  { key: "name", label: "Name", required: true },
  { key: "pan", label: "PAN" },
  { key: "category", label: "Category" },
  { key: "tier", label: "Tier" },
  { key: "segment", label: "Segment" },
  { key: "aum", label: "AUM" },
  { key: "sip", label: "Monthly SIP" },
  { key: "kyc", label: "KYC" },
  { key: "health", label: "Health" },
  { key: "complete", label: "Profile %" },
  { key: "status", label: "Status" },
  { key: "actions", label: "Actions", required: true },
];

export const dynamic = "force-dynamic";

export default async function InvestorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const license = await loadTenantLicense(session.tenantId, session.roles);
  const showPan = isFieldAllowed(license, "investor", "pan");
  const showAum = isFieldAllowed(license, "investor", "aum");
  const showSip = isFieldAllowed(license, "investor", "active_sip_amount") || isFieldAllowed(license, "investor", "sip");
  const showKyc = isFieldAllowed(license, "investor", "kyc_status") || isFieldAllowed(license, "investor", "kyc");
  const showStatus = isFieldAllowed(license, "investor", "status");
  const showTier = isFieldAllowed(license, "investor", "service_tier") || isFieldAllowed(license, "investor", "tier");
  const showSegment = isFieldAllowed(license, "investor", "segment_tag") || isFieldAllowed(license, "investor", "segment");

  const allowedColumns = INVESTORS_COLUMNS.filter((col) => {
    if (col.key === "pan") return showPan;
    if (col.key === "aum") return showAum;
    if (col.key === "sip") return showSip;
    if (col.key === "kyc") return showKyc;
    if (col.key === "status") return showStatus;
    if (col.key === "tier") return showTier;
    if (col.key === "segment") return showSegment;
    // health column is always allowed — it's a derived score, no PII
    return true;
  });

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const segment = (sp.segment ?? "").split(",").filter(Boolean);
  const tier = (sp.tier ?? "").split(",").filter(Boolean);
  const status = (sp.status ?? "").split(",").filter(Boolean);
  const kyc = (sp.kyc ?? "").split(",").filter(Boolean);
  const aumMin = (sp.aum_min ?? "").trim();
  const aumMax = (sp.aum_max ?? "").trim();
  const aumLabel =
    aumMin || aumMax
      ? AUM_PRESETS.find((p) => String(p.min ?? "") === aumMin && String(p.max ?? "") === aumMax)?.label ??
        `AUM ${aumMin ? formatMoney(Number(aumMin), { decimals: 1 }) : "₹0"} – ${aumMax ? formatMoney(Number(aumMax), { decimals: 1 }) : "any"}`
      : "";
  // Describes the active narrowing so the empty state can name it.
  const activeFilterLabel = [
    q ? `matching “${q}”` : "",
    ...segment,
    ...tier.map((t) => `tier ${t}`),
    ...status,
    ...kyc.map((k) => `KYC ${k}`),
    aumLabel ? `AUM: ${aumLabel}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  // Any narrowing param at all (a dashboard drill-down such as review=overdue
  // or needs_data=1 included) — an empty result then reads "no matches", never
  // "no clients yet".
  const filtering = Object.entries(sp).some(([k, v]) => !!v && !["view", "sort", "dir", "page"].includes(k));
  const view = sp.view === "kanban" ? "kanban" : "table";
  const userId = session.userId;
  // Only firm-wide viewers (owner / branch_head) get the "RM" book-slice filter.
  // Client data is capability-gated: marketing / team members with no
  // investor capability never reach the list (same rule the API enforces).
  requireInvestorView(session);
  const canViewAll = can(session.roles, "investor.view.all", session.permissions);
  // Same gate as POST /api/investors/bulk.
  const canBulkEdit = can(session.roles, "investor.edit.all", session.permissions);
  // Same gate as POST /api/investors/recompute-tiers.
  const canRecomputeTiers = can(session.roles, "settings.masters", session.permissions);

  // Sort key drives both the DB ordering and the table header arrows. AUM is
  // the default (largest books first). "health" is a derived score computed in
  // JS, so it can't be ordered in SQL — the page sorts the fetched rows
  // locally (worst health first, to triage at-risk clients on the visible page).
  // Default to newest-first so a just-created client appears in the first row.
  const sortKey = ["name", "sip", "review", "health", "created", "aum"].includes(sp.sort ?? "")
    ? (sp.sort as string)
    : "created";

  // Sort direction. Each column has a sensible default (largest AUM/SIP first,
  // A→Z names, soonest review, worst health for triage); an explicit `dir`
  // query param (set by clicking the column header again) overrides it so the
  // user can flip ascending ↔ descending on any column.
  const DEFAULT_DIR: Record<string, "asc" | "desc"> = {
    name: "asc",
    aum: "desc",
    sip: "desc",
    review: "asc",
    health: "asc",
    created: "desc",
  };
  const dir: "asc" | "desc" =
    sp.dir === "asc" || sp.dir === "desc" ? sp.dir : DEFAULT_DIR[sortKey] ?? "desc";

  // Table pagination — 50/page. Kanban shows a larger single window (it's a
  // pipeline board, not a paged list). `page` is 1-based.
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const { rows, total, kanbanRows, rms, allIds, dupCount, massUpdate, needsDataCount, fieldFilterOptions, customDefs } = await withTenant(session.tenantId, async (tx) => {
    // The Health column reads the stored score. Re-score anyone not scored
    // since this morning first (days-since-contact moves with the calendar),
    // so the list shows what the client page and the drawer show. A no-op
    // after the first load of the day.
    await ensureHealthFresh(tx, session.tenantId);
    // Filters live in one shared helper so the page and the Excel export apply
    // identical WHERE logic. Tenant isolation is handled by RLS.
    // Row scope: an RM sees only their own book, a branch head only their
    // branch. RLS isolates by TENANT only, so without this every RM saw the
    // whole firm’s client list (and could export it) — the JSON API scoped
    // correctly but this page did not.
    const scope = await investorScopeCondition(tx, session);
    const filters = buildInvestorWhere(sp, userId);
    const where = scope ? and(filters as any, scope) : filters;

    // Project only the columns the table + kanban actually read — the table
    // never needs the heavy/sensitive jsonb (kycData, nominees, crossSell,
    // address), so don't pull them into the server component for every page.
    const r = await tx
      .select({
        id: investors.id,
        name: investors.name,
        avatarUrl: investors.avatarUrl,
        pan: investors.pan,
        clientCategory: investors.clientCategory,
        serviceTier: investors.serviceTier,
        segmentTag: investors.segmentTag,
        aum: investors.aum,
        activeSipAmount: investors.activeSipAmount,
        kycStatus: investors.kycStatus,
        status: investors.status,
        healthScore: investors.healthScore,
        healthBand: investors.healthBand,
        lastTransactionAt: investors.lastTransactionAt,
        updatedAt: investors.updatedAt,
        // Lightweight fields for the profile-completeness column (scalar +
        // small address jsonb; the heavy nominees/bank jsonb use the cheap
        // legacy mirror columns instead).
        dob: investors.dob,
        gender: investors.gender,
        email: investors.email,
        phone: investors.phone,
        occupation: investors.occupation,
        riskProfile: investors.riskProfile,
        panAadhaarLinkStatus: investors.panAadhaarLinkStatus,
        rmId: investors.rmId,
        nomineeName: investors.nomineeName,
        bankName: investors.bankName,
        address: investors.address,
      })
      .from(investors)
      .where(where as any)
      .orderBy(
        sortKey === "name"
          ? (dir === "asc" ? asc(investors.name) : desc(investors.name))
          : sortKey === "sip"
            ? (dir === "asc" ? asc(investors.activeSipAmount) : desc(investors.activeSipAmount))
            : sortKey === "review"
              ? sql`${investors.nextReviewAt} ${sql.raw(dir)} nulls last`
              : sortKey === "health"
                ? (dir === "asc" ? asc(investors.healthScore) : desc(investors.healthScore))
                : sortKey === "created"
                  ? (dir === "asc" ? asc(investors.createdAt) : desc(investors.createdAt))
                  : (dir === "asc" ? asc(investors.aum) : desc(investors.aum))
      )
      .limit(view === "kanban" ? 300 : PAGE_SIZE)
      .offset(view === "kanban" ? 0 : (page - 1) * PAGE_SIZE);

    const c = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(investors)
      .where(where as any);

    // Every matching id (not just this page) — powers "Select all N clients"
    // for bulk actions across the whole filtered book. Capped for safety.
    const allIdRows = await tx
      .select({ id: investors.id })
      .from(investors)
      .where(where as any)
      .limit(20000);
    const allIds = allIdRows.map((x) => x.id);

    // For the Kanban, also fetch each investor's blueprint stage. We join
    // through the source lead (leads.converted_investor_id = investor.id)
    // to lead_blueprint_instances. Direct-import investors get a NULL
    // leadId and fall back to "add_in_review_sheet" (Active Client).
    let kanbanRows: InvestorRow[] = [];
    if (view === "kanban") {
      const ids = r.map((i) => i.id);
      const stageMap: Record<string, { leadId: string; stageKey: string }> = {};
      if (ids.length > 0) {
        // Drizzle's sql template expands a JS array into $1, $2, …, $N — so
        // `${ids}::uuid[]` produces `($1,$2,…)::uuid[]` which is invalid SQL.
        // Build an explicit IN list with per-value uuid casts via sql.join.
        const idParams = sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `
        );
        const stageRows = await tx.execute(sql`
          SELECT l.id AS lead_id, l.converted_investor_id AS investor_id,
                 lbi.current_stage_key AS stage_key
          FROM leads l
          INNER JOIN lead_blueprint_instances lbi ON lbi.lead_id = l.id
          WHERE l.converted_investor_id IN (${idParams})
        `);
        for (const row of stageRows.rows as any[]) {
          stageMap[row.investor_id] = { leadId: row.lead_id, stageKey: row.stage_key };
        }
      }
      kanbanRows = r.map((i) => {
        const linked = stageMap[i.id];
        return {
          investor: {
            id: i.id,
            name: i.name,
            pan: showPan ? i.pan : "—",
            segmentTag: showSegment ? i.segmentTag : null,
            serviceTier: showTier ? i.serviceTier : null,
            aum: showAum ? (i.aum != null ? String(i.aum) : null) : null,
            activeSipAmount: showSip ? (i.activeSipAmount != null ? String(i.activeSipAmount) : null) : null,
            kycStatus: showKyc ? i.kycStatus : null,
            status: showStatus ? i.status : "—",
            updatedAt: i.updatedAt,
          },
          leadId: linked?.leadId ?? null,
          stageKey: linked?.stageKey ?? "add_in_review_sheet",
        };
      });
    }

    // Roster for the "RM" book-slice filter (owners/branch-heads only).
    let rms: any[] = [];
    if (canViewAll) {
      const rmRes = await tx.execute(sql`
        SELECT id, name FROM users
        WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
        ORDER BY name ASC
      `);
      rms = rmRes.rows as any[];
    }

    // Possible-duplicate count (same PAN / mobile) — surfaced as a banner.
    const dupCount = await countPossibleDuplicates(tx as any, session.tenantId, await investorScopeSql(tx, session, "investors"));

    // "Needs attention" quick filter (needs_data=1): the dashboard's "clients
    // missing data" count for this viewer's book, taken with the list's own
    // builder so the badge is the row count the filter opens onto.
    const ndFilter = buildInvestorWhere({ needs_data: "1" }, userId);
    const nd = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(investors)
      .where((scope ? and(ndFilter as any, scope) : ndFilter) as any);
    const needsDataCount = Number(nd[0]?.c ?? 0);

    // Choices for "Update a field" (branches, and the firm's master lists as
    // suggestions) — only for people who may bulk-edit.
    let massUpdate: MassUpdateOptions | undefined;
    if (canBulkEdit) {
      const br = (await tx.execute(sql`
        SELECT id, name FROM branches WHERE tenant_id = ${session.tenantId}::uuid ORDER BY name ASC
      `)).rows as Array<{ id: string; name: string | null }>;
      const mv = (await tx.execute(sql`
        SELECT master_type, label FROM master_values
         WHERE tenant_id = ${session.tenantId}::uuid AND is_active = true
           AND master_type IN ('occupation', 'income_range')
         ORDER BY sort_order ASC, label ASC
      `)).rows as Array<{ master_type: string; label: string }>;
      // Same roster as the "Reassign RM" button: every active person in the firm.
      const people = (await tx.execute(sql`
        SELECT id, name FROM users
         WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
         ORDER BY name ASC
      `)).rows as Array<{ id: string; name: string | null }>;
      massUpdate = {
        branches: br.map((b) => ({ value: String(b.id), label: b.name ?? "Unnamed branch" })),
        rms: people.map((u) => ({ value: String(u.id), label: u.name ?? "Unnamed" })),
        occupations: mv.filter((m) => m.master_type === "occupation").map((m) => m.label),
        incomeRanges: mv.filter((m) => m.master_type === "income_range").map((m) => m.label),
      };
    }

    // Every client field as a filter (lib/investors/field-filters.ts): the pick
    // lists list only what this viewer's own book holds, and each custom
    // client field gets its own filter.
    const bookWhere = sql`investors.deleted_at IS NULL AND investors.merged_into_id IS NULL${scope ? sql` AND ${scope}` : sql``}`;
    const fieldFilterOptions = await loadInvestorFilterOptions(tx, session.tenantId, bookWhere);
    const customDefs: InvestorCustomFieldDef[] = await tx
      .select({ key: customFieldDefs.key, label: customFieldDefs.label, type: customFieldDefs.type, options: customFieldDefs.options })
      .from(customFieldDefs)
      .where(sql`${customFieldDefs.tenantId} = ${session.tenantId}::uuid AND ${customFieldDefs.entity} = 'investor'`)
      .orderBy(asc(customFieldDefs.sortOrder), asc(customFieldDefs.label));

    return { rows: r, total: Number(c[0]?.c ?? 0), kanbanRows, rms, allIds, dupCount, massUpdate, needsDataCount, fieldFilterOptions, customDefs };
  }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

  const rmOptions = (rms ?? []).map((r: any) => ({ value: String(r.id), label: r.name ?? "—" }));

  // Switching Table ⇄ Kanban keeps the filters; it used to drop them all.
  const viewHref = (v: "table" | "kanban") => {
    const q = new URLSearchParams(
      Object.entries(sp).filter(([k, val]) => !!val && k !== "view" && k !== "page") as [string, string][],
    );
    if (v === "kanban") q.set("view", "kanban");
    const qs = q.toString();
    return `/dashboard/investors${qs ? `?${qs}` : ""}`;
  };

  // Table rows read the PERSISTED health score (written on create/update +
  // refreshed nightly) so the displayed value matches the DB-level sort and
  // pagination exactly. `dormDays` stays live (cheap, derived).
  const tableRows: InvestorTableRow[] = rows.map((i) => ({
    id: i.id,
    name: i.name,
    avatarUrl: i.avatarUrl ?? null,
    pan: showPan ? i.pan : null,
    clientCategory: i.clientCategory ?? null,
    serviceTier: showTier ? i.serviceTier : null,
    segmentTag: showSegment ? i.segmentTag : null,
    aum: showAum ? Number(i.aum ?? 0) : 0,
    sip: showSip ? Number(i.activeSipAmount ?? 0) : 0,
    kycStatus: showKyc ? i.kycStatus : null,
    status: showStatus ? i.status : null,
    healthScore: i.healthScore ?? 100,
    healthBand: (i.healthBand as HealthBand) ?? "green",
    dormDays: dormancyDays(i as any),
    completeness: clientCompleteness(i as any).score,
  }));

  return (
    <div className="space-y-6 max-w-7xl">
      {/* One primary action, the one import path, and everything occasional
          (export, re-grading tiers, the duplicates tool) under More. */}
      <PageHeaderCard
        title={<>Clients</>}
        actions={
          <>
            <Link
              href="/dashboard/investors/import"
              className={buttonClass("secondary", "md", "hidden sm:inline-flex")}
              title="Bring clients in from an Excel or CSV file"
            >
              <FileUp className="size-4" /> Import
            </Link>
            {/* Choose the fields, then download — with the filters on screen
                (lib/export). Shown only with "Bulk export clients". */}
            <ExportButton module="clients" />
            <Link href="/dashboard/investors/new" className={buttonClass("primary", "md")}>
              <Plus className="size-4" /> Add client
            </Link>
            <RecordMenu>
              <Link href="/dashboard/investors/import" className={`${MENU_ITEM} sm:hidden`}>
                <FileUp className={MENU_ICON} /> Import from Excel
              </Link>
              {canViewAll && (
                <Link href="/dashboard/duplicates" className={MENU_ITEM}>
                  <CopyPlus className={MENU_ICON} /> Find duplicate clients
                </Link>
              )}
              {canRecomputeTiers && (
                <>
                  <RecordMenuSeparator />
                  <RecomputeTiersButton triggerClassName={MENU_ITEM} />
                </>
              )}
            </RecordMenu>
          </>
        }
      />

      {/* Possible duplicates — a quiet line, not an alarm: nothing is wrong
          with the book until someone confirms two records are one person. */}
      {canViewAll && (dupCount ?? 0) > 0 && (
        <Link
          href="/dashboard/duplicates"
          className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm transition-colors hover:bg-secondary"
        >
          <CopyPlus className="size-4 shrink-0 text-warning" aria-hidden />
          <span className="text-muted-foreground">
            <strong className="font-semibold text-foreground">{dupCount}</strong> client{dupCount === 1 ? "" : "s"} may be
            duplicates (same PAN or mobile).
          </span>
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary">
            Review <ArrowRight className="size-3.5" />
          </span>
        </Link>
      )}

      <CompactFilterBar
        totalCount={total}
        searchPlaceholder="Search by name, PAN, phone…"
        filters={[
          // needs_data=1 — the data-hygiene list the dashboard's "clients
          // missing data" count opens onto.
          {
            type: "flags",
            label: "Quick filters",
            options: [{ key: "needs_data", label: "Needs attention", count: needsDataCount }],
          },
          {
            type: "multi",
            key: "segment",
            label: "Segment",
            options: [
              { value: "HNI", label: "HNI" },
              { value: "Affluent", label: "Affluent" },
              { value: "Retail", label: "Retail" },
              { value: "NRI", label: "NRI" },
              { value: "Corporate", label: "Corporate" },
            ],
          },
          {
            type: "multi",
            key: "category",
            label: "Client category",
            options: [
              { value: "A", label: "Category A" },
              { value: "B", label: "Category B" },
              { value: "C", label: "Category C" },
              { value: "D", label: "Category D" },
            ],
          },
          {
            type: "multi",
            key: "tier",
            label: "Service tier",
            options: [
              { value: "A", label: "A — Quarterly" },
              { value: "B", label: "B — Half-yearly" },
              { value: "C", label: "C — Annual" },
            ],
          },
          {
            type: "multi",
            key: "kyc",
            label: "KYC",
            options: [
              { value: "verified", label: "Verified" },
              { value: "pending", label: "Pending" },
              { value: "expired", label: "Expired" },
              { value: "rejected", label: "Rejected" },
            ],
          },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "active", label: "Active" },
              { value: "dormant", label: "Dormant" },
              { value: "inactive", label: "Inactive" },
              { value: "deceased", label: "Deceased" },
              { value: "closed", label: "Closed" },
            ],
          },
          ...(canViewAll && rmOptions.length
            ? [{ type: "multi" as const, key: "rm", label: "RM", options: rmOptions }]
            : []),
          ...(showAum ? [{ type: "amount_range" as const, key: "aum", label: "AUM", presets: AUM_PRESETS }] : []),
          dateRangeFilter("created", "Added"),
          ...investorFieldFilterDefs(fieldFilterOptions, customDefs, (f) => isFieldAllowed(license, "investor", f)),
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            {/* Table ⇄ Kanban sits with the other "how to show the list" controls. */}
            <div className="inline-flex gap-0.5 rounded-lg border border-border bg-secondary/40 p-0.5" role="group" aria-label="Layout">
              <Link
                href={viewHref("table")}
                aria-current={view === "table" ? "page" : undefined}
                title="Table"
                className={`inline-flex size-7 items-center justify-center rounded-md transition-colors ${
                  view === "table" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <List className="size-4" aria-hidden />
                <span className="sr-only">Table</span>
              </Link>
              <Link
                href={viewHref("kanban")}
                aria-current={view === "kanban" ? "page" : undefined}
                title="Kanban"
                className={`inline-flex size-7 items-center justify-center rounded-md transition-colors ${
                  view === "kanban" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <LayoutGrid className="size-4" aria-hidden />
                <span className="sr-only">Kanban</span>
              </Link>
            </div>
            {view === "table" && <InvestorSortSelect sort={sortKey} dir={dir} />}
            {/* Phones show cards, not the table — row spacing and columns
                have nothing to act on there. */}
            {view === "table" && <span className="hidden sm:contents"><TableDensitySwitch /></span>}
            {view === "table" && (
              <span className="hidden sm:contents"><ColumnManager compact moduleKey="investors" columns={allowedColumns} /></span>
            )}
            <CustomViews
              compact
              viewsKey="views:investors"
              presets={[
                { id: "hni", name: "HNI clients", params: "segment=HNI" },
                { id: "kyc-pending", name: "KYC pending", params: "kyc=pending,expired" },
                { id: "tier-a", name: "Tier A (quarterly)", params: "tier=A" },
              ]}
            />
          </div>
        }
      />

      {view === "kanban" ? (
        <div className="card-surface p-3">
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <LayoutGrid className="size-3.5" />
              <span className="font-medium">Client onboarding pipeline</span>
              <span>·</span>
              <span>{kanbanRows.length} clients</span>
            </div>
            <span className="text-2xs text-muted-foreground">
              Drag a card to move stages (works for clients converted from a lead)
            </span>
          </div>
          {kanbanRows.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No clients yet — add some or convert a lead to populate the pipeline.
            </div>
          ) : (
            <InvestorsKanban initialRows={kanbanRows} />
          )}
        </div>
      ) : rows.length === 0 ? (
        // Brand-new tenant with zero investors AND no active filter → big friendly EmptyState.
        // Otherwise just a short "no matches" line so the filter UI stays in context.
        <div className="card-surface overflow-hidden">
          {total === 0 && !filtering ? (
            <div className="p-6">
              <EmptyState
                icon={Users}
                title="No clients yet — let's add the first one"
                description="A client is anyone whose money you manage. Add them one at a time, or save hours by importing your existing book from Excel."
                tip="Already have a list in Excel? Use Import — the wizard maps columns automatically and warns you about KYC gaps."
                primary={{ href: "/dashboard/investors/new", label: "+ Add first client" }}
                secondary={{ href: "/dashboard/investors/import", label: "Import from Excel" }}
                learnMoreAnchor="kyc"
              />
            </div>
          ) : (
            <div className="p-12 text-center text-sm text-muted-foreground">
              {/* Name what was filtered on, so an empty result reads as "this
                  filter found nothing" rather than "the list is broken". */}
              {activeFilterLabel ? (
                <>
                  No <span className="font-medium text-foreground">{activeFilterLabel}</span> clients.{" "}
                  <Link href="/dashboard/investors" className="text-primary hover:underline">
                    Clear filters
                  </Link>
                </>
              ) : (
                <>
                  No clients match these filters.{" "}
                  <Link href="/dashboard/investors" className="text-primary hover:underline">
                    Clear filters
                  </Link>
                </>
              )}
              .
            </div>
          )}
        </div>
      ) : (
        <div>
          <InvestorsTable
            rows={tableRows}
            sort={sortKey}
            dir={dir}
            allIds={allIds}
            total={total}
            flags={{ showPan, showCategory: true, showTier, showSegment, showAum, showSip, showKyc, showStatus }}
            massUpdate={massUpdate}
          />
          <Pager
            page={page}
            totalPages={Math.ceil(total / PAGE_SIZE)}
            total={total}
            pageSize={PAGE_SIZE}
          />
        </div>
      )}
    </div>
  );
}
