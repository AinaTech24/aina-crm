import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Boxes, Star, CheckCircle2, Layers } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { SchemesCatalog } from "@/components/schemes/SchemesCatalog";
import { SyncSchemesButton } from "@/components/schemes/SyncSchemesButton";
import { Pager } from "@/components/common/Pager";
import { planSql, coarseSql } from "@/lib/schemes/classify";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

const COARSE_OPTS = [
  { value: "equity", label: "Equity" }, { value: "hybrid", label: "Hybrid" }, { value: "debt", label: "Debt" },
  { value: "liquid", label: "Liquid" }, { value: "commodity", label: "Commodity" }, { value: "international", label: "International" }, { value: "other", label: "Other" },
];
const RISK_OPTS = ["very_low", "low", "moderate", "high", "very_high"].map((v) => ({ value: v, label: v.replace(/_/g, " ") }));

export default async function SchemesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const canManage = can(session.roles, "compliance.edit", (session as any).permissions);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const amc = (sp.amc ?? "").split(",").filter(Boolean);
  const coarse = (sp.coarse ?? "").split(",").filter(Boolean);
  const risk = (sp.risk ?? "").split(",").filter(Boolean);
  const shortlisted = sp.shortlisted === "1";
  // Direct plans are hidden by default: a distributor cannot sell them.
  const showDirect = sp.direct === "1";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const data = await withTenant(session.tenantId, async (tx) => {
    // Plan and coarse category as stored, with the gaps filled from the scheme
    // name and AMFI category (lib/schemes/classify) — ~40% of the feed names
    // no plan, and legacy / fund-of-fund categories used to land in "Other".
    // The next "Sync from AMFI" stores the same values.
    const base = sql`
      SELECT s.*,
             COALESCE(s.plan, ${planSql(sql`s.scheme_name`, sql`COALESCE(s.category, s.sub_category)`)}) AS plan_eff,
             CASE WHEN s.coarse_category IS NULL OR s.coarse_category = 'other'
                  THEN ${coarseSql(sql`COALESCE(s.category, s.sub_category, '')`, sql`s.scheme_name`)}
                  ELSE s.coarse_category END AS coarse_eff
        FROM scheme_master s
       WHERE s.tenant_id = ${session.tenantId}::uuid`;
    const planScope = showDirect ? sql`TRUE` : sql`b.plan_eff IS DISTINCT FROM 'direct'`;

    const conds: any[] = [planScope];
    if (q) conds.push(sql`(b.scheme_name ILIKE ${`%${q}%`} OR b.scheme_code ILIKE ${`%${q}%`})`);
    if (amc.length) conds.push(sql`b.amc_code IN (${sql.join(amc.map((v) => sql`${v}`), sql`, `)})`);
    if (coarse.length) conds.push(sql`b.coarse_eff IN (${sql.join(coarse.map((v) => sql`${v}`), sql`, `)})`);
    if (risk.length) conds.push(sql`b.risk_category IN (${sql.join(risk.map((v) => sql`${v}`), sql`, `)})`);
    if (shortlisted) conds.push(sql`b.is_shortlisted = true`);
    const whereSql = sql`WHERE ${sql.join(conds, sql` AND `)}`;

    // Whole (filtered) catalog is reachable via pagination — the old hard
    // LIMIT 300 made ~13.7k synced schemes invisible past the first page.
    const rows = await tx.execute(sql`
      WITH b AS (${base})
      SELECT b.id, b.amc_code, b.scheme_code, b.scheme_name, b.category, b.sub_category,
             b.coarse_eff AS coarse_category, (b.coarse_eff IS DISTINCT FROM b.coarse_category) AS coarse_inferred,
             b.plan_eff AS plan, (b.plan IS NULL AND b.plan_eff IS NOT NULL) AS plan_inferred,
             b.option, b.exit_load, b.risk_category, b.min_sip, b.min_investment,
             b.is_active, b.is_closed, b.is_shortlisted, b.shortlist_rationale, b.evaluation,
             am.name AS amc_name
      FROM b
      LEFT JOIN amc_master am ON am.tenant_id = b.tenant_id AND am.code = b.amc_code
      ${whereSql}
      ORDER BY b.is_shortlisted DESC, b.scheme_name ASC
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
    `);
    const filtered = await tx.execute(sql`WITH b AS (${base}) SELECT COUNT(*)::int AS c FROM b ${whereSql}`);

    // Tiles count the same plans the list shows.
    const stats = await tx.execute(sql`
      WITH b AS (${base})
      SELECT
        COUNT(*) FILTER (WHERE ${planScope})::int AS total,
        COUNT(*) FILTER (WHERE ${planScope} AND b.is_shortlisted)::int AS shortlisted,
        COUNT(*) FILTER (WHERE ${planScope} AND b.is_active AND NOT COALESCE(b.is_closed, false))::int AS active,
        COUNT(*) FILTER (WHERE ${planScope} AND (b.evaluation->>'verdict') IS NOT NULL)::int AS evaluated,
        COUNT(*) FILTER (WHERE b.plan_eff = 'direct')::int AS direct
      FROM b
    `);

    const amcs = await tx.execute(sql`SELECT code, name FROM amc_master WHERE tenant_id = ${session.tenantId}::uuid ORDER BY name`);
    return {
      rows: rows.rows as any[],
      stats: stats.rows[0] as any,
      amcs: amcs.rows as Array<{ code: string; name: string }>,
      filteredTotal: Number((filtered.rows[0] as any)?.c ?? 0),
    };
  });

  const s = data.stats;
  const directHref = (() => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "page") params.set(k, v);
    params.set("direct", "1");
    return `/dashboard/schemes?${params.toString()}`;
  })();

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard title={<><Boxes className="size-6 text-muted-foreground" /> Scheme Master</>} subtitle={<>The scheme master — every fund you can transact in, with its details.</>} actions={<>{canManage && <SyncSchemesButton />}</>} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Boxes} label={showDirect ? "Schemes (all plans)" : "Schemes (regular plans)"} value={s.total ?? 0} />
        <Stat icon={Star} label="Shortlisted (buy-list)" value={s.shortlisted ?? 0} tone="amber" />
        <Stat icon={CheckCircle2} label="Active / open" value={s.active ?? 0} tone="emerald" />
        <Stat icon={Layers} label="IC-evaluated" value={s.evaluated ?? 0} />
      </div>

      <CompactFilterBar
        totalCount={data.filteredTotal}
        filters={[
          { type: "search", key: "q", placeholder: "Search by scheme name or code…" },
          { type: "multi", key: "amc", label: "AMC", options: data.amcs.map((a) => ({ value: a.code, label: a.name })) },
          { type: "multi", key: "coarse", label: "Category", options: COARSE_OPTS },
          { type: "multi", key: "risk", label: "Risk", options: RISK_OPTS },
          { type: "select", key: "shortlisted", label: "Shortlist", options: [{ value: "1", label: "Shortlisted only" }] },
          { type: "flags", label: "Plans", options: [{ key: "direct", label: "Show Direct plans", count: Number(s.direct ?? 0) }] },
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:schemes"
            presets={[
              { id: "shortlisted", name: "Shortlisted (buy-list)", params: "shortlisted=1" },
              { id: "equity", name: "Equity", params: "coarse=equity" },
              { id: "debt", name: "Debt", params: "coarse=debt" },
            ]}
          />
        }
      />

      {!showDirect && Number(s.direct ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing regular plans only — {Number(s.direct).toLocaleString("en-IN")} Direct plans are hidden because a distributor cannot sell them.{" "}
          <Link href={directHref} className="font-medium text-foreground hover:underline">Show Direct plans</Link>
        </p>
      )}

      <SchemesCatalog rows={data.rows} amcs={data.amcs} canManage={canManage} />

      <Pager
        page={page}
        totalPages={Math.ceil(data.filteredTotal / PAGE_SIZE)}
        total={data.filteredTotal}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone?: "amber" | "emerald" }) {
  const color = tone === "amber" ? "text-amber-600" : tone === "emerald" ? "text-emerald-600" : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><Icon className="size-3.5 text-muted-foreground" /></div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
