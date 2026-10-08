import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Latest NAV per mutual-fund scheme — PLATFORM-SHARED market data, NOT
 * tenant-scoped (NAV is universal; every MFD values the same HDFC Flexi Cap
 * with the same number). Like `recipes` / `packages` / `content_library_assets`
 * this table has NO tenant_id and therefore NO RLS policy — it's reference data
 * read by every tenant. (The RLS CI guard only checks tables that HAVE a
 * tenant_id, so this is correctly ignored there.)
 *
 * Populated daily from AMFI's public NAVAll feed (see src/lib/finance/nav-feed.ts).
 * Keyed by the AMFI scheme code, which is what folios/transactions store in
 * `scheme_code`, so valuation is a simple join.
 */
export const schemeNav = pgTable(
  "scheme_nav",
  {
    /** AMFI scheme code, e.g. "119551". Primary key — one row per scheme. */
    schemeCode: text("scheme_code").primaryKey(),
    /** ISIN for the Payout/Growth plan (AMFI col 1). */
    isin: text("isin"),
    /** ISIN for the Dividend-Reinvestment plan (AMFI col 2) — kept distinct so
     *  RTA/folio matching can resolve a holding carrying either ISIN. */
    isinReinvest: text("isin_reinvest"),
    schemeName: text("scheme_name").notNull(),
    amcName: text("amc_name"),
    /** Scheme structure from the AMFI section header: "Open Ended" / "Close
     *  Ended" / "Interval". */
    schemeType: text("scheme_type"),
    /** Granular AMFI category from the section header, e.g.
     *  "Equity Scheme - Flexi Cap Fund". Authoritative for the WHOLE universe
     *  (unlike the mfapi join, which is gappy). */
    schemeCategory: text("scheme_category"),
    /** Latest published NAV (₹ per unit). */
    nav: numeric("nav", { precision: 14, scale: 4 }).notNull(),
    /** Date the NAV was published by the AMC/AMFI. */
    navDate: date("nav_date").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    /** AMFI column "ISIN Div Payout/ ISIN Growth" exactly as printed — no fallback (migration 0239). */
    isinPayoutGrowth: text("isin_payout_growth"),
    /** AMFI's explicit "Plan" / "Option" columns (current eight-column layout; null in the legacy one). */
    plan: text("plan"),
    optionName: text("option_name"),
    /** Dates of the first / latest AMFI feed that listed the scheme; absent from the latest = inactive. */
    firstSeenFeed: date("first_seen_feed"),
    lastSeenFeed: date("last_seen_feed"),
  },
  (t) => ({
    isinIdx: index("scheme_nav_isin_idx").on(t.isin),
    nameIdx: index("scheme_nav_name_idx").on(t.schemeName),
    isinReinvestIdx: index("scheme_nav_isin_reinvest_idx").on(t.isinReinvest),
    isinPgIdx: index("scheme_nav_isin_pg_idx").on(t.isinPayoutGrowth),
  })
);

/** One row per AMFI NAVAll file applied or refused — its hash, layout, feed date and counts (migration 0239). */
export const amfiFeedImports = pgTable("amfi_feed_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source", { enum: ["download", "file"] }).notNull(),
  sourceRef: text("source_ref"),
  sha256: text("sha256").notNull(),
  bytes: integer("bytes").notNull(),
  header: text("header"),
  layout: text("layout", { enum: ["current8", "legacy6"] }),
  feedDate: date("feed_date"),
  rowsTotal: integer("rows_total").notNull().default(0),
  schemes: integer("schemes").notNull().default(0),
  withNav: integer("with_nav").notNull().default(0),
  withoutNav: integer("without_nav").notNull().default(0),
  duplicateCodes: integer("duplicate_codes").notNull().default(0),
  isinOnManyCodes: integer("isin_on_many_codes").notNull().default(0),
  written: integer("written").notNull().default(0),
  keptNewer: integer("kept_newer").notNull().default(0),
  /** Schemes the feed lists WITHOUT a NAV ("N.A."): identity only, never priced. */
  unpriced: jsonb("unpriced").notNull().default(sql`'[]'::jsonb`),
  status: text("status", { enum: ["applied", "rejected"] }).notNull(),
  rejectReason: text("reject_reason"),
  importedBy: uuid("imported_by"),
  note: text("note"),
  importedAt: timestamp("imported_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ atIdx: index("amfi_feed_imports_at_idx").on(t.importedAt) }));

/**
 * Registrar code → AMFI scheme code, the same for every firm (migration 0239):
 * verified by the registrar's ISIN against the AMFI feed, or approved by two
 * platform operators. A crosswalk, not a scheme master.
 */
export const schemeRegistrarMap = pgTable("scheme_registrar_map", {
  id: uuid("id").primaryKey().defaultRandom(),
  rta: text("rta", { enum: ["cams", "kfintech"] }).notNull(),
  rtaAmcCode: text("rta_amc_code").notNull(),
  rtaSchemeCode: text("rta_scheme_code").notNull(),
  amfiSchemeCode: text("amfi_scheme_code").notNull(),
  basis: text("basis", { enum: ["isin", "platform_approval"] }).notNull(),
  evidenceIsin: text("evidence_isin"),
  isinColumn: text("isin_column", { enum: ["payout_growth", "reinvest"] }),
  status: text("status", { enum: ["verified", "approved", "revoked"] }).notNull(),
  evidenceNote: text("evidence_note"),
  requestedBy: uuid("requested_by"),
  approvedBy: uuid("approved_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: uuid("revoked_by"),
  revokeReason: text("revoke_reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  liveKey: uniqueIndex("scheme_registrar_map_live_key").on(t.rta, t.rtaAmcCode, t.rtaSchemeCode).where(sql`status <> 'revoked'`),
  amfiIdx: index("scheme_registrar_map_amfi_idx").on(t.amfiSchemeCode),
}));

/** Append-only history of scheme_registrar_map (migration 0239). */
export const schemeRegistrarMapEvents = pgTable("scheme_registrar_map_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  mapId: uuid("map_id").notNull(),
  action: text("action").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  actor: uuid("actor"),
  secondActor: uuid("second_actor"),
  reason: text("reason"),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
});

export type SchemeNav = typeof schemeNav.$inferSelect;
export type NewSchemeNav = typeof schemeNav.$inferInsert;
