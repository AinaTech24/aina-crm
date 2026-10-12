/**
 * Folio holder relationships (migration 0234, owner decisions of 2026-10-08).
 * The legal owner stays folios.investor_id; this table names everyone else on a
 * folio — joint holders, a minor's guardian, an HUF's Karta — per folio, with
 * provenance and effective dates. Not written by any importer yet.
 */
import { boolean, date, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, tenantId, timestamps } from "./_shared";

export const FOLIO_HOLDER_ROLES = ["first", "second", "third", "guardian", "karta"] as const;

export const folioHolders = pgTable(
  "folio_holders",
  {
    id,
    tenantId,
    folioId: uuid("folio_id").notNull(),
    role: text("role", { enum: FOLIO_HOLDER_ROLES }).notNull(),
    investorId: uuid("investor_id"),
    /** Keyed PAN token (pt1:) — never the PAN in clear. */
    holderPanToken: text("holder_pan_token"),
    /** Last four characters only, for display: ******234K. */
    holderPanMasked: text("holder_pan_masked"),
    holderName: text("holder_name"),
    holderDob: date("holder_dob"),
    source: text("source", { enum: ["registrar", "kyc", "staff"] }).notNull(),
    sourceReport: text("source_report"),
    sourceBatchId: uuid("source_batch_id"),
    sourceAsOf: date("source_as_of"),
    verified: boolean("verified").notNull().default(false),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    closedReason: text("closed_reason"),
    createdBy: uuid("created_by"),
    closedBy: uuid("closed_by"),
    ...timestamps,
  },
  (t) => ({
    currentRole: uniqueIndex("folio_holders_current_role_uidx").on(t.tenantId, t.folioId, t.role).where(sql`effective_to IS NULL`),
    investorIdx: index("folio_holders_investor_idx").on(t.tenantId, t.investorId),
    panIdx: index("folio_holders_pan_idx").on(t.tenantId, t.holderPanToken),
    currentInvestor: uniqueIndex("folio_holders_current_investor_uidx").on(t.tenantId, t.folioId, t.investorId).where(sql`effective_to IS NULL AND investor_id IS NOT NULL`),
    currentPan: uniqueIndex("folio_holders_current_pan_uidx").on(t.tenantId, t.folioId, t.holderPanToken).where(sql`effective_to IS NULL AND holder_pan_token IS NOT NULL`),
  }),
);
