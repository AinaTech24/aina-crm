import Link from "next/link";
import { Plus, Upload, Download, LayoutGrid, List } from "lucide-react";
import { asc, desc, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { RecomputeTiersButton } from "@/components/investors/RecomputeTiersButton";
import { FilterBar } from "@/components/common/FilterBar";
import { dateRangeFilter } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { EmptyState } from "@/components/common/EmptyState";
import { Users } from "lucide-react";
import { InvestorsKanban, type InvestorRow } from "@/components/investors/InvestorsKanban";
import { ColumnManager } from "@/components/common/ColumnManager";
import { loadTenantLicense } from "@/lib/auth/license";
import { isFieldAllowed } from "@/lib/auth/field-gate";
import { InvestorKpiStrip } from "@/components/investors/InvestorKpiStrip";
// import { InvestorQuickFilters } from "@/components/investors/InvestorQuickFilters"; // hidden for now
import { dormancyDays, type HealthBand } from "@/lib/investors/health";
import { InvestorsTable, type InvestorTableRow } from "@/components/investors/InvestorsTable";
import { buildInvestorWhere } from "@/lib/investors/list-filters";
import { Pager } from "@/components/common/Pager";

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
  const view = sp.view === "kanban" ? "kanban" : "table";
  const userId = session.userId;
  // Only firm-wide viewers (owner / branch_head) get the "RM" book-slice filter.
  const canViewAll = can(session.roles, "investor.view.all", session.permissions);

  // Query string for the Excel export link — carries the current filters so the
  // download matches exactly what's on screen (the export endpoint reuses the
  // same buildInvestorWhere helper). Drop view/sort — they don't affect rows.
  const exportQs = new URLSearchParams(
    Object.entries(sp).filter(
      ([k, v]) => v != null && v !== "" && k !== "view" && k !== "sort" && k !== "dir"
    ) as [string, string][]
  ).toString();

  // Sort key drives both the DB ordering and the table header arrows. AUM is
  // the default (largest books first). "health" is a derived score computed in
  // JS, so it can't be ordered in SQL — the page sorts the fetched rows
  // locally (worst health first, to triage at-risk clients on the visible page).
  const sortKey = ["name", "sip", "review", "health"].includes(sp.sort ?? "")
    ? (sp.sort as string)
    : "aum";

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
  };
  const dir: "asc" | "desc" =
    sp.dir === "asc" || sp.dir === "desc" ? sp.dir : DEFAULT_DIR[sortKey] ?? "desc";

  // Table pagination — 50/page. Kanban shows a larger single window (it's a
  // pipeline board, not a paged list). `page` is 1-based.
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const { rows, total, kanbanRows, rms } = await withTenant(session.tenantId, async (tx) => {
    // Filters live in one shared helper so the page and the Excel export apply
    // identical WHERE logic. Tenant isolation is handled by RLS.
    const where = buildInvestorWhere(sp, userId);

    const r = await tx
      .select()
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
          : (dir === "asc" ? asc(investors.aum) : desc(investors.aum))
      )
      .limit(view === "kanban" ? 300 : PAGE_SIZE)
      .offset(view === "kanban" ? 0 : (page - 1) * PAGE_SIZE);

    const c = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(investors)
      .where(where as any);

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

    return { rows: r, total: Number(c[0]?.c ?? 0), kanbanRows, rms };
  }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

  const rmOptions = (rms ?? []).map((r: any) => ({ value: String(r.id), label: r.name ?? "—" }));

  // Table rows read the PERSISTED health score (written on create/update +
  // refreshed nightly) so the displayed value matches the DB-level sort and
  // pagination exactly. `dormDays` stays live (cheap, derived).
  const tableRows: InvestorTableRow[] = rows.map((i) => ({
    id: i.id,
    name: i.name,
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
  }));

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Investors</h1>
          <p className="text-muted-foreground text-sm">
            {total === 0 ? "No investors yet." : `${total} investors in your firm.`}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {/* View toggle — Table vs Kanban. Mirrors the leads page pattern.
              `view=kanban` query param drives the server-side query (loads
              blueprint stages too) and which component renders below. */}
          <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5 mr-1">
            <Link
              href="/dashboard/investors"
              className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                view === "table"
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <List className="size-3.5" /> Table
            </Link>
            <Link
              href="/dashboard/investors?view=kanban"
              className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                view === "kanban"
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="size-3.5" /> Kanban
            </Link>
          </div>
          {view === "table" && (
            <ColumnManager moduleKey="investors" columns={allowedColumns} />
          )}
          <RecomputeTiersButton />
          <a
            href={`/api/investors/export${exportQs ? `?${exportQs}` : ""}`}
            className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent"
            title="Download the current (filtered) book as an Excel file"
          >
            <Download className="size-4" /> Export
          </a>
          <Link
            href="/dashboard/investors/import"
            className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5"
          >
            <Upload className="size-4" /> Import Excel
          </Link>
          <Link
            href="/dashboard/investors/new"
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
          >
            <Plus className="size-4" /> Add investor
          </Link>
        </div>
      </div>

      {/* KPI strip — book-wide snapshot */}
      <InvestorKpiStrip session={session} />

      {/* Quick-filter chips — hidden for now (re-enable later). */}
      {/* <div className="card-surface p-3">
        <InvestorQuickFilters
          session={session}
          active={sp as Record<string, string | undefined>}
        />
      </div> */}

      <FilterBar
        totalCount={total}
        filters={[
          { type: "search", key: "q", placeholder: "Search by name, PAN, phone…" },
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
            label: "Client Category",
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
          dateRangeFilter("created", "Added"),
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:investors"
            presets={[
              { id: "hni", name: "HNI clients", params: "segment=HNI" },
              { id: "kyc-pending", name: "KYC pending", params: "kyc=pending,expired" },
              { id: "tier-a", name: "Tier A (quarterly)", params: "tier=A" },
            ]}
          />
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
            <span className="text-[11px] text-muted-foreground">
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
          {total === 0 && !q && !segment.length && !tier.length && !status.length && !kyc.length ? (
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
              No investors match these filters.{" "}
              <Link href="/dashboard/investors/new" className="text-brand-cyan-deep hover:underline">
                Add one manually
              </Link>
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
            flags={{ showPan, showCategory: true, showTier, showSegment, showAum, showSip, showKyc, showStatus }}
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
