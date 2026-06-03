/**
 * RTA file processor.
 *
 * Takes the raw text of an uploaded RTA file plus its (source, kind) tuple
 * and applies it to the correct downstream tables.
 *
 * Idempotency: every row carries a deterministic `external_ref` (order id /
 * mandate id / brokerage row id). We upsert keyed on that ref so a
 * re-uploaded file is a no-op.
 *
 * Returns per-import counters that the API surfaces to the user.
 *
 * Note: this runs synchronously inside the upload request. Files larger than
 * ~50k rows should be queued via BullMQ — out of scope for v1.
 */

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  parseCamsFeed,
  parseKfintechFeed,
  type CanonicalTransaction,
} from "@/lib/integrations/cams-feed-parser";
import type { RtaFileKind, RtaSource } from "@/db/schema/rta_imports";
import {
  parseSipRejectionReport,
  parseBrokerageStatement,
  type CanonicalSipRejection,
  type CanonicalBrokerageRow,
} from "./parsers";

export type ProcessOutcome = {
  rowsTotal: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsFailed: number;
  errors: Array<{ row: number; reason: string }>;
  periodStart: string;
  periodEnd: string;
};

/**
 * Top-level entry point. Dispatches by file kind.
 */
export async function processRtaFile(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; kind: RtaFileKind; text: string }
): Promise<ProcessOutcome> {
  switch (args.kind) {
    case "daily_transaction_feed":
    case "redemption_report":
      return processTransactionFeed(tx, args);
    case "sip_rejection_report":
      return processSipRejectionReport(tx, args);
    case "monthly_brokerage":
      return processBrokerageStatement(tx, args);
    // The rest fall through to a generic "store but don't parse" — gives
    // tenants a place to keep the file with audit while we ship the parser.
    default:
      return {
        rowsTotal: 0,
        rowsImported: 0,
        rowsSkipped: 0,
        rowsFailed: 0,
        errors: [],
        periodStart: today(),
        periodEnd: today(),
      };
  }
}

// ── Transaction feed (daily) ─────────────────────────────────────────────

async function processTransactionFeed(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const rows: CanonicalTransaction[] =
    args.source === "kfintech"
      ? parseKfintechFeed(args.text)
      : parseCamsFeed(args.text);

  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let minDate = "9999-12-31";
  let maxDate = "0000-01-01";
  // Newest processed order_date per investor → bump last_transaction_at so
  // dormancy / health / churn reflect the freshly-ingested feed.
  const lastTxByInvestor = new Map<string, string>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.pan || !r.folioNumber) {
      skipped++;
      continue;
    }
    if (r.orderDate < minDate) minDate = r.orderDate;
    if (r.orderDate > maxDate) maxDate = r.orderDate;

    // Find the investor by PAN within this tenant. RLS scopes the query.
    const investor = await tx.execute(sql`
      SELECT id FROM investors WHERE tenant_id = ${args.tenantId}::uuid AND pan = ${r.pan.toUpperCase()} LIMIT 1
    `);
    const investorId = (investor.rows[0] as any)?.id;
    if (!investorId) {
      skipped++;
      errors.push({ row: i + 1, reason: `PAN ${r.pan} not in client master — skipped` });
      continue;
    }

    try {
      // UPSERT keyed by (tenant_id, order_id) so re-uploads no-op, but updates status/NAV/units.
      await tx.execute(sql`
        INSERT INTO transactions (
          tenant_id, investor_id, folio_number, amc_code, amc_name, scheme_code, scheme_name,
          type, direction, amount, units, nav, order_id, order_date, status,
          reason_code, reason_description
        ) VALUES (
          ${args.tenantId}::uuid, ${investorId}::uuid, ${r.folioNumber}, ${r.amcCode}, ${r.amcCode},
          ${r.schemeCode}, ${r.schemeName}, ${r.type}, ${r.direction},
          ${r.amount}, ${r.units}, ${r.nav}, ${r.externalRef}, ${r.orderDate}::date,
          ${normaliseStatus(r.status)}, ${r.reasonCode ?? null}, ${r.reasonDescription ?? null}
        )
        ON CONFLICT (tenant_id, order_id) WHERE order_id IS NOT NULL DO UPDATE SET
          status = EXCLUDED.status,
          nav = EXCLUDED.nav,
          units = EXCLUDED.units,
          reason_code = EXCLUDED.reason_code,
          reason_description = EXCLUDED.reason_description,
          updated_at = now()
      `);
      imported++;
      if (normaliseStatus(r.status) === "processed") {
        const prev = lastTxByInvestor.get(investorId);
        if (!prev || r.orderDate > prev) lastTxByInvestor.set(investorId, r.orderDate);
      }
    } catch (e: any) {
      failed++;
      if (errors.length < 25) errors.push({ row: i + 1, reason: e.message ?? "insert failed" });
    }
  }

  // Bump last_transaction_at (forward only) for each affected investor.
  for (const [investorId, maxOrderDate] of lastTxByInvestor) {
    await tx.execute(sql`
      UPDATE investors
         SET last_transaction_at = GREATEST(COALESCE(last_transaction_at, 'epoch'::timestamptz), ${maxOrderDate}::timestamptz),
             updated_at = now()
       WHERE id = ${investorId}::uuid
    `);
  }

  return {
    rowsTotal: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: minDate === "9999-12-31" ? today() : minDate,
    periodEnd: maxDate === "0000-01-01" ? today() : maxDate,
  };
}

// ── SIP rejection report (daily) ─────────────────────────────────────────

async function processSipRejectionReport(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const rows: CanonicalSipRejection[] = parseSipRejectionReport(args.text, args.source);
  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let minDate = "9999-12-31";
  let maxDate = "0000-01-01";

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.rejectionDate < minDate) minDate = r.rejectionDate;
    if (r.rejectionDate > maxDate) maxDate = r.rejectionDate;

    const investor = await tx.execute(sql`
      SELECT id, rm_id FROM investors WHERE tenant_id = ${args.tenantId}::uuid AND pan = ${r.pan.toUpperCase()} LIMIT 1
    `);
    const investorId = (investor.rows[0] as any)?.id;
    const investorRmId = (investor.rows[0] as any)?.rm_id ?? null;
    if (!investorId) {
      skipped++;
      errors.push({ row: i + 1, reason: `PAN ${r.pan} not in client master` });
      continue;
    }

    const reasonCode = classifyRejectionReason(r.reason, r.reasonCode);
    // 2-day follow-up from the rejection date — mirrors the manual create API so
    // imported rejections land in the tracker with an RM owner + an SLA clock,
    // not a blank "RM" column. The `transaction.failed.sip_rejection` event
    // (emitted below) still drives task/WhatsApp via the recipe — we don't
    // double-create a task here.
    const followUp = new Date(new Date(r.rejectionDate).getTime() + 2 * 864e5)
      .toISOString()
      .slice(0, 10);
    const dedupKey = naturalKeyHash([investorId, r.rejectionDate, r.amount, r.schemeName, r.folioNumber]);
    try {
      const ins = await tx.execute(sql`
        INSERT INTO sip_rejections (
          tenant_id, investor_id, rejection_date, rejection_amount,
          rejection_reason, scheme_name, folio_number, amc_name, recovery_status,
          assigned_rm_id, follow_up_date, reason_category, dedup_key
        ) VALUES (
          ${args.tenantId}::uuid, ${investorId}::uuid, ${r.rejectionDate}::date,
          ${r.amount}, ${r.reason}, ${r.schemeName}, ${r.folioNumber}, ${r.amcName}, 'pending',
          ${investorRmId}, ${followUp}::date, ${reasonCode}, ${dedupKey}
        )
        ON CONFLICT (tenant_id, dedup_key) DO NOTHING
        RETURNING id
      `);
      if ((ins as any).rows.length > 0) {
        imported++;
        // Emit the event the sip_rejection_followup recipe subscribes to — the
        // canonical rejection report previously produced NO automation event.
        // Only on a real insert, so re-uploads (ON CONFLICT) never re-fire.
        await tx.execute(sql`
          INSERT INTO events_outbox (tenant_id, kind, entity_type, entity_id, after, meta)
          VALUES (
            ${args.tenantId}::uuid, 'transaction.failed.sip_rejection', 'investor', ${investorId}::uuid,
            ${JSON.stringify({
              reason_code: reasonCode,
              reason: r.reason,
              scheme_name: r.schemeName,
              amount: r.amount,
              order_date: r.rejectionDate,
            })}::jsonb,
            ${JSON.stringify({ source: "rta-import", dedupKey })}::jsonb
          )
        `);
      } else {
        skipped++; // already imported — idempotent
      }
    } catch (e: any) {
      failed++;
      if (errors.length < 25) errors.push({ row: i + 1, reason: e.message ?? "insert failed" });
    }
  }

  return {
    rowsTotal: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: minDate === "9999-12-31" ? today() : minDate,
    periodEnd: maxDate === "0000-01-01" ? today() : maxDate,
  };
}

// ── Monthly brokerage statement ──────────────────────────────────────────

async function processBrokerageStatement(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const rows: CanonicalBrokerageRow[] = parseBrokerageStatement(args.text, args.source);
  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let minDate = "9999-12-31";
  let maxDate = "0000-01-01";

  // Brokerage flows into commission_rows (already exists). If commission
  // schema isn't available we degrade gracefully.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.periodStart < minDate) minDate = r.periodStart;
    if (r.periodEnd > maxDate) maxDate = r.periodEnd;

    try {
      await tx.execute(sql`
        INSERT INTO commission_rows (
          tenant_id, amc_code, scheme_code, scheme_name, folio_number,
          pan, brokerage_type, period_start, period_end,
          aum_amount, brokerage_rate, brokerage_amount, source
        ) VALUES (
          ${args.tenantId}::uuid, ${r.amcCode}, ${r.schemeCode}, ${r.schemeName}, ${r.folioNumber},
          ${r.pan.toUpperCase()}, ${r.brokerageType}, ${r.periodStart}::date, ${r.periodEnd}::date,
          ${r.aumAmount}, ${r.brokerageRate}, ${r.brokerageAmount}, ${args.source}
        )
        ON CONFLICT DO NOTHING
      `);
      imported++;
    } catch (e: any) {
      // Table may not exist yet on some envs — soft-skip.
      if (e.message?.includes("does not exist")) {
        skipped++;
      } else {
        failed++;
        if (errors.length < 25) errors.push({ row: i + 1, reason: e.message ?? "insert failed" });
      }
    }
  }

  return {
    rowsTotal: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: minDate === "9999-12-31" ? today() : minDate,
    periodEnd: maxDate === "0000-01-01" ? today() : maxDate,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** CAMS feed status → our canonical transactions.status enum. */
function normaliseStatus(s: string): string {
  switch (s) {
    case "successful":
      return "processed";
    case "rejected":
    case "failed":
      return "rejected"; // canonical (a NACH bounce is a rejection)
    case "pending":
      return "pending";
    default:
      return "pending";
  }
}

/** Classify a free-text / coded rejection reason into the slugs the
 *  sip_rejection_followup recipe branches on (insufficient_balance /
 *  mandate_expired / technical). */
function classifyRejectionReason(reason: string, reasonCode?: string): string {
  const r = `${reason ?? ""} ${reasonCode ?? ""}`.toLowerCase();
  if (/insufficient|balance|funds|nsf|inqufd/.test(r)) return "insufficient_balance";
  if (/mandate|expired|umrn|nach|debit not|not registered/.test(r)) return "mandate_expired";
  return "technical";
}

/** Deterministic idempotency hash of a row's natural key. */
function naturalKeyHash(parts: Array<string | number | null | undefined>): string {
  return "nk:" + createHash("sha256").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex").slice(0, 40);
}
