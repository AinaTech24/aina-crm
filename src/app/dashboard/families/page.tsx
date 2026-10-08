import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Plus, HeartHandshake } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatDate } from "@/lib/format";
import { formatINR } from "@/lib/utils";
import { familyHealth, type MemberForHealth, type FamilyHealthBreakdown } from "@/lib/families/health";
import { RowActions } from "@/components/common/RowActions";
import { familyQuickFilterOptions } from "@/components/families/FamilyQuickFilters";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { FamiliesMoreMenu } from "@/components/families/FamiliesMoreMenu";
import { ExportButton } from "@/components/export/ExportButton";
import { CleanupEmptyFamilies } from "@/components/families/CleanupEmptyFamilies";
import { buttonClass } from "@/components/ui/button-class";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/common/EmptyState";
import { FamilyToolsGrid } from "@/components/families/FamilyToolsGrid";
import { Pager } from "@/components/common/Pager";
import { healthBandClasses } from "@/lib/investors/health";
import { StatusChips, type StatusChip } from "@/components/common/StatusChips";
import { wealthBand, WEALTH_BAND_META, bandBounds, bandCaseSql, WEALTH_BANDS, type WealthBand } from "@/lib/families/wealth-band";
import { familyScopeSql, requireFamilyView, canEditFamilies } from "@/lib/families/access";
import { LIVE_MEMBER_JOIN } from "@/lib/families/live";
import { investorScopeSql } from "@/lib/investors/access";
import { aliveClient } from "@/lib/metrics/scope";

export const dynamic = "force-dynamic";

const CATEGORIES = ["HNI", "Affluent", "Retail", "NRI", "Corporate"] as const;

export default async function FamiliesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  // One rule for who sees which family (lib/families/access) — the same one
  // the family page, its API, search and the PDF use.
  requireFamilyView(session);
  const canDelete =
    can(session.roles, "family.delete", session.permissions) || can(session.roles, "investor.edit.all", session.permissions);
  const canCreate = canEditFamilies(session);
  const hasClientView =
    can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "investor.view.assigned", session.permissions);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const userId = session.userId;
  const band = (WEALTH_BANDS as readonly string[]).includes(sp.band ?? "") ? (sp.band as WealthBand) : "";
  const categories = (sp.category ?? "").split(",").filter((c) => (CATEGORIES as readonly string[]).includes(c));

  // Sort: "aum" (default, largest books first) or "health" (worst-first triage).
  const sortKey = sp.sort === "health" ? "health" : "aum";
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const qf = {
    mine: sp.mine === "1",
    no_primary: sp.no_primary === "1",
    no_rm: sp.no_rm === "1",
    review_due: sp.review_due === "1",
    nominee_gap: sp.nominee_gap === "1",
    has_minor: sp.has_minor === "1",
    hni: sp.hni === "1",
    single: sp.single === "1",
    large: sp.large === "1",
    red_health: sp.red_health === "1",
  };
  const narrowed = !!q || categories.length > 0 || Object.values(qf).some(Boolean);

  const { rows, total, bandCounts, memberlessCount, quickFilterOptions, coverage } = await withTenant(session.tenantId, async (tx) => {
    const scope = await familyScopeSql(tx, session, "f");
    const quickFilterOptions = await familyQuickFilterOptions(tx, { userId, scope });

    const where: any[] = [sql`f.tenant_id = ${session.tenantId}::uuid`, scope];
    if (q) {
      const digits = q.replace(/\D/g, "");
      where.push(sql`(
        f.head_name ILIKE ${`%${q}%`}
        OR f.family_name ILIKE ${`%${q}%`}
        OR f.family_code ILIKE ${`%${q}%`}
        OR EXISTS (
          SELECT 1 FROM investors mi WHERE mi.family_id = f.id AND mi.deleted_at IS NULL AND mi.merged_into_id IS NULL
            AND (mi.name ILIKE ${`%${q}%`} OR mi.pan ILIKE ${`%${q.toUpperCase()}%`}
                 ${digits.length >= 6 ? sql`OR regexp_replace(COALESCE(mi.phone, ''), '\\D', '', 'g') LIKE ${`%${digits}%`}` : sql``})
        )
      )`);
    }
    if (categories.length) where.push(sql`f.family_category IN (${sql.join(categories.map((c) => sql`${c}`), sql`, `)})`);
    if (qf.mine) where.push(sql`f.rm_id = ${userId}::uuid`);
    if (qf.no_primary) where.push(sql`f.primary_investor_id IS NULL`);
    if (qf.no_rm) where.push(sql`f.rm_id IS NULL`);
    if (qf.review_due) where.push(sql`(f.next_review_at IS NULL OR f.next_review_at <= now())`);
    if (qf.red_health) where.push(sql`f.health_band = 'red'`);

    // Member-level conditions go in HAVING via boolean aggregates over LIVE members.
    const having: any[] = [];
    if (qf.nominee_gap) having.push(sql`BOOL_OR(i.id IS NOT NULL AND (i.nominee_name IS NULL OR i.nominee_name = '')) = true`);
    if (qf.has_minor) having.push(sql`BOOL_OR(i.is_minor = true) = true`);
    if (qf.hni) having.push(sql`BOOL_OR(i.segment_tag = 'HNI') = true`);
    if (qf.single) having.push(sql`COUNT(i.id) = 1`);
    if (qf.large) having.push(sql`COUNT(i.id) >= 5`);
    const aumExpr = sql.raw(`COALESCE(SUM(i.aum::numeric), 0)`);
    // The band chips count with every filter EXCEPT the band itself.
    const havingNoBand = [...having];
    if (band) {
      const b = bandBounds(band);
      having.push(b.max == null ? sql`${aumExpr} >= ${b.min}` : sql`${aumExpr} >= ${b.min} AND ${aumExpr} < ${b.max}`);
    } else if (!q) {
      // Families with no AUM are hidden by default: on most books they are the
      // majority, and a list that is 85% "₹0" buries the households to work
      // on. A search still finds them, and ?band=empty lists them.
      having.push(sql`${aumExpr} >= 1`);
    }

    const whereSql = sql`WHERE ${sql.join(where, sql` AND `)}`;
    const havingSql = having.length ? sql`HAVING ${sql.join(having, sql` AND `)}` : sql``;
    const havingNoBandSql = havingNoBand.length ? sql`HAVING ${sql.join(havingNoBand, sql` AND `)}` : sql``;

    const orderSql =
      sortKey === "health" ? sql`f.health_score ASC, family_aum DESC NULLS LAST` : sql`family_aum DESC NULLS LAST`;

    const r = await tx.execute(sql`
      SELECT
        f.id, f.head_name, f.family_name, f.family_code, f.family_category, f.notes, f.primary_investor_id,
        f.rm_id, f.last_review_at, f.next_review_at, f.health_score, f.health_band,
        u.name AS rm_name,
        (SELECT name FROM investors h WHERE h.id = f.primary_investor_id AND h.family_id = f.id) AS head_member_name,
        COUNT(i.id)::int AS member_count,
        COALESCE(SUM(i.aum::numeric), 0)::numeric AS family_aum,
        COALESCE(SUM(i.active_sip_amount::numeric), 0)::numeric AS family_sip
      FROM families f
      LEFT JOIN investors i ON ${LIVE_MEMBER_JOIN}
      LEFT JOIN users u ON u.id = f.rm_id
      ${whereSql}
      GROUP BY f.id, u.name
      ${havingSql}
      ORDER BY ${orderSql}
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
    `);

    const c = await tx.execute(sql`
      SELECT COUNT(*)::int AS c FROM (
        SELECT f.id FROM families f LEFT JOIN investors i ON ${LIVE_MEMBER_JOIN}
        ${whereSql} GROUP BY f.id ${havingSql}
      ) sub
    `);

    // Families with no live client at all — a narrower set than the "no AUM"
    // band, which also holds real households whose holdings aren't loaded yet.
    const memberless = await tx.execute(sql`
      SELECT COUNT(*)::int AS c FROM families f
       WHERE f.tenant_id = ${session.tenantId}::uuid AND ${scope}
         AND NOT EXISTS (SELECT 1 FROM investors i WHERE ${LIVE_MEMBER_JOIN})
    `);

    // Wealth-band distribution over the families the current search and
    // filters select (the chips used to ignore both: "HNI 42" over a list of 3).
    const bandCounts = await tx.execute(sql`
      SELECT band, COUNT(*)::int AS c FROM (
        SELECT ${sql.raw(bandCaseSql("agg.aum"))} AS band FROM (
          SELECT f.id, COALESCE(SUM(i.aum::numeric), 0) AS aum
            FROM families f LEFT JOIN investors i ON ${LIVE_MEMBER_JOIN}
          ${whereSql}
          GROUP BY f.id ${havingNoBandSql}
        ) agg
      ) b GROUP BY band
    `);

    // Mapping coverage, over the clients this person can see.
    let coverage = { mapped: 0, unmapped: 0 };
    if (hasClientView) {
      const clientScope = await investorScopeSql(tx, session, "i");
      const cov = (await tx.execute(sql`
        SELECT COUNT(*) FILTER (WHERE i.family_id IS NOT NULL)::int AS mapped,
               COUNT(*) FILTER (WHERE i.family_id IS NULL)::int AS unmapped
          FROM investors i
         WHERE i.tenant_id = ${session.tenantId}::uuid AND ${aliveClient("i")} AND ${clientScope}
      `)).rows[0] as { mapped?: number; unmapped?: number } | undefined;
      coverage = { mapped: Number(cov?.mapped ?? 0), unmapped: Number(cov?.unmapped ?? 0) };
    }

    // Score the families on this page with the SAME function the family page
    // uses, and keep the stored score (what "Health" sorts by) equal to it, so
    // a worst-first sort never shows "OK" above "At risk".
    type MemberRow = {
      id: string; family_id: string; name: string | null; status: string | null;
      dob: string | null; is_minor: boolean | null; kyc_status: string | null; nominee_name: string | null;
      nominees: unknown; risk_profile: string | null; risk_profile_signed_at: string | null;
      aum: string | null; active_sip_amount: string | null;
    };
    const famRows = r.rows as Array<Record<string, unknown>>;
    const pageIds = famRows.map((x) => String(x.id));
    const membersByFamily = new Map<string, MemberForHealth[]>();
    if (pageIds.length) {
      const mem = await tx.execute(sql`
        SELECT id, family_id, name, status, dob, is_minor, kyc_status, nominee_name, nominees,
               risk_profile, risk_profile_signed_at, aum, active_sip_amount
          FROM investors i
         WHERE ${aliveClient("i")} AND family_id IN (${sql.join(pageIds.map((id) => sql`${id}::uuid`), sql`, `)})
      `);
      for (const m of mem.rows as unknown as MemberRow[]) {
        const key = String(m.family_id);
        const list = membersByFamily.get(key) ?? [];
        list.push({
          id: String(m.id), name: m.name, status: m.status, dob: m.dob, isMinor: m.is_minor,
          kycStatus: m.kyc_status, nomineeName: m.nominee_name, nominees: m.nominees,
          riskProfile: m.risk_profile, riskProfileSignedAt: m.risk_profile_signed_at,
          aum: m.aum, activeSipAmount: m.active_sip_amount,
        });
        membersByFamily.set(key, list);
      }
    }
    const scored: Array<Record<string, any> & { _health: FamilyHealthBreakdown }> = [];
    for (const f of famRows) {
      const h = familyHealth(
        {
          primaryInvestorId: f.primary_investor_id as string | null,
          rmId: f.rm_id as string | null,
          lastReviewAt: f.last_review_at as string | null,
          nextReviewAt: f.next_review_at as string | null,
        },
        membersByFamily.get(String(f.id)) ?? []
      );
      if (Number(f.health_score) !== h.score || f.health_band !== h.band) {
        await tx.execute(sql`
          UPDATE families SET health_score = ${h.score}, health_band = ${h.band}, health_scored_at = now()
           WHERE id = ${String(f.id)}::uuid
        `);
      }
      scored.push({ ...f, _health: h });
    }

    return {
      rows: scored,
      total: Number((c.rows[0] as any)?.c ?? 0),
      bandCounts: bandCounts.rows as Array<{ band: string; c: number }>,
      memberlessCount: Number((memberless.rows[0] as { c?: number } | undefined)?.c ?? 0),
      quickFilterOptions,
      coverage,
    };
  });

  const bandCount = (k: string) => Number(bandCounts.find((x) => x.band === k)?.c ?? 0);
  const emptyCount = bandCount("empty");
  const totalFamilies = bandCounts.reduce((a, x) => a + Number(x.c), 0);
  // "Empty" is not a chip: it is hidden by default and reached from the note
  // under the chips, so "All" counts the families actually listed.
  const bandChips: StatusChip[] = [
    { value: "", label: "All", count: totalFamilies - emptyCount, tone: "slate" },
    ...WEALTH_BANDS.filter((k) => k !== "empty").map((k) => ({
      value: k,
      label: WEALTH_BAND_META[k].label,
      count: bandCount(k),
      tone: "slate" as const,
    })),
  ];
  const hrefWith = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "page" && !(k in patch)) params.set(k, v as string);
    for (const [k, v] of Object.entries(patch)) if (v) params.set(k, v);
    const qs = params.toString();
    return `/dashboard/families${qs ? `?${qs}` : ""}`;
  };
  const now = new Date();

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard
        title={<>Families</>}
        actions={
          <>
            <FamiliesMoreMenu />
            <ExportButton module="families" />
            {canCreate && (
              <Link href="/dashboard/families/new" className={buttonClass("secondary")}>
                <Plus className="size-4" /> New family
              </Link>
            )}
          </>
        }
      />

      {/* Every household tool in one place, with the counts that say which one
          is worth opening. */}
      <FamilyToolsGrid mapped={coverage.mapped} unmapped={coverage.unmapped} showCoverage={hasClientView} />

      {/* Wealth-band tiers, minus "Empty". */}
      <div className="space-y-1.5">
        <StatusChips basePath="/dashboard/families" paramKey="band" current={band === "empty" ? "__none" : band} params={sp} chips={bandChips} />
        {(emptyCount > 0 || memberlessCount > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            <p>
              {band === "empty" ? (
                <>
                  Showing the {emptyCount.toLocaleString("en-IN")} families with no AUM
                  {memberlessCount > 0 && <> ({memberlessCount.toLocaleString("en-IN")} of them have no clients linked)</>}.{" "}
                  <Link href={hrefWith({ band: null })} className="font-medium text-primary hover:underline">
                    Back to families with AUM
                  </Link>
                </>
              ) : (
                <>
                  {emptyCount.toLocaleString("en-IN")} families with no AUM are hidden{q ? " (a search still finds them)" : ""}.{" "}
                  <Link href={hrefWith({ band: "empty" })} className="font-medium text-primary hover:underline">
                    Show them
                  </Link>
                </>
              )}
            </p>
            {/* Only the families with NO client linked: the no-AUM band also
                holds real households whose holdings aren't loaded yet. */}
            {canDelete && memberlessCount > 0 && <CleanupEmptyFamilies count={memberlessCount} />}
          </div>
        )}
      </div>

      <CompactFilterBar
        searchKey="q"
        searchPlaceholder="Search family name or code, member name, PAN or mobile…"
        totalCount={total}
        filters={[
          { type: "flags", label: "Quick filters", options: quickFilterOptions },
          {
            type: "multi",
            key: "category",
            label: "Family category",
            options: CATEGORIES.map((c) => ({ value: c, label: c })),
          },
        ]}
      />

      <div className="card-surface overflow-hidden">
        {rows.length === 0 ? (
          totalFamilies === 0 && !narrowed && band !== "empty" ? (
            <div className="p-6">
              <EmptyState
                icon={HeartHandshake}
                title="No families yet"
                description="Group clients into households to see a family's combined AUM, review the family together and spot the next generation."
                primary={canCreate ? { href: "/dashboard/families/new", label: "New family" } : undefined}
                secondary={hasClientView ? { href: "/dashboard/families/unmapped", label: "Map clients into families" } : undefined}
              />
            </div>
          ) : (
            <div className="p-12 text-center text-sm text-muted-foreground">
              <HeartHandshake className="mx-auto size-8 text-muted-foreground/50" aria-hidden />
              <p className="mt-2">
                {narrowed
                  ? "No families match these filters."
                  : emptyCount > 0
                    ? "Every family here has no AUM loaded yet, so they are hidden."
                    : "No families to show."}
              </p>
              {narrowed ? (
                <Link href="/dashboard/families" className="mt-2 inline-block font-medium text-primary hover:underline">Clear filters</Link>
              ) : emptyCount > 0 ? (
                <Link href={hrefWith({ band: "empty" })} className="mt-2 inline-block font-medium text-primary hover:underline">Show them</Link>
              ) : null}
            </div>
          )
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b bg-card text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Family</th>
                  <th className="py-2 text-left font-medium">Head</th>
                  <th className="py-2 text-left font-medium">RM</th>
                  <th className="py-2 text-right font-medium">Members</th>
                  <th className="py-2 text-right font-medium">
                    <Link href={hrefWith({ sort: null })} className={`hover:underline ${sortKey === "aum" ? "text-foreground" : ""}`}>
                      Combined AUM {sortKey === "aum" ? "↓" : ""}
                    </Link>
                  </th>
                  <th className="py-2 text-right font-medium">SIP / month</th>
                  <th className="py-2 pl-4 text-left font-medium">Next review</th>
                  <th className="py-2 pl-4 text-left font-medium">
                    <Link href={hrefWith({ sort: "health" })} className={`hover:underline ${sortKey === "health" ? "text-foreground" : ""}`}>
                      Health {sortKey === "health" ? "↑" : ""}
                    </Link>
                  </th>
                  {canDelete && <th className="px-4 py-2"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => {
                  const name = (f.family_name as string) || (f.head_name as string);
                  const wb = wealthBand(Number(f.family_aum ?? 0));
                  const next = f.next_review_at ? new Date(f.next_review_at as any) : null;
                  const overdue = !!next && next < now;
                  const ok = f._health.band === "green";
                  const reasons = f._health.factors.map((x: { label: string }) => x.label);
                  return (
                    <tr key={f.id} className="border-b last:border-0 hover:bg-accent/40">
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/dashboard/families/${f.id}`} className="font-medium hover:underline">
                            {name}
                          </Link>
                          {wb !== "empty" && <Badge raw>{WEALTH_BAND_META[wb].label}</Badge>}
                        </div>
                        {(f.family_code || f.family_category) && (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {[f.family_code, f.family_category].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="py-3 text-sm">
                        {f.head_member_name ?? <span className="text-xs text-muted-foreground">Not set</span>}
                      </td>
                      <td className="py-3 text-sm">
                        {f.rm_name ?? <span className="text-xs text-muted-foreground">Not assigned</span>}
                      </td>
                      <td className="py-3 text-right tabular-nums">{Number(f.member_count)}</td>
                      <td className="py-3 text-right tabular-nums">{formatINR(Number(f.family_aum ?? 0))}</td>
                      <td className="py-3 text-right tabular-nums text-muted-foreground">
                        {Number(f.family_sip ?? 0) > 0 ? formatINR(Number(f.family_sip)) : "—"}
                      </td>
                      <td className={`py-3 pl-4 text-sm ${overdue ? "text-destructive" : ""}`}>
                        {next ? <>{formatDate(next)}{overdue ? " · overdue" : ""}</> : <span className="text-xs text-muted-foreground">Not scheduled</span>}
                      </td>
                      <td className="py-3 pl-4">
                        {/* ONE badge: OK or At risk; the score and reasons on hover. */}
                        <span
                          className={`w-fit rounded-full border px-1.5 py-0.5 text-2xs font-medium ${
                            ok ? "border-border bg-secondary text-muted-foreground" : healthBandClasses(f._health.band).chip
                          }`}
                          title={reasons.length ? `Health ${f._health.score}/100. ${reasons.join(" · ")}` : `Health ${f._health.score}/100. Nothing to fix.`}
                        >
                          {ok ? "OK" : "At risk"}
                        </span>
                      </td>
                      {canDelete && (
                        <td className="px-4 py-3 text-right">
                          {/* Only an empty family can be deleted (the API refuses one with members). */}
                          {Number(f.member_count) === 0 && (
                            <RowActions
                              deleteUrl={`/api/families/${f.id}`}
                              itemLabel="family"
                              itemName={name}
                              verb="Delete"
                              permanent
                              inline
                            />
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <div className="px-4 pb-3">
            <Pager page={page} totalPages={Math.ceil(total / PAGE_SIZE)} total={total} pageSize={PAGE_SIZE} />
          </div>
        )}
      </div>
    </div>
  );
}
