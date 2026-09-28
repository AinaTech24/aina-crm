import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Plus, HeartHandshake } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { formatINR, formatRelative } from "@/lib/utils";
import {
  familyHealth,
  type MemberForHealth,
  type FamilyHealthBreakdown,
} from "@/lib/families/health";
import { RowActions } from "@/components/common/RowActions";
import { familyQuickFilterOptions } from "@/components/families/FamilyQuickFilters";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { FamiliesMoreMenu } from "@/components/families/FamiliesMoreMenu";
import { CleanupEmptyFamilies } from "@/components/families/CleanupEmptyFamilies";
import { buttonClass } from "@/components/ui/button-class";
import { FamilyToolsGrid } from "@/components/families/FamilyToolsGrid";
import { Pager } from "@/components/common/Pager";
import { healthBandClasses, type HealthBand } from "@/lib/investors/health";
import { StatusChips, type StatusChip } from "@/components/common/StatusChips";
import { wealthBand, WEALTH_BAND_META, bandBounds, bandCaseSql, WEALTH_BANDS, type WealthBand } from "@/lib/families/wealth-band";

export const dynamic = "force-dynamic";

const BAND_BADGE: Record<string, string> = {
  super_hni: "bg-violet-50 text-violet-700",
  hni: "bg-emerald-50 text-emerald-700",
  upper_middle: "bg-sky-50 text-sky-700",
  middle: "bg-amber-50 text-amber-700",
  empty: "",
};

export default async function FamiliesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  // Households expose member names + PAN (search) + AUM — require an investor-view
  // capability and scope non-managers to their own families (the page used to
  // show the whole firm's households to any role; "mine" was only opt-in).
  requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
  const canViewAll = can(session.roles, "investor.view.all", session.permissions);
  // Same gate as deleting a single family.
  const canCleanup =
    can(session.roles, "family.delete", session.permissions) || can(session.roles, "investor.edit.all", session.permissions);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const userId = session.userId;
  const band = (WEALTH_BANDS as readonly string[]).includes(sp.band ?? "") ? (sp.band as WealthBand) : "";

  // Sort: "aum" (default, largest books first) or "health" (worst-first triage).
  const sortKey = sp.sort === "health" ? "health" : "aum";
  // Pagination — 50/page.
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  // Quick-filter chip params — same convention used on leads + investors.
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

  // Row counts for the quick-filter dropdown (one grouped query).
  const quickFilterOptions = await familyQuickFilterOptions(session);

  const { rows, total, bandCounts, memberlessCount } = await withTenant(session.tenantId, async (tx) => {
    // Translate quick-filter flags into HAVING / WHERE fragments. We compose
    // additive WHERE conditions on the family row + a HAVING on member-level
    // aggregates after the LEFT JOIN.
    const where: any[] = [];
    // Owner slice for non-managers (applies to the list, the count, and — below
    // — the wealth-band chips).
    if (!canViewAll) where.push(sql`f.rm_id = ${userId}::uuid`);
    if (q) {
      where.push(sql`(
        f.head_name ILIKE ${`%${q}%`}
        OR f.family_name ILIKE ${`%${q}%`}
        OR EXISTS (
          SELECT 1 FROM investors mi WHERE mi.family_id = f.id AND mi.deleted_at IS NULL
            AND (mi.name ILIKE ${`%${q}%`} OR mi.pan ILIKE ${`%${q.toUpperCase()}%`})
        )
      )`);
    }
    if (qf.mine) where.push(sql`f.rm_id = ${userId}`);
    if (qf.no_primary) where.push(sql`f.primary_investor_id IS NULL`);
    if (qf.no_rm) where.push(sql`f.rm_id IS NULL`);
    if (qf.review_due) {
      where.push(sql`(f.next_review_at IS NULL OR f.next_review_at <= now())`);
    }
    if (qf.red_health) where.push(sql`f.health_band = 'red'`);

    // Member-level conditions go in HAVING via boolean aggregates.
    const having: any[] = [];
    if (qf.nominee_gap) {
      having.push(
        sql`BOOL_OR(i.status = 'active' AND (i.nominee_name IS NULL OR i.nominee_name = '')) = true`
      );
    }
    if (qf.has_minor) {
      having.push(sql`BOOL_OR(i.is_minor = true) = true`);
    }
    if (qf.hni) {
      having.push(sql`BOOL_OR(i.segment_tag = 'HNI') = true`);
    }
    if (qf.single) {
      having.push(sql`COUNT(i.id) FILTER (WHERE i.status = 'active') = 1`);
    }
    if (qf.large) {
      having.push(sql`COUNT(i.id) FILTER (WHERE i.status = 'active') >= 5`);
    }
    const aumExpr = sql.raw(`COALESCE(SUM(i.aum::numeric) FILTER (WHERE i.status = 'active'), 0)`);
    if (band) {
      const b = bandBounds(band);
      having.push(b.max == null ? sql`${aumExpr} >= ${b.min}` : sql`${aumExpr} >= ${b.min} AND ${aumExpr} < ${b.max}`);
    } else if (!q) {
      // Families with no AUM are hidden by default: on most books they are the
      // majority, and a list that is 85% "₹0" buries the households to work
      // on. A search still finds them, and ?band=empty lists them.
      having.push(sql`${aumExpr} > 0`);
    }

    const whereSql = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;
    const havingSql = having.length ? sql`HAVING ${sql.join(having, sql` AND `)}` : sql``;

    const orderSql =
      sortKey === "health"
        ? sql`f.health_score ASC, family_aum DESC NULLS LAST` // worst health first
        : sql`family_aum DESC NULLS LAST`;

    const r = await tx.execute(sql`
      SELECT
        f.id, f.head_name, f.family_name, f.notes, f.primary_investor_id,
        f.rm_id, f.last_review_at, f.next_review_at,
        f.health_score, f.health_band, f.health_scored_at,
        f.created_at, f.updated_at,
        COUNT(i.id) FILTER (WHERE i.status = 'active')::int AS member_count,
        COUNT(i.id) FILTER (
          WHERE i.status = 'active' AND (i.nominee_name IS NULL OR i.nominee_name = '')
        )::int AS nominee_gap_count,
        COUNT(i.id) FILTER (
          WHERE i.status = 'active' AND i.kyc_status = 'verified'
        )::int AS kyc_verified_count,
        COALESCE(SUM(i.aum::numeric) FILTER (WHERE i.status = 'active'), 0)::numeric AS family_aum,
        COALESCE(SUM(i.active_sip_amount::numeric) FILTER (WHERE i.status = 'active'), 0)::numeric AS family_sip,
        BOOL_OR(i.segment_tag = 'HNI') AS has_hni
      FROM families f
      LEFT JOIN investors i ON i.family_id = f.id AND i.deleted_at IS NULL
      ${whereSql}
      GROUP BY f.id
      ${havingSql}
      ORDER BY ${orderSql}
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
    `);

    // Total matching families (wrap the grouped/having query so HAVING counts).
    const c = await tx.execute(sql`
      SELECT COUNT(*)::int AS c FROM (
        SELECT f.id
        FROM families f
        LEFT JOIN investors i ON i.family_id = f.id AND i.deleted_at IS NULL
        ${whereSql}
        GROUP BY f.id
        ${havingSql}
      ) sub
    `);

    // Families with no client linked at all — a narrower set than the "no AUM"
    // band, which also holds real households whose holdings aren't loaded yet.
    const memberless = await tx.execute(sql`
      SELECT COUNT(*)::int AS c FROM families f
       WHERE f.tenant_id = ${session.tenantId}::uuid
         ${canViewAll ? sql`` : sql`AND f.rm_id = ${userId}::uuid`}
         AND NOT EXISTS (SELECT 1 FROM investors i WHERE i.family_id = f.id AND i.deleted_at IS NULL)
    `);

    // Wealth-band distribution across ALL families (drives the chips).
    const bandCounts = await tx.execute(sql`
      SELECT band, COUNT(*)::int AS c FROM (
        SELECT ${sql.raw(bandCaseSql("agg.aum"))} AS band FROM (
          SELECT f.id, COALESCE(SUM(i.aum::numeric) FILTER (WHERE i.status = 'active'), 0) AS aum
          FROM families f LEFT JOIN investors i ON i.family_id = f.id AND i.deleted_at IS NULL
          WHERE f.tenant_id = ${session.tenantId}::uuid
            ${canViewAll ? sql`` : sql`AND f.rm_id = ${userId}::uuid`}
          GROUP BY f.id
        ) agg
      ) b GROUP BY band
    `);

    // Score the families on this page with the SAME function the household
    // page uses. `f.health_score` is migration 0042's optimistic 100/green
    // default and `health_scored_at` is NULL on every row never scored, so
    // reading the column made this list claim "Healthy - 100" for households the
    // detail page rates "At risk" (53, itemised: primary not set -15, no family
    // RM -10, never reviewed -12, no next-gen -10). Bounded: PAGE_SIZE is 50.
    // One cast for the family rows (hoisted), and a real row type for members —
    // so adding live scoring here introduces no new escape-hatch casts.
    type MemberRow = {
      id: string; family_id: string; name: string | null; status: string | null;
      dob: string | null; kyc_status: string | null; nominee_name: string | null;
      risk_profile: string | null; risk_profile_signed_at: string | null;
      aum: string | null; active_sip_amount: string | null;
    };
    const famRows = r.rows as Array<Record<string, unknown>>;
    const pageIds = famRows.map((x) => String(x.id));
    const membersByFamily = new Map<string, MemberForHealth[]>();
    if (pageIds.length) {
      const mem = await tx.execute(sql`
        SELECT id, family_id, name, status, dob, kyc_status, nominee_name,
               risk_profile, risk_profile_signed_at, aum, active_sip_amount
          FROM investors
         WHERE deleted_at IS NULL AND family_id IN (
           ${sql.join(pageIds.map((id) => sql`${id}::uuid`), sql`, `)}
         )
      `);
      for (const m of mem.rows as unknown as MemberRow[]) {
        const key = String(m.family_id);
        const list = membersByFamily.get(key) ?? [];
        list.push({
          id: String(m.id),
          name: m.name,
          status: m.status,
          dob: m.dob,
          kycStatus: m.kyc_status,
          nomineeName: m.nominee_name,
          riskProfile: m.risk_profile,
          riskProfileSignedAt: m.risk_profile_signed_at,
          aum: m.aum,
          activeSipAmount: m.active_sip_amount,
        });
        membersByFamily.set(key, list);
      }
    }
    // Declared shape rather than an escape-hatch cast: the SELECT above builds
    // ~15 aggregate columns that have no Drizzle row type, and the row is read
    // by key throughout the table below.
    const scored: Array<Record<string, any> & { _health: FamilyHealthBreakdown }> =
      famRows.map((f) => ({
      ...f,
      _health: familyHealth(
        {
          primaryInvestorId: f.primary_investor_id as string | null,
          rmId: f.rm_id as string | null,
          lastReviewAt: f.last_review_at as string | null,
          nextReviewAt: f.next_review_at as string | null,
        },
        membersByFamily.get(String(f.id)) ?? []
      ),
    }));

    return {
      rows: scored,
      total: Number((c.rows[0] as any)?.c ?? 0),
      bandCounts: bandCounts.rows as Array<{ band: string; c: number }>,
      memberlessCount: Number((memberless.rows[0] as { c?: number } | undefined)?.c ?? 0),
    };
  });

  const bandCount = (k: string) => bandCounts.find((x) => x.band === k)?.c ?? 0;
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
      tone: WEALTH_BAND_META[k].tone,
    })),
  ];
  const bandHref = (value: string) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "band" && k !== "page") params.set(k, v as string);
    if (value) params.set("band", value);
    const qs = params.toString();
    return `/dashboard/families${qs ? `?${qs}` : ""}`;
  };

  // Build a sort-toggle href that preserves filters/search and resets paging.
  const sortHref = (key: string) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (v && k !== "sort" && k !== "page") params.set(k, v as string);
    }
    if (key !== "aum") params.set("sort", key);
    const qs = params.toString();
    return `/dashboard/families${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard title={<>Families</>} subtitle={<>Group clients into households to see a family&apos;s whole portfolio together.</>} actions={<><div className="flex gap-2">
          {/* Suggest family links + Next generation view. */}
          <FamiliesMoreMenu />
          {/* Secondary: the page's primary action is mapping the unmapped
              clients, in the Family master cards below. */}
          <Link href="/dashboard/families/new" className={buttonClass("secondary")}>
            <Plus className="size-4" /> New family
          </Link>
        </div></>} />

      {/* Every household tool in one place, with the counts that say which one
          is worth opening. */}
      <FamilyToolsGrid session={session} />

      {/* Wealth-band tiers (Sanchay "Family Category" parity), minus "Empty". */}
      <div className="space-y-1.5">
        <StatusChips basePath="/dashboard/families" paramKey="band" current={band === "empty" ? "__none" : band} params={sp} chips={bandChips} />
        {(emptyCount > 0 || memberlessCount > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <p>
            {band === "empty" ? (
              <>
                Showing the {emptyCount.toLocaleString("en-IN")} families with no AUM
                {memberlessCount > 0 && <> ({memberlessCount.toLocaleString("en-IN")} of them have no clients linked)</>}.{" "}
                <Link href={bandHref("")} className="font-medium text-brand-cyan-deep hover:underline">
                  Back to families with AUM
                </Link>
              </>
            ) : (
              <>
                {emptyCount.toLocaleString("en-IN")} families with no AUM are hidden{q ? " (a search still finds them)" : ""}.{" "}
                <Link href={bandHref("empty")} className="font-medium text-brand-cyan-deep hover:underline">
                  Show them
                </Link>
              </>
            )}
          </p>
          {/* Only the families with NO client linked: the no-AUM band also
              holds real households whose holdings aren't loaded yet. */}
          {canCleanup && memberlessCount > 0 && <CleanupEmptyFamilies count={memberlessCount} />}
          </div>
        )}
      </div>

      {/* Search + filters — the same control Clients / Leads / Tasks use, so
          the quick filters live behind the filter icon instead of a chip
          strip that pushed the table down the page. */}
      <CompactFilterBar
        searchKey="q"
        searchPlaceholder="Search family name, member name, PAN…"
        totalCount={total}
        filters={[
          { type: "flags", label: "Quick filters", options: quickFilterOptions },
        ]}
      />

      <div>
        <div className="border rounded-lg bg-card overflow-hidden">
          {rows.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              <HeartHandshake className="size-8 mx-auto text-muted-foreground/50" />
              <div className="mt-2">
                {q || Object.values(qf).some(Boolean)
                  ? "No families match these filters."
                  : "No families mapped yet."}
              </div>
              <p className="mt-2 text-xs max-w-md mx-auto">
                Group existing investors into families to see combined AUM and run next-gen
                onboarding plays.
              </p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Family</th>
                    <th className="text-right py-2 font-medium">Members</th>
                    <th className="text-right py-2 font-medium">
                      <Link href={sortHref("aum")} className={`hover:underline ${sortKey === "aum" ? "text-foreground" : ""}`}>
                        Combined AUM {sortKey === "aum" ? "↓" : ""}
                      </Link>
                    </th>
                    <th className="text-right py-2 font-medium">Combined SIP</th>
                    <th className="text-left py-2 font-medium pl-4">
                      <Link href={sortHref("health")} className={`hover:underline ${sortKey === "health" ? "text-foreground" : ""}`}>
                        Health {sortKey === "health" ? "↑" : ""}
                      </Link>
                    </th>
                    <th className="text-left py-2 font-medium pl-4">Updated</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => {
                    const name = (f.family_name as string) || (f.head_name as string);
                    const memberCount = Number(f.member_count);
                    const nomineeGap = Number(f.nominee_gap_count);
                    const kycVerified = Number(f.kyc_verified_count);
                    const reviewOverdue =
                      !f.next_review_at || new Date(f.next_review_at as any) <= new Date();
                    // Cheap derived signals — exact composite score lives on the
                    // detail page; here we just light up flags.
                    const flags: Array<{ tone: "rose" | "amber"; label: string }> = [];
                    if (!f.primary_investor_id) flags.push({ tone: "rose", label: "no primary" });
                    if (!f.rm_id) flags.push({ tone: "rose", label: "no RM" });
                    if (nomineeGap > 0)
                      flags.push({ tone: "rose", label: `${nomineeGap} nominee gap` });
                    if (memberCount > 0 && kycVerified < memberCount)
                      flags.push({
                        tone: "amber",
                        label: `${memberCount - kycVerified} KYC pending`,
                      });
                    if (reviewOverdue) flags.push({ tone: "amber", label: "review due" });

                    return (
                      <tr key={f.id} className="border-b last:border-0 hover:bg-accent/40">
                        <td className="px-4 py-3">
                          <Link href={`/dashboard/families/${f.id}`} className="font-medium hover:underline">
                            {name}
                          </Link>
                          {(() => {
                            const wb = wealthBand(Number(f.family_aum ?? 0));
                            return wb !== "empty" ? (
                              <span className={`ml-2 text-2xs font-semibold px-1.5 py-0.5 rounded ${BAND_BADGE[wb]}`}>
                                {WEALTH_BAND_META[wb].label}
                              </span>
                            ) : null;
                          })()}
                          {f.notes && (
                            <div className="text-xs text-muted-foreground truncate max-w-md mt-0.5">
                              {f.notes}
                            </div>
                          )}
                        </td>
                        <td className="py-3 text-right tabular-nums">{memberCount}</td>
                        <td className="py-3 text-right tabular-nums">{formatINR(Number(f.family_aum ?? 0))}</td>
                        <td className="py-3 text-right tabular-nums text-muted-foreground">
                          {formatINR(Number(f.family_sip ?? 0))}
                        </td>
                        <td className="py-3 pl-4">
                          <div className="flex flex-col gap-1">
                            {/* migration 0042 seeded health_score/band with an
                                OPTIMISTIC 100/green and health_scored_at NULL.
                                Rendering that as "Healthy · 100" states a
                                measurement that was never taken — and it sat
                                directly beside four real red flags, which is how
                                a firm learns to distrust the column. Only show a
                                score once one has actually been computed. */}
                            {/* ONE badge: OK or At risk. The reasons (and the
                                score) are on the tooltip and the household page —
                                "Family RM not assigned +5" chips on every row said
                                less than a word, in more space. */}
                            {(() => {
                              const ok = f._health.band === "green";
                              const reasons = f._health.factors.map((x: { label: string }) => x.label);
                              return (
                                <span
                                  className={`w-fit text-2xs font-medium px-1.5 py-0.5 rounded-full border ${
                                    ok ? "bg-secondary text-muted-foreground border-border" : healthBandClasses(f._health.band).chip
                                  }`}
                                  title={
                                    reasons.length
                                      ? `Health ${f._health.score}/100. ${reasons.join(" · ")}`
                                      : `Health ${f._health.score}/100. Nothing to fix.`
                                  }
                                >
                                  {ok ? "OK" : "At risk"}
                                </span>
                              );
                            })()}
                          </div>
                        </td>
                        <td className="py-3 pl-4 text-xs text-muted-foreground">{formatRelative(f.updated_at)}</td>
                        <td className="px-4 py-3 text-right">
                          <RowActions
                            editHref={`/dashboard/families/${f.id}`}
                            deleteUrl={`/api/families/${f.id}`}
                            itemLabel="family"
                            itemName={name}
                            verb="Delete"
                            permanent
                            inline
                          />
                        </td>
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
    </div>
  );
}
