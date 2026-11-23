/**
 * The Families list's filter — ONE definition, read by the page and by
 * GET /api/families/ids ("Select all N matching records"), so the ids a person
 * selects are exactly the rows the page counts. Before this it lived inside
 * dashboard/families/page.tsx.
 *
 * SQL over `families f LEFT JOIN investors i ON LIVE_MEMBER_JOIN` — the caller
 * supplies the FROM / GROUP BY. Member-level conditions go in HAVING over the
 * LIVE members.
 */

import { sql, type SQL } from "drizzle-orm";
import { bandBounds, WEALTH_BANDS, type WealthBand } from "@/lib/families/wealth-band";
import { needsNomineeSql } from "@/lib/investors/type-rules";

export const FAMILY_CATEGORIES = ["HNI", "Affluent", "Retail", "NRI", "Corporate"] as const;

export type FamilyListParams = Record<string, string | undefined>;

export type FamilyQuickFlags = {
  mine: boolean;
  no_primary: boolean;
  no_rm: boolean;
  review_due: boolean;
  nominee_gap: boolean;
  has_minor: boolean;
  hni: boolean;
  single: boolean;
  large: boolean;
  red_health: boolean;
};

export type ParsedFamilyList = {
  q: string;
  band: WealthBand | "";
  categories: string[];
  qf: FamilyQuickFlags;
  /** "aum" (largest books first) or "health" (worst first). */
  sortKey: "aum" | "health";
  /** A search, a category or a quick filter is on (the band chips are not "narrowing"). */
  narrowed: boolean;
};

export function parseFamilyListParams(sp: FamilyListParams): ParsedFamilyList {
  const q = (sp.q ?? "").trim();
  const band = (WEALTH_BANDS as readonly string[]).includes(sp.band ?? "") ? (sp.band as WealthBand) : "";
  const categories = (sp.category ?? "").split(",").filter((c) => (FAMILY_CATEGORIES as readonly string[]).includes(c));
  const qf: FamilyQuickFlags = {
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
  return { q, band, categories, qf, sortKey: sp.sort === "health" ? "health" : "aum", narrowed };
}

export type FamilyListFilter = {
  whereSql: SQL;
  /** WHERE … HAVING with the band applied (and the "hide no-AUM" default). */
  havingSql: SQL;
  /** HAVING without the band — the wealth-band chips count with every filter EXCEPT the band. */
  havingNoBandSql: SQL;
  /** SUM of the live members' AUM, for the caller's own expressions. */
  aumExpr: SQL;
};

/** `scope` is `familyScopeSql(tx, session, "f")`. */
export function buildFamilyListFilter(args: {
  tenantId: string;
  userId: string;
  scope: SQL;
  parsed: ParsedFamilyList;
}): FamilyListFilter {
  const { q, band, categories, qf } = args.parsed;
  const where: SQL[] = [sql`f.tenant_id = ${args.tenantId}::uuid`, args.scope];
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
  if (qf.mine) where.push(sql`f.rm_id = ${args.userId}::uuid`);
  if (qf.no_primary) where.push(sql`f.primary_investor_id IS NULL`);
  if (qf.no_rm) where.push(sql`f.rm_id IS NULL`);
  if (qf.review_due) where.push(sql`(f.next_review_at IS NULL OR f.next_review_at <= now())`);
  if (qf.red_health) where.push(sql`f.health_band = 'red'`);

  const having: SQL[] = [];
  if (qf.nominee_gap) having.push(sql`BOOL_OR(i.id IS NOT NULL AND ${needsNomineeSql("i")}) = true`);
  if (qf.has_minor) having.push(sql`BOOL_OR(i.is_minor = true) = true`);
  if (qf.hni) having.push(sql`BOOL_OR(i.segment_tag = 'HNI') = true`);
  if (qf.single) having.push(sql`COUNT(i.id) = 1`);
  if (qf.large) having.push(sql`COUNT(i.id) >= 5`);
  const aumExpr = sql.raw(`COALESCE(SUM(i.aum::numeric), 0)`);
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

  return {
    whereSql: sql`WHERE ${sql.join(where, sql` AND `)}`,
    havingSql: having.length ? sql`HAVING ${sql.join(having, sql` AND `)}` : sql``,
    havingNoBandSql: havingNoBand.length ? sql`HAVING ${sql.join(havingNoBand, sql` AND `)}` : sql``,
    aumExpr,
  };
}
