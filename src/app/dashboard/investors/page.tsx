import Link from "next/link";
import { Plus, Upload, LayoutGrid, List } from "lucide-react";
import { desc, ilike, or, sql, eq, and, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatINR } from "@/lib/utils";
import { RecomputeTiersButton } from "@/components/investors/RecomputeTiersButton";
import { RowActions } from "@/components/common/RowActions";
import { FilterBar } from "@/components/common/FilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { HelpHint } from "@/components/help/HelpHint";
import { EmptyState } from "@/components/common/EmptyState";
import { Users } from "lucide-react";
import { InvestorsKanban, type InvestorRow } from "@/components/investors/InvestorsKanban";

const segmentColors: Record<string, string> = {
  HNI: "bg-violet-50 text-violet-700",
  Affluent: "bg-emerald-50 text-emerald-700",
  Retail: "bg-blue-50 text-blue-700",
  NRI: "bg-pink-50 text-pink-700",
  Corporate: "bg-amber-50 text-amber-700",
};

const tierColors: Record<string, string> = {
  A: "bg-violet-100 text-violet-700",
  B: "bg-emerald-100 text-emerald-700",
  C: "bg-blue-100 text-blue-700",
};

export const dynamic = "force-dynamic";

export default async function InvestorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const segment = (sp.segment ?? "").split(",").filter(Boolean);
  const tier = (sp.tier ?? "").split(",").filter(Boolean);
  const status = (sp.status ?? "").split(",").filter(Boolean);
  const kyc = (sp.kyc ?? "").split(",").filter(Boolean);
  const view = sp.view === "kanban" ? "kanban" : "table";

  const { rows, total, kanbanRows } = await withTenant(session.tenantId, async (tx) => {
    const conditions: any[] = [];
    if (q) {
      conditions.push(
        or(
          ilike(investors.name, `%${q}%`),
          ilike(investors.pan, `%${q.toUpperCase()}%`),
          ilike(investors.phone ?? sql`''`, `%${q}%`)
        )!
      );
    }
    if (segment.length) conditions.push(inArray(investors.segmentTag, segment as any));
    if (tier.length) conditions.push(inArray(investors.serviceTier, tier as any));
    if (status.length) conditions.push(inArray(investors.status, status as any));
    if (kyc.length) conditions.push(inArray(investors.kycStatus, kyc as any));
    const where = conditions.length ? and(...conditions) : undefined;

    const r = await tx
      .select()
      .from(investors)
      .where(where as any)
      .orderBy(desc(investors.aum))
      .limit(view === "kanban" ? 300 : 50);

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
            pan: i.pan,
            segmentTag: i.segmentTag,
            serviceTier: i.serviceTier,
            aum: i.aum != null ? String(i.aum) : null,
            activeSipAmount: i.activeSipAmount != null ? String(i.activeSipAmount) : null,
            kycStatus: i.kycStatus,
            status: i.status,
            updatedAt: i.updatedAt,
          },
          leadId: linked?.leadId ?? null,
          stageKey: linked?.stageKey ?? "add_in_review_sheet",
        };
      });
    }

    return { rows: r, total: Number(c[0]?.c ?? 0), kanbanRows };
  }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

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
          <RecomputeTiersButton />
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
      ) : (
      <div className="card-surface overflow-hidden">
        {rows.length === 0 ? (
          // Brand-new tenant with zero investors AND no active filter → big friendly EmptyState.
          // Otherwise just a short "no matches" line so the filter UI stays in context.
          total === 0 && !q && !segment.length && !tier.length && !status.length && !kyc.length ? (
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
          )
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left py-2 font-medium">
                  <span className="inline-flex items-center">PAN<HelpHint term="PAN" /></span>
                </th>
                <th className="text-left py-2 font-medium">Tier</th>
                <th className="text-left py-2 font-medium">Segment</th>
                <th className="text-right py-2 font-medium">
                  <span className="inline-flex items-center">AUM<HelpHint term="AUM" /></span>
                </th>
                <th className="text-right py-2 font-medium">
                  <span className="inline-flex items-center">SIP<HelpHint term="SIP" /></span>
                </th>
                <th className="text-left py-2 font-medium pl-4">
                  <span className="inline-flex items-center">KYC<HelpHint term="KYC" /></span>
                </th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/dashboard/investors/${i.id}`} className="hover:underline">
                      {i.name}
                    </Link>
                  </td>
                  <td className="py-3 text-xs font-mono text-muted-foreground">{i.pan}</td>
                  <td className="py-3">
                    {i.serviceTier ? (
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-full ${tierColors[i.serviceTier] ?? ""}`}
                        title={i.serviceTier === "A" ? "Quarterly review" : i.serviceTier === "B" ? "Half-yearly review" : "Annual review"}
                      >
                        {i.serviceTier}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-3">
                    {i.segmentTag && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${segmentColors[i.segmentTag] ?? ""}`}>
                        {i.segmentTag}
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-right tabular-nums">{formatINR(Number(i.aum ?? 0))}</td>
                  <td className="py-3 text-right tabular-nums text-muted-foreground">
                    {Number(i.activeSipAmount ?? 0) > 0 ? `${formatINR(Number(i.activeSipAmount))}/mo` : "—"}
                  </td>
                  <td className="py-3 pl-4">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        i.kycStatus === "verified"
                          ? "bg-emerald-50 text-emerald-700"
                          : i.kycStatus === "expired"
                          ? "bg-rose-50 text-rose-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {i.kycStatus}
                    </span>
                  </td>
                  <td className="py-3 text-xs">{i.status}</td>
                  <td className="px-4 py-3 text-right">
                    <RowActions
                      editHref={`/dashboard/investors/${i.id}`}
                      deleteUrl={`/api/investors/${i.id}`}
                      itemLabel="investor"
                      itemName={i.name}
                      verb="Mark exited"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      )}
    </div>
  );
}
