/**
 * RTA staging (Phase 3B, migration 0233) — SHADOW ONLY.
 *
 * Every source row of every RTA mailback file the pipeline reads, what it
 * normalizes to, which registrar transaction it belongs to, which client it
 * matches and why it ended where it did. Nothing here is a business figure and
 * nothing here writes to investors / folios / transactions / sips: the
 * pipeline (src/lib/rta/staging) fills these tables only when
 * RTA_PIPELINE_MODE=shadow.
 *
 * Every relationship between these tables is a composite (tenant_id, id)
 * foreign key in the migration; references to live CRM rows (matched investor
 * / folio, a legacy transaction) are soft, so a shadow result can never block
 * or cascade from a financial record.
 *
 * PERSONAL DATA IS MINIMIZED: no name, address, phone or email is stored. A
 * PAN is kept only as a keyed token (`pt1:` HMAC, see staging/pan-token.ts),
 * never in clear and never as a plain hash.
 */
import { bigint, date, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const RTA_BATCH_STATES = [
  "uploaded", "identified", "parsed", "validated", "matched", "reconciled", "ready_to_commit", "exception", "failed",
] as const;
export type RtaBatchState = (typeof RTA_BATCH_STATES)[number];

export const RTA_ROW_STATES = [
  "parsed", "invalid", "validated", "matched", "unmatched", "ambiguous",
  "grouped", "staged", "staged_as_part", "duplicate", "quarantined", "rejected",
] as const;
export type RtaRowState = (typeof RTA_ROW_STATES)[number];

export const RTA_ECON_STATUSES = ["complete", "quarantined", "duplicate", "restated", "conflict"] as const;
export type RtaEconStatus = (typeof RTA_ECON_STATUSES)[number];

export const RTA_PROPOSED_ACTIONS = ["post_new", "adopt_legacy", "legacy_conflict", "unmatched", "none"] as const;
export type RtaProposedAction = (typeof RTA_PROPOSED_ACTIONS)[number];

export const rtaStagingBatches = pgTable(
  "rta_staging_batches",
  {
    id,
    tenantId,
    importId: uuid("import_id"),
    mode: text("mode", { enum: ["shadow"] }).notNull().default("shadow"),
    rta: text("rta", { enum: ["cams", "kfintech"] }),
    reportCode: text("report_code"),
    recordKind: text("record_kind", { enum: ["transaction", "holding", "master"] }),
    fileName: text("file_name").notNull(),
    fileRef: text("file_ref").notNull(),
    fileChecksum: text("file_checksum").notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    parserVersion: text("parser_version").notNull(),
    identityScheme: text("identity_scheme"),
    state: text("state", { enum: RTA_BATCH_STATES }).notNull().default("uploaded"),
    attempt: integer("attempt").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    rerunOfBatchId: uuid("rerun_of_batch_id"),
    sameFileAsBatchId: uuid("same_file_as_batch_id"),
    asOfDate: date("as_of_date"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    rowCount: integer("row_count"),
    counts: jsonb("counts").$type<Record<string, number>>().notNull().default({}),
    stageLog: jsonb("stage_log").$type<Array<{ stage: string; at: string; attempt: number; ms?: number; note?: string }>>().notNull().default([]),
    error: text("error"),
    createdBy: uuid("created_by"),
    ...timestamps,
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    tenantIdUq: uniqueIndex("rta_staging_batches_tenant_id_uq").on(t.tenantId, t.id),
    checksumIdx: index("rta_staging_batches_checksum_idx").on(t.tenantId, t.fileChecksum, t.createdAt),
    stateIdx: index("rta_staging_batches_state_idx").on(t.tenantId, t.state),
    importIdx: index("rta_staging_batches_import_idx").on(t.tenantId, t.importId),
  }),
);

export const rtaStagingEconomicTxns = pgTable(
  "rta_staging_economic_txns",
  {
    id,
    tenantId,
    batchId: uuid("batch_id").notNull(),
    identityScheme: text("identity_scheme").notNull(),
    identityKey: text("identity_key").notNull(),
    rta: text("rta").notNull(),
    amcCode: text("amc_code"),
    folioNumber: text("folio_number"),
    schemeCode: text("scheme_code"),
    registrarTxnNo: text("registrar_txn_no").notNull(),
    tradeDate: date("trade_date"),
    rtaClass: text("rta_class").notNull(),
    classConfidence: text("class_confidence", { enum: ["verified", "inferred"] }).notNull().default("verified"),
    direction: text("direction", { enum: ["inflow", "outflow"] }),
    status: text("status", { enum: RTA_ECON_STATUSES }).notNull(),
    reason: text("reason"),
    rowCount: integer("row_count").notNull(),
    lotCount: integer("lot_count").notNull().default(0),
    reportedUnits: numeric("reported_units"),
    reportedAmount: numeric("reported_amount"),
    reportedNav: numeric("reported_nav"),
    reportedExitLoad: numeric("reported_exit_load"),
    reportedStt: numeric("reported_stt"),
    reportedStampDuty: numeric("reported_stamp_duty"),
    derivedGrossAmount: numeric("derived_gross_amount"),
    arithmeticDelta: numeric("arithmetic_delta"),
    arithmeticTolerance: numeric("arithmetic_tolerance"),
    invariantHash: text("invariant_hash").notNull(),
    lotSignature: text("lot_signature").notNull(),
    duplicateOfId: uuid("duplicate_of_id"),
    matchInvestorId: uuid("match_investor_id"),
    matchFolioId: uuid("match_folio_id"),
    matchRule: text("match_rule"),
    proposedAction: text("proposed_action", { enum: RTA_PROPOSED_ACTIONS }).notNull(),
    legacyTransactionId: uuid("legacy_transaction_id"),
    ...timestamps,
  },
  (t) => ({
    tenantIdUq: uniqueIndex("rta_staging_econ_tenant_id_uq").on(t.tenantId, t.id),
    batchKeyUq: uniqueIndex("rta_staging_econ_batch_key_uq").on(t.batchId, t.identityKey),
    identityIdx: index("rta_staging_econ_identity_idx").on(t.tenantId, t.identityKey, t.createdAt),
    batchStatusIdx: index("rta_staging_econ_batch_status_idx").on(t.tenantId, t.batchId, t.status),
  }),
);

export const rtaStagingRows = pgTable(
  "rta_staging_rows",
  {
    id,
    tenantId,
    batchId: uuid("batch_id").notNull(),
    rowNo: integer("row_no").notNull(),
    rowHash: text("row_hash").notNull(),
    recordKind: text("record_kind", { enum: ["transaction", "holding", "master"] }).notNull(),
    state: text("state", { enum: RTA_ROW_STATES }).notNull(),
    rtaClass: text("rta_class"),
    classConfidence: text("class_confidence"),
    registrarTxnNo: text("registrar_txn_no"),
    economicKey: text("economic_key"),
    economicTxnId: uuid("economic_txn_id"),
    amcCode: text("amc_code"),
    folioNumber: text("folio_number"),
    schemeCode: text("scheme_code"),
    isin: text("isin"),
    tradeDate: date("trade_date"),
    asOfDate: date("as_of_date"),
    units: numeric("units"),
    amount: numeric("amount"),
    nav: numeric("nav"),
    price: numeric("price"),
    loadAmount: numeric("load_amount"),
    stt: numeric("stt"),
    stampDuty: numeric("stamp_duty"),
    holdingValue: numeric("holding_value"),
    panToken: text("pan_token"),
    guardianPanToken: text("guardian_pan_token"),
    matchInvestorId: uuid("match_investor_id"),
    matchFolioId: uuid("match_folio_id"),
    matchRule: text("match_rule"),
    attrs: jsonb("attrs").$type<Record<string, unknown>>().notNull().default({}),
    validation: jsonb("validation").$type<Record<string, unknown>>().notNull().default({}),
    disposition: text("disposition"),
    reason: text("reason"),
    exceptionCode: text("exception_code"),
    ...timestamps,
  },
  (t) => ({
    tenantIdUq: uniqueIndex("rta_staging_rows_tenant_id_uq").on(t.tenantId, t.id),
    batchRowUq: uniqueIndex("rta_staging_rows_batch_row_uq").on(t.batchId, t.rowNo),
    batchStateIdx: index("rta_staging_rows_batch_state_idx").on(t.tenantId, t.batchId, t.state),
    keyIdx: index("rta_staging_rows_key_idx").on(t.tenantId, t.economicKey),
    hashIdx: index("rta_staging_rows_hash_idx").on(t.tenantId, t.rowHash),
  }),
);

export const rtaStagingLots = pgTable(
  "rta_staging_lots",
  {
    id,
    tenantId,
    economicTxnId: uuid("economic_txn_id").notNull(),
    rowId: uuid("row_id").notNull(),
    registrarLotId: text("registrar_lot_id"),
    lotPart: smallint("lot_part").notNull().default(1),
    purchaseTxnNo: text("purchase_txn_no"),
    purchaseDate: date("purchase_date"),
    purchaseUnits: numeric("purchase_units"),
    purchaseAmount: numeric("purchase_amount"),
    units: numeric("units"),
    amount: numeric("amount"),
    price: numeric("price"),
    nav: numeric("nav"),
    loadAmount: numeric("load_amount"),
    stt: numeric("stt"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    rowUq: uniqueIndex("rta_staging_lots_row_uq").on(t.tenantId, t.rowId),
    econIdx: index("rta_staging_lots_econ_idx").on(t.tenantId, t.economicTxnId),
  }),
);

export const rtaStagingChecks = pgTable(
  "rta_staging_checks",
  {
    id,
    tenantId,
    batchId: uuid("batch_id").notNull(),
    checkCode: text("check_code").notNull(),
    scope: text("scope").notNull(),
    scopeRef: text("scope_ref").notNull().default(""),
    status: text("status", { enum: ["pass", "fail", "unverified"] }).notNull(),
    expected: text("expected"),
    actual: text("actual"),
    tolerance: text("tolerance"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uq: uniqueIndex("rta_staging_checks_uq").on(t.batchId, t.checkCode, t.scope, t.scopeRef),
    batchIdx: index("rta_staging_checks_batch_idx").on(t.tenantId, t.batchId, t.status),
  }),
);

export type RtaStagingBatch = typeof rtaStagingBatches.$inferSelect;
export type RtaStagingRow = typeof rtaStagingRows.$inferSelect;
export type RtaStagingEconomicTxn = typeof rtaStagingEconomicTxns.$inferSelect;
