/**
 * FintechPrimitives "mailback" import.
 *
 * Flow (mirrors FP's documented reverse-feed workflow):
 *   1. POST /files                       — upload the RTA reverse feed
 *   2. POST /file_operations             — type=transaction_processing
 *   3. GET  /file_operations/:id (poll)  — until processed | failed
 *   4. GET  /v2/mf_folios                — folios FP populated
 *   5. GET  /transactions?folios=…       — structured txns + FIFO capital-gains
 *   6. upsert into local folios + transactions (matched by PAN / folio number)
 *
 * The network phase (1–5) runs OUTSIDE any DB transaction — polling can take
 * minutes and must never hold a Postgres tx open. Only step 6 opens a tx.
 */

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  uploadFpFile,
  createFpFileOperation,
  getFpFileOperation,
  listFpMfFolios,
  listFpTransactions,
  type FpConfig,
  type FpFileOperation,
  type FpMfFolio,
  type FpTransaction,
} from "./client";

// ── Network phase ────────────────────────────────────────────────────────────

export interface FpMailbackData {
  operation: FpFileOperation;
  folios: FpMfFolio[];
  transactions: FpTransaction[];
  /** True if the folio list hit the page cap (some folios may be unlisted). */
  foliosCapHit: boolean;
}

export type FpPhase =
  | "uploading"
  | "creating_operation"
  | "processing"
  | "fetching_folios"
  | "fetching_transactions";

export interface FpFetchOpts {
  cfg?: FpConfig;
  /** Max time to wait for FP to finish processing the file. */
  timeoutMs?: number;
  /** Poll interval while the operation is pending/processing. */
  pollMs?: number;
  onPhase?: (phase: FpPhase, detail?: Record<string, unknown>) => void;
}

/** Poll a file operation until it reaches a terminal state or times out. */
export async function pollFpFileOperation(
  id: string,
  opts: FpFetchOpts = {}
): Promise<FpFileOperation> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const pollMs = opts.pollMs ?? 3_000;
  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const op = await getFpFileOperation(id, opts.cfg);
    if (op.status === "processed" || op.status === "failed") return op;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        `Mailback processing timed out after ${Math.round(timeoutMs / 1000)}s (last status: ${op.status}).`
      );
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** Run steps 1–5: upload, process, and pull back folios + transactions. */
export async function fetchFpMailback(
  bytes: Uint8Array,
  filename: string,
  opts: FpFetchOpts = {}
): Promise<FpMailbackData> {
  opts.onPhase?.("uploading");
  const file = await uploadFpFile(bytes, filename, opts.cfg);

  opts.onPhase?.("creating_operation", { fileId: file.id });
  const created = await createFpFileOperation(file.id, opts.cfg);

  opts.onPhase?.("processing", { operationId: created.id });
  const operation = await pollFpFileOperation(created.id, opts);
  if (operation.status === "failed") {
    throw new Error(
      `The mailback service could not process this file (operation ${operation.id} failed; ${operation.failed ?? "?"} rows failed). ` +
        `Confirm it's an accepted reverse-feed report (Karvy MFSD201, CAMS WBR2, Franklin MTFP, Sundaram ER02).`
    );
  }

  opts.onPhase?.("fetching_folios");
  const { folios, capHit } = await listFpMfFolios(opts.cfg);

  opts.onPhase?.("fetching_transactions", { folioCount: folios.length });
  const folioNumbers = [...new Set(folios.map((f) => f.number).filter(Boolean))];
  const transactions = await listFpTransactions(folioNumbers, { cfg: opts.cfg });

  return { operation, folios, transactions, foliosCapHit: capHit };
}

// ── Mapping helpers ──────────────────────────────────────────────────────────

const LOCAL_TX_TYPES = new Set([
  "purchase",
  "redemption",
  "switch",
  "dividend_payout",
  "dividend_reinvest",
]);

/** Map an FP transaction type → local (type, direction). Raw FP type is kept in
 *  raw_feed_row for fidelity where the local enum is coarser. */
function mapFpType(fpType: string): { type: string; direction: "inflow" | "outflow" } {
  switch (fpType) {
    case "purchase":
      return { type: "purchase", direction: "inflow" };
    case "redemption":
      return { type: "redemption", direction: "outflow" };
    case "switch_in":
      return { type: "switch", direction: "inflow" };
    case "switch_out":
      return { type: "switch", direction: "outflow" };
    case "transfer_in":
      return { type: "purchase", direction: "inflow" };
    case "transfer_out":
      return { type: "redemption", direction: "outflow" };
    case "dividend_payout":
      return { type: "dividend_payout", direction: "outflow" };
    case "dividend_reinvestment":
      return { type: "dividend_reinvest", direction: "inflow" };
    case "bonus":
      return { type: "dividend_reinvest", direction: "inflow" };
    default:
      // Unknown type — keep the row (raw preserved) and infer a safe direction.
      return { type: "purchase", direction: "inflow" };
  }
}

/** Sum realised capital-gain across a transaction's FIFO source lots. */
function gainOf(t: FpTransaction): number {
  if (!t.sources?.length) return 0;
  return t.sources.reduce((acc, s) => acc + (Number(s.gain) || 0), 0);
}

function dedupKeyFor(t: FpTransaction, idx: number): string {
  const natural = [
    "fp",
    t.folio_number ?? "",
    t.rta_order_reference ?? "",
    t.type ?? "",
    t.traded_on ?? "",
    t.amount ?? "",
    t.units ?? "",
    // index disambiguates the rare case of two identical legs with no order ref
    t.rta_order_reference ? "" : idx,
  ].join("|");
  return "fp:" + createHash("sha256").update(natural).digest("hex").slice(0, 40);
}

// ── DB phase ─────────────────────────────────────────────────────────────────

export interface FpImportSummary {
  foliosTotal: number;
  foliosMatched: number;
  foliosUnmatched: number;
  txTotal: number;
  txImported: number;
  txSkipped: number;
  txFailed: number;
  /** Realised capital-gains total across redemptions/switch-outs (the prize). */
  capitalGainsTotal: number;
  periodStart: string;
  periodEnd: string;
  foliosCapHit: boolean;
  errors: Array<{ row: number; reason: string }>;
}

/** The subset of fetched data the upsert needs — shared by the upload path
 *  (fetchFpMailback) and the API-pull sync path (pullFpData). */
export type FpUpsertInput = Pick<FpMailbackData, "folios" | "transactions" | "foliosCapHit">;

/**
 * Step 6: upsert FP folios + transactions into the local CRM, matched to
 * existing investors by PAN (and folios by amc+number). Idempotent: every
 * transaction carries a deterministic dedup_key, so re-running is a no-op.
 */
export async function applyFpMailback(
  tx: Tx,
  tenantId: string,
  data: FpUpsertInput
): Promise<FpImportSummary> {
  // Large feeds in one tx can exceed the 30s pool statement_timeout.
  await tx.execute(sql`SET LOCAL statement_timeout = '600s'`);

  const errors: Array<{ row: number; reason: string }> = [];
  const folioByNumber = new Map<string, FpMfFolio>();
  for (const f of data.folios) if (f.number) folioByNumber.set(f.number, f);

  // 1. Resolve investors by PAN in one bulk query.
  const pans = [
    ...new Set(
      data.folios
        .map((f) => (f.primary_investor_pan ?? "").toUpperCase())
        .filter((p) => p.length > 0)
    ),
  ];
  const investorByPan = new Map<string, string>();
  if (pans.length) {
    const res = await tx.execute(sql`
      SELECT id, pan FROM investors
      WHERE tenant_id = ${tenantId}::uuid
        AND pan IN (${sql.join(pans.map((p) => sql`${p}`), sql`, `)})
    `);
    for (const r of res.rows as any[]) if (r.pan) investorByPan.set(String(r.pan).toUpperCase(), r.id);
  }

  // 2. Upsert a folio row for every FP folio whose investor we can match;
  //    build folio_number → {folioId, investorId} for the transaction loop.
  const folioResolved = new Map<string, { folioId: string; investorId: string }>();
  let foliosMatched = 0;
  for (const f of data.folios) {
    const pan = (f.primary_investor_pan ?? "").toUpperCase();
    const investorId = pan ? investorByPan.get(pan) : undefined;
    if (!investorId) continue; // unmatched — its transactions will be skipped+reported
    try {
      const r = await tx.execute(sql`
        INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta)
        VALUES (${tenantId}::uuid, ${investorId}::uuid, ${f.number}, ${f.amc}, ${f.amc}, 'other')
        ON CONFLICT (tenant_id, amc_code, folio_number) DO UPDATE SET updated_at = now()
        RETURNING id
      `);
      const folioId = (r.rows[0] as any)?.id;
      if (folioId) {
        folioResolved.set(f.number, { folioId, investorId });
        foliosMatched++;
      }
    } catch (e: any) {
      errors.push({ row: 0, reason: `Folio ${f.number}: ${e?.message ?? "upsert failed"}` });
    }
  }

  // 3. Upsert transactions.
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let capitalGainsTotal = 0;
  let minDate = "9999-12-31";
  let maxDate = "0000-01-01";
  const lastTxByInvestor = new Map<string, string>();

  for (let i = 0; i < data.transactions.length; i++) {
    const t = data.transactions[i];
    const folioNo = t.folio_number;
    const resolved = folioNo ? folioResolved.get(folioNo) : undefined;
    if (!resolved) {
      skipped++;
      if (errors.length < 25) {
        const fpFolio = folioNo ? folioByNumber.get(folioNo) : undefined;
        const why = !fpFolio
          ? "folio not returned by the mailback service"
          : !fpFolio.primary_investor_pan
            ? "mailback folio has no PAN"
            : `PAN ${fpFolio.primary_investor_pan} not in client master — import the client master first`;
        errors.push({ row: i + 1, reason: `Folio ${folioNo ?? "?"}: ${why}` });
      }
      continue;
    }

    const { type, direction } = mapFpType(t.type);
    const localType = LOCAL_TX_TYPES.has(type) ? type : "purchase";
    const tradedOn = t.traded_on ?? null;
    if (tradedOn) {
      if (tradedOn < minDate) minDate = tradedOn;
      if (tradedOn > maxDate) maxDate = tradedOn;
    }
    const gain = gainOf(t);
    if (direction === "outflow") capitalGainsTotal += gain;

    const dedupKey = dedupKeyFor(t, i);
    const raw = {
      fp_type: t.type,
      isin: t.isin ?? null,
      rta_order_reference: t.rta_order_reference ?? null,
      rta_product_code: t.rta_product_code ?? null,
      rta_investment_option: t.rta_investment_option ?? null,
      mf_investment_account: t.mf_investment_account ?? null,
      // FIFO capital-gains lots — the data the local parser can't produce.
      capital_gains: { total: gain, sources: t.sources ?? [] },
    };

    try {
      await tx.execute(sql`
        INSERT INTO transactions (
          tenant_id, investor_id, folio_id, folio_number, amc_code, amc_name,
          scheme_code, scheme_name, type, direction, amount, units, nav,
          order_date, status, source_feed, dedup_key, raw_feed_row
        ) VALUES (
          ${tenantId}::uuid, ${resolved.investorId}::uuid, ${resolved.folioId}::uuid, ${folioNo},
          ${folioByNumber.get(folioNo!)?.amc ?? null}, ${folioByNumber.get(folioNo!)?.amc ?? null},
          ${t.rta_product_code ?? t.isin ?? null}, ${t.rta_scheme_name ?? null},
          ${localType}, ${direction}, ${t.amount ?? null}, ${t.units ?? null}, ${t.traded_at ?? null},
          ${tradedOn}::date, 'processed', 'other', ${dedupKey}, ${JSON.stringify(raw)}::jsonb
        )
        ON CONFLICT (tenant_id, dedup_key) DO UPDATE SET
          amount = EXCLUDED.amount,
          units = EXCLUDED.units,
          nav = EXCLUDED.nav,
          status = EXCLUDED.status,
          raw_feed_row = EXCLUDED.raw_feed_row,
          updated_at = now()
      `);
      imported++;
      if (tradedOn) {
        const prev = lastTxByInvestor.get(resolved.investorId);
        if (!prev || tradedOn > prev) lastTxByInvestor.set(resolved.investorId, tradedOn);
      }
    } catch (e: any) {
      failed++;
      if (errors.length < 25) errors.push({ row: i + 1, reason: e?.message ?? "insert failed" });
    }
  }

  // 4. Bump last_transaction_at (forward only) so dormancy/health reflect the feed.
  for (const [investorId, d] of lastTxByInvestor) {
    await tx.execute(sql`
      UPDATE investors
         SET last_transaction_at = GREATEST(COALESCE(last_transaction_at, 'epoch'::timestamptz), ${d}::timestamptz),
             updated_at = now()
       WHERE id = ${investorId}::uuid
    `);
  }

  const today = new Date().toISOString().slice(0, 10);
  return {
    foliosTotal: data.folios.length,
    foliosMatched,
    foliosUnmatched: data.folios.length - foliosMatched,
    txTotal: data.transactions.length,
    txImported: imported,
    txSkipped: skipped,
    txFailed: failed,
    capitalGainsTotal: Math.round(capitalGainsTotal * 100) / 100,
    periodStart: minDate === "9999-12-31" ? today : minDate,
    periodEnd: maxDate === "0000-01-01" ? today : maxDate,
    foliosCapHit: data.foliosCapHit,
    errors,
  };
}
