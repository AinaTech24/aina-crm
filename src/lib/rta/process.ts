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
import { InvestorDirectory, nopanFolioKey, type Resolution } from "./identity";
import { InvestorOwnerDirectory } from "./owner-directory";
import { deriveHolder, resolveOwner } from "./owner";
import { maskPansInText, maskPanValue, validPan } from "./values";
import type { RtaFileKind, RtaSource } from "@/db/schema/rta_imports";
import { refreshActiveSipAmount } from "@/lib/metrics/sip";
import { markSystematicTransfers, NOT_A_SIP_REMARK } from "@/lib/finance/sip-lifecycle";
import {
  parseSipRejectionReport,
  parseBrokerageStatement,
  parseFolioMasterDump,
  parseSipBook,
  parseMandateStatus,
  parseAumStatement,
  type CanonicalSipRejection,
  type CanonicalBrokerageRow,
  type CanonicalFolioRow,
  type CanonicalSipRow,
  type CanonicalMandateRow,
  type CanonicalAumRow,
} from "./parsers";

/** Registrar names arrive padded, upper-cased and sometimes NUL-laden. */
function sanitizeName(name?: string): string | null {
  const s = (name ?? "").replace(/[\x00-\x1F]/g, " ").replace(/\s+/g, " ").trim();
  return s.length >= 2 ? s.slice(0, 160) : null;
}

/**
 * Registrars pack a minor and their guardian into ONE name field:
 * "KAVYAAN GOEL REP BY GAURAV GOEL". Stored verbatim that becomes a client
 * literally called that — and because the guardian's name rides along, the SAME
 * minor spells differently across folios, defeating name-based dedup.
 */
export function splitRepresentedBy(raw?: string): { name: string | null; guardian: string | null; isMinor: boolean } {
  const s = sanitizeName(raw);
  if (!s) return { name: null, guardian: null, isMinor: false };
  const m = s.match(/^(.*?)\s+(?:REP(?:RESENTED)?\b\.?\s*BY|C\s*\/\s*O|GUARDIAN\s*[:\-]?)\s+(.+)$/i);
  if (!m) return { name: s, guardian: null, isMinor: false };
  const name = sanitizeName(m[1]);
  const guardian = sanitizeName(m[2]);
  // Only treat it as a split when BOTH halves survive; "REP BY" with nothing
  // before it is a malformed row, not a minor.
  return name && guardian ? { name, guardian, isMinor: true } : { name: s, guardian: null, isMinor: false };
}

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
 * Seed an outcome with the parser's rejects: each is a skipped row with its
 * reason, so a row the parser would not read is counted and shown, never lost.
 */
function startOutcome(parsed: { rows: unknown[]; rejects: Array<{ line: number; reason: string }>; notes?: string[] }) {
  const errors: Array<{ row: number; reason: string }> = parsed.rejects.map((r) => ({ row: r.line, reason: r.reason }));
  for (const n of parsed.notes ?? []) errors.push({ row: 0, reason: n });
  return { errors, counts: { skipped: parsed.rejects.length, rejected: parsed.rejects.length } };
}

/** Why a row could not be attached to a client (PAN masked later, centrally). */
function notAttached(res: Resolution, pan?: string | null, folio?: string | null): string {
  const who = [folio ? `folio ${folio}` : null, validPan(pan) ? `PAN ${validPan(pan)}` : null].filter(Boolean).join(" / ") || "row";
  if (res.kind === "blocked" || res.kind === "ambiguous") return `${who}: ${res.reason}`;
  return `${who} not in client master`;
}

/**
 * Top-level entry point. Dispatches by file kind.
 */
async function processRtaFileUnsafe(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; kind: RtaFileKind; text: string }
): Promise<ProcessOutcome> {
  // Large RTA files (100k+ rows) processed in one transaction can exceed the
  // 30s pool statement_timeout. Lift it for this import transaction only.
  await tx.execute(sql`SET LOCAL statement_timeout = '600s'`);
  switch (args.kind) {
    case "daily_transaction_feed":
    case "redemption_report":
      return processTransactionFeed(tx, args);
    case "sip_rejection_report":
      return processSipRejectionReport(tx, args);
    case "monthly_brokerage":
      return processBrokerageStatement(tx, args);
    case "folio_master_dump":
    case "cas_holdings":
      return processFolioMasterDump(tx, args);
    case "monthly_sip_book":
      return processSipBook(tx, args);
    case "nach_mandate_status":
      return processMandateStatus(tx, args);
    case "monthly_aum_statement":
      return processAumStatement(tx, args);
    // The rest fall through to a generic "store but don't parse"
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
  // Throws RtaLayoutError for a file that cannot be read safely as a whole
  // (no header, a required column missing — including the registrar's
  // transaction number). The worker records that as a failed import.
  const parsed = args.source === "kfintech" ? parseKfintechFeed(args.text) : parseCamsFeed(args.text);
  const rows: CanonicalTransaction[] = parsed.rows;

  const errors: Array<{ row: number; reason: string }> = [];
  const fail = (line: number, reason: string) => errors.push({ row: line, reason: maskPansInText(reason) });
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let minDate = "9999-12-31";
  let maxDate = "0000-01-01";
  // Newest processed order_date per investor → bump last_transaction_at so
  // dormancy / health / churn reflect the freshly-ingested feed.
  const lastTxByInvestor = new Map<string, string>();

  for (const r of parsed.rejects) {
    skipped++;
    fail(r.line, r.reason);
  }

  // Everything the rows can touch, loaded once in chunked bulk queries.
  const dir = new InvestorDirectory(tx, args.tenantId);
  await dir.preload({
    pans: rows.map((r) => r.pan),
    folios: rows.map((r) => r.folioNumber),
    nopanKeys: [...new Set(rows.map((r) => nopanFolioKey(r.folioNumber)))],
  });

  /** (amc_code, folio_number) → folio id + its owner, resolved once per folio. */
  const folioCache = new Map<string, { id: string; investorId: string }>();
  const rtaEnumVal = args.source === "cams" || args.source === "kfintech" ? args.source : "other";

  const owners = new InvestorOwnerDirectory(dir);
  for (const r of rows) {
    // ── A MINOR's row: the PAN on it is the guardian's ──────────────────────
    // CAMS R2 prints the guardian's PAN on every minor row (verified 22/22,
    // 2026-10-08). Resolving it by PAN put a minor's folio — and its money —
    // on the guardian's own client record whenever the master had not created
    // the minor first (19 of 19 minor folios in the real-file test). A minor's
    // row now attaches ONLY to the folio already on record for that minor;
    // otherwise it is held back for review. Never to the guardian.
    const holder = deriveHolder({ statusText: r.holderStatus, rowPan: r.pan, rowPanRole: "owner_or_guardian" });
    let minorOwnerId: string | null = null;
    if (holder.ownerType === "minor") {
      const d = await resolveOwner(owners, { rta: rtaEnumVal, amcCode: r.amcCode, folioNumber: r.folioNumber }, holder);
      if (d.kind !== "existing_folio_owner") {
        skipped++;
        fail(r.line, d.kind === "exception"
          ? `folio ${r.folioNumber} (a minor's folio): ${d.reason}`
          : `folio ${r.folioNumber} belongs to a minor and is not yet in the client master — import the folio master (R9 / MFSD211) first; the PAN on this row is the guardian's and is never used to attach a minor's transaction`);
        continue;
      }
      minorOwnerId = d.investorId;
    }

    // ── Who is this row's client? ─────────────────────────────────────────
    const pan = minorOwnerId ? null : validPan(r.pan);
    const res = minorOwnerId ? ({ kind: "found", id: minorOwnerId, rmId: null } as const) : await dir.resolve({ pan, folioNumber: r.folioNumber, amcCode: r.amcCode });

    if (res.kind === "blocked" || res.kind === "ambiguous") {
      skipped++;
      fail(r.line, `folio ${r.folioNumber}: ${res.reason}`);
      continue;
    }

    let investorId: string | null = res.kind === "found" ? res.id : null;

    // Not in the book yet. A valid PAN stands the client up from the feed
    // itself (PAN-deduped, so the folio master later UPDATES this row). The
    // directory already ruled out a client in Trash holding this PAN.
    if (!investorId && pan) {
      const created = await tx.execute(sql`
        INSERT INTO investors (tenant_id, pan, name, investor_category, kyc_status)
        VALUES (${args.tenantId}::uuid, ${pan}, ${sanitizeName(r.investorName) ?? `PAN ${maskPanValue(pan)}`}, 'individual', 'pending')
        ON CONFLICT (tenant_id, pan) WHERE dedup_pan AND pan IS NOT NULL
        DO UPDATE SET updated_at = now()
        RETURNING id, deleted_at, merged_into_id
      `);
      const row = created.rows[0] as { id: string; deleted_at: string | null; merged_into_id: string | null } | undefined;
      if (row && !row.deleted_at && !row.merged_into_id) {
        investorId = String(row.id);
        dir.remember({ id: investorId, pan });
      }
    }

    // No usable PAN and the folio is not in the book: a placeholder client
    // keyed on the FOLIO (never on a name, mobile or email — two people can
    // share those, and a shared key merges them into one client). The folio
    // master later re-points the folio to the PAN-keyed client and moves this
    // folio's transactions with it (lib/rta/import.ts).
    if (!investorId && !pan) {
      const key = nopanFolioKey(r.folioNumber);
      const existing = await dir.byNopanKey(key);
      if (existing.kind === "blocked" || existing.kind === "ambiguous") {
        skipped++;
        fail(r.line, `folio ${r.folioNumber}: ${existing.reason}`);
        continue;
      }
      if (existing.kind === "found") investorId = existing.id;
      else {
        const who = splitRepresentedBy(r.investorName);
        const created = await tx.execute(sql`
          INSERT INTO investors (tenant_id, pan, rta_nopan_key, name, investor_category, is_minor, kyc_status)
          VALUES (
            ${args.tenantId}::uuid, NULL, ${key},
            ${who.name ?? `Folio ${r.folioNumber}`},
            ${who.isMinor ? "minor" : "individual"}, ${who.isMinor}, 'pending'
          )
          ON CONFLICT (tenant_id, rta_nopan_key) WHERE rta_nopan_key IS NOT NULL
          DO UPDATE SET updated_at = now()
          RETURNING id, deleted_at, merged_into_id
        `);
        const row = created.rows[0] as { id: string; deleted_at: string | null; merged_into_id: string | null } | undefined;
        if (row && !row.deleted_at && !row.merged_into_id) {
          investorId = String(row.id);
          dir.remember({ id: investorId, rta_nopan_key: key });
        }
      }
    }

    if (!investorId) {
      skipped++;
      fail(r.line, `folio ${r.folioNumber}${pan ? ` / PAN ${pan}` : ""} could not be attached to a client`);
      continue;
    }

    if (r.orderDate < minDate) minDate = r.orderDate;
    if (r.orderDate > maxDate) maxDate = r.orderDate;

    const folioKey = `${r.amcCode}::${r.folioNumber}`;
    let cachedFolioThisRow = false;

    await tx.execute(sql`SAVEPOINT rta_item`);
    try {
      // Resolve or create the folio — once per folio. The feed never moves a
      // folio between clients: when the folio already exists under ANOTHER
      // client than the row's PAN names, the row is held back for review.
      let folio = folioCache.get(folioKey);
      if (!folio) {
        const folioRes = await tx.execute(sql`
          INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta)
          VALUES (${args.tenantId}::uuid, ${investorId}::uuid, ${r.folioNumber}, ${r.amcCode}, ${r.amcCode}, ${rtaEnumVal})
          ON CONFLICT (tenant_id, amc_code, folio_number) DO UPDATE SET updated_at = now()
          RETURNING id, investor_id
        `);
        const fr = folioRes.rows[0] as { id: string; investor_id: string | null } | undefined;
        if (fr) {
          folio = { id: String(fr.id), investorId: fr.investor_id ? String(fr.investor_id) : investorId };
          folioCache.set(folioKey, folio);
          cachedFolioThisRow = true;
          dir.rememberFolio({ id: folio.id, amc_code: r.amcCode, folio_number: r.folioNumber, investor_id: folio.investorId });
        }
      }
      if (!folio) throw new Error(`folio ${r.folioNumber} could not be created`);
      if (folio.investorId !== investorId) {
        const owner = await dir.byFolio(r.folioNumber, r.amcCode);
        // A minor's folio reported with the GUARDIAN's PAN belongs to the minor.
        if (owner.kind === "found" && dir.isGuardianOf(investorId, owner.id)) investorId = owner.id;
        if (!(owner.kind === "found" && owner.id === investorId)) {
          await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_item`);
          await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
          if (cachedFolioThisRow) folioCache.delete(folioKey);
          skipped++;
          fail(r.line, `folio ${r.folioNumber} belongs to a different client in the CRM than the one this row's PAN names — held back for review, nothing reassigned`);
          continue;
        }
      }

      // Registrar transaction number is the identity. An existing row with the
      // same number is updated ONLY when it is evidently the same transaction
      // (same folio, scheme, date, type, direction and amount): then status,
      // NAV, units and reason refresh. Anything else is a DIFFERENT
      // transaction that happens to share the number — it is left untouched
      // and reported, never overwritten. Amount, date, type and client are
      // never "corrected" in place.
      const ins = await tx.execute(sql`
        INSERT INTO transactions (
          tenant_id, investor_id, folio_id, folio_number, amc_code, amc_name, scheme_code, scheme_name,
          type, direction, amount, units, nav, order_id, order_date, status,
          reason_code, reason_description
        ) VALUES (
          ${args.tenantId}::uuid, ${investorId}::uuid, ${folio.id}::uuid, ${r.folioNumber}, ${r.amcCode}, ${r.amcCode},
          ${r.schemeCode}, ${r.schemeName}, ${r.type}, ${r.direction},
          ${r.amount}, ${r.units}, ${r.nav}, ${r.externalRef}, ${r.orderDate}::date,
          ${normaliseStatus(r.status)}, ${r.reasonCode ?? null}, ${r.reasonDescription ?? null}
        )
        ON CONFLICT (tenant_id, order_id) WHERE order_id IS NOT NULL DO UPDATE SET
          status = EXCLUDED.status,
          nav = COALESCE(EXCLUDED.nav, transactions.nav),
          units = EXCLUDED.units,
          reason_code = EXCLUDED.reason_code,
          reason_description = EXCLUDED.reason_description,
          updated_at = now()
        WHERE transactions.folio_number = EXCLUDED.folio_number
          AND transactions.scheme_code IS NOT DISTINCT FROM EXCLUDED.scheme_code
          AND transactions.order_date = EXCLUDED.order_date
          AND transactions.type = EXCLUDED.type
          AND transactions.direction IS NOT DISTINCT FROM EXCLUDED.direction
          AND transactions.amount = EXCLUDED.amount
        RETURNING id
      `);
      if (ins.rows.length === 0) {
        // Undo the whole row — including a folio this row may have created —
        // so a rejected row leaves nothing behind.
        await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_item`);
        await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
        if (cachedFolioThisRow) folioCache.delete(folioKey);
        skipped++;
        fail(
          r.line,
          `transaction number ${r.externalRef} is already in the CRM for a different transaction (folio, scheme, date, type or amount differ) — existing record left unchanged, this row not imported`
        );
        continue;
      }
      imported++;
      if (normaliseStatus(r.status) === "processed") {
        const prev = lastTxByInvestor.get(investorId);
        if (!prev || r.orderDate > prev) lastTxByInvestor.set(investorId, r.orderDate);
      }
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
    } catch (e: any) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_item`);
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
      // The rollback undid the folio this row inserted, so the id we cached no
      // longer exists. Leaving it would make every later row for the same folio
      // write a transaction pointing at a dead folio_id and fail on the foreign
      // key — turning one bad row into a bad folio.
      if (cachedFolioThisRow) folioCache.delete(folioKey);
      failed++;
      fail(r.line, e?.message ?? "insert failed");
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

  // Data lines the parser saw — accepted rows plus rejected ones.
  const rowsTotal = parsed.dataLines;
  return {
    rowsTotal,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors: errors.sort((a, b) => a.row - b.row),
    // A file with no importable row has no period; the worker records today
    // as the upload's period, which is about the upload, not a transaction.
    periodStart: minDate === "9999-12-31" ? today() : minDate,
    periodEnd: maxDate === "0000-01-01" ? today() : maxDate,
  };
}

// ── SIP rejection report (daily) ─────────────────────────────────────────

async function processSipRejectionReport(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const parsed = parseSipRejectionReport(args.text, args.source);
  const rows: CanonicalSipRejection[] = parsed.rows;
  const { errors, counts } = startOutcome(parsed);
  let imported = 0;
  let skipped = counts.skipped;
  let failed = 0;
  let minDate = "9999-12-31";
  let maxDate = "0000-01-01";
  const dir = new InvestorDirectory(tx, args.tenantId);
  await dir.preload({ pans: rows.map((r) => r.pan), folios: rows.map((r) => r.folioNumber) });

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.rejectionDate < minDate) minDate = r.rejectionDate;
    if (r.rejectionDate > maxDate) maxDate = r.rejectionDate;

    const who = await dir.resolve({ pan: r.pan, folioNumber: r.folioNumber });
    if (who.kind !== "found") {
      skipped++;
      errors.push({ row: r.line, reason: notAttached(who, r.pan, r.folioNumber) });
      continue;
    }
    const investorId = who.id;
    const investorRmId = who.rmId;

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
    await tx.execute(sql`SAVEPOINT rta_item`);
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
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
    } catch (e: any) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_item`);
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
      failed++;
      errors.push({ row: r.line, reason: e.message ?? "insert failed" });
    }
  }

  return {
    rowsTotal: rows.length + counts.rejected,
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
  const parsed = parseBrokerageStatement(args.text, args.source);
  const rows: CanonicalBrokerageRow[] = parsed.rows;
  const { errors, counts } = startOutcome(parsed);
  let imported = 0;
  let skipped = counts.skipped;
  let failed = 0;
  let minDate = "9999-12-31";
  let maxDate = "0000-01-01";

  // Brokerage flows into commission_rows (already exists). If commission
  // schema isn't available we degrade gracefully.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.periodStart < minDate) minDate = r.periodStart;
    if (r.periodEnd > maxDate) maxDate = r.periodEnd;

    await tx.execute(sql`SAVEPOINT rta_item`);
    try {
      await tx.execute(sql`
        INSERT INTO commission_rows (
          tenant_id, amc_code, scheme_code, scheme_name, folio_number,
          pan, brokerage_type, period_start, period_end,
          aum_amount, brokerage_rate, brokerage_amount, source
        ) VALUES (
          ${args.tenantId}::uuid, ${r.amcCode}, ${r.schemeCode}, ${r.schemeName}, ${r.folioNumber},
          ${validPan(r.pan) ?? (r.pan ? r.pan.toUpperCase() : null)}, ${r.brokerageType}, ${r.periodStart}::date, ${r.periodEnd}::date,
          ${r.aumAmount}, ${r.brokerageRate}, ${r.brokerageAmount}, ${args.source}
        )
        ON CONFLICT DO NOTHING
      `);
      imported++;
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
    } catch (e: any) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_item`);
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
      // Table may not exist yet on some envs — soft-skip.
      if (e.message?.includes("does not exist")) {
        skipped++;
      } else {
        failed++;
        errors.push({ row: r.line, reason: e.message ?? "insert failed" });
      }
    }
  }

  return {
    rowsTotal: rows.length + counts.rejected,
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

// ── Additional kind handlers ─────────────────────────────────────────────

async function processFolioMasterDump(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const parsed = parseFolioMasterDump(args.text, args.source);
  const rows: CanonicalFolioRow[] = parsed.rows;

  const { errors, counts } = startOutcome(parsed);
  let imported = 0;
  let skipped = counts.skipped;
  const dir = new InvestorDirectory(tx, args.tenantId);
  await dir.preload({ pans: rows.map((r) => r.pan) });
  let failed = 0;

  // Group rows by folio number and amc code to do batch updates of the schemes array
  const folioRowsGrouped = new Map<string, CanonicalFolioRow[]>();
  for (const r of rows) {
    if (!validPan(r.pan) || !r.folioNumber || !r.amcCode) {
      skipped++;
      errors.push({ row: r.line, reason: `row carries no ${!validPan(r.pan) ? "valid PAN" : !r.folioNumber ? "folio number" : "AMC code"} — this report keys clients on PAN` });
      continue;
    }
    const key = `${r.amcCode}__${r.folioNumber}`;
    if (!folioRowsGrouped.has(key)) {
      folioRowsGrouped.set(key, []);
    }
    folioRowsGrouped.get(key)!.push(r);
  }

  const rtaEnumVal = (args.source === "cams" || args.source === "kfintech") ? args.source : "other";

  for (const [key, fRows] of folioRowsGrouped) {
    const firstRow = fRows[0];
    const who = await dir.byPan(firstRow.pan);
    if (who.kind !== "found") {
      skipped += fRows.length;
      errors.push({ row: firstRow.line, reason: notAttached(who, firstRow.pan, firstRow.folioNumber) });
      continue;
    }
    const investorId = who.id;

    await tx.execute(sql`SAVEPOINT rta_item`);
    try {
      // Find or create folio
      const folioRes = await tx.execute(sql`
        INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta)
        VALUES (${args.tenantId}::uuid, ${investorId}::uuid, ${firstRow.folioNumber}, ${firstRow.amcCode}, ${firstRow.amcName}, ${rtaEnumVal})
        ON CONFLICT (tenant_id, amc_code, folio_number) DO UPDATE SET updated_at = now()
        RETURNING id, schemes, investor_id
      `);
      const folioId = (folioRes.rows[0] as any)?.id;
      const folioOwner = (folioRes.rows[0] as any)?.investor_id;
      if (folioOwner && String(folioOwner) !== investorId) {
        const owner = await dir.byFolio(firstRow.folioNumber, firstRow.amcCode);
        if (!(owner.kind === "found" && owner.id === investorId)) {
          throw new Error(`folio ${firstRow.folioNumber} belongs to a different client in the CRM than this PAN — held back for review, nothing reassigned`);
        }
      }
      const existingSchemes = ((folioRes.rows[0] as any)?.schemes ?? []) as Array<{
        schemeCode: string;
        schemeName: string;
        category?: string;
        units?: number;
        nav?: number;
        value?: number;
      }>;

      // Merge new schemes with existing schemes
      const schemesMap = new Map<string, typeof existingSchemes[number]>();
      for (const s of existingSchemes) {
        if (s.schemeCode) schemesMap.set(s.schemeCode, s);
      }

      for (const r of fRows) {
        if (!r.schemeCode) continue;
        const current = schemesMap.get(r.schemeCode);
        schemesMap.set(r.schemeCode, {
          schemeCode: r.schemeCode,
          schemeName: r.schemeName || current?.schemeName || "",
          units: r.units,
          nav: current?.nav,
          value: current?.nav ? Math.round(r.units * current.nav * 100) / 100 : r.value || current?.value,
        });
      }

      const mergedSchemes = Array.from(schemesMap.values());
      const roundedAum = mergedSchemes.reduce((acc, s) => acc + (s.value ?? 0), 0);

      await tx.execute(sql`
        UPDATE folios
        SET schemes = ${JSON.stringify(mergedSchemes)}::jsonb,
            aum = ${roundedAum}::numeric,
            updated_at = now()
        WHERE id = ${folioId}::uuid
      `);

      imported += fRows.length;
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
    } catch (e: any) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_item`);
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
      failed += fRows.length;
      errors.push({ row: firstRow.line, reason: e.message ?? "folio master import failed" });
    }
  }

  await tx.execute(sql`SAVEPOINT rta_refresh`);
  try {
    const { revalueAllFolios, recomputeCombinedAum } = await import("@/lib/finance/aum-persist");
    await revalueAllFolios(tx);
    // Roll the (just-imported) folio holdings up to investors.aum so the client
    // profile headline reflects them — combined with transaction-derived value
    // for any scheme the folios don't cover. Without this, a holdings-only book
    // (RTA folio-master / AUM import, no transaction feed) shows ₹0 AUM.
    await recomputeCombinedAum(tx);
    await tx.execute(sql`RELEASE SAVEPOINT rta_refresh`);
  } catch (err: any) {
    await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_refresh`);
    await tx.execute(sql`RELEASE SAVEPOINT rta_refresh`);
    // Surface (don't swallow) — investor-level AUM is now stale; record it so
    // the import shows partial rather than a misleading clean "completed".
    console.error("[processFolioMasterDump] revalueAllFolios failed:", err);
    errors.push({ row: 0, reason: `Folio values imported but investor AUM revaluation failed: ${err?.message ?? err}` });
    failed++;
  }

  return {
    rowsTotal: rows.length + counts.rejected,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: today(),
    periodEnd: today(),
  };
}

async function processSipBook(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  // The amount column is now REQUIRED by the parser (a register without one is
  // refused as a layout error) and a blank amount rejects its row — the old
  // failure, every SIP silently imported at Rs 0, cannot recur. The check
  // below stays for a register whose amounts genuinely all read 0.
  const parsed = parseSipBook(args.text, args.source);
  const rows: CanonicalSipRow[] = parsed.rows;
  const { errors, counts } = startOutcome(parsed);
  let imported = 0;
  let skipped = counts.skipped;
  let failed = 0;
  const dir = new InvestorDirectory(tx, args.tenantId);
  await dir.preload({ pans: rows.map((r) => r.pan), folios: rows.map((r) => r.folioNumber) });

  if (rows.length > 0 && rows.every((r) => !r.amount)) {
    const header = (args.text.split(/\r?\n/)[0] ?? "").slice(0, 300);
    errors.push({
      row: 1,
      reason:
        `every one of the ${rows.length} rows parsed to amount 0 — the instalment-amount column in this file ` +
        `was not recognised, so no amount was read. Header: ${header}`,
    });
  }

  // India's today, for reading the registration's dates.
  const todayIst = new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    // A registration report is not only live SIPs. It also lists STPs and
    // SWPs (not SIPs at all) and registrations that were CANCELLED — CAMS gives
    // those a CEASE_DATE — and all of them used to import as 'active'.
    //
    // A past END date is deliberately NOT treated the same way: a SIP extended
    // at the AMC keeps collecting under its original end date (see
    // completeExpiredSips in lib/finance/sip-lifecycle.ts, which closes those
    // only on evidence that the instalments stopped). A cease date IS that
    // evidence.
    // Only a purchase registration is a SIP. CAMS WBR49 codes AUT_TRNTYP:
    //   P   SIP (systematic purchase)      SO  STP out (switch to a target)
    //   DTP dividend transfer plan         R   SWP (systematic redemption)
    // and only a transfer has a TARGET scheme. On Nimesh C Shah's 7 Oct file
    // the SO rows alone were Rs 68.56 L a month — they had all come in as SIPs.
    const regType = (r.registrationType ?? "").trim();
    const isSipType = !regType || /^(p|sip|isip|xsip|csip|micro ?sip|purchase|systematic purchase)$/i.test(regType);
    if (!isSipType || r.targetScheme) {
      // An earlier import may have stored it as a SIP: take that copy out of
      // the book, so re-importing the report also cleans up after itself.
      if (r.folioNumber && (r.schemeCode || r.schemeName)) {
        await tx.execute(sql`
          UPDATE sips SET status = 'stopped', remarks = ${NOT_A_SIP_REMARK}, updated_at = now()
           WHERE tenant_id = ${args.tenantId}::uuid AND folio_number = ${r.folioNumber} AND status = 'active'
             AND (scheme_code = ${r.schemeCode || r.schemeName}
                  OR lower(regexp_replace(COALESCE(scheme_name, ''), '[^a-zA-Z0-9]', '', 'g'))
                   = lower(regexp_replace(${r.schemeName || r.schemeCode}, '[^a-zA-Z0-9]', '', 'g')))
        `);
      }
      skipped++;
      continue;
    }
    const sipStatus: "active" | "stopped" = r.ceaseDate && r.ceaseDate <= todayIst ? "stopped" : "active";

    // The folio + scheme are what actually key a SIP. PAN is NOT required:
    // KFintech leaves the PAN column blank on a real minority of rows (minor
    // folios, older registrations), and every one of those was being dropped
    // — silently, because this branch recorded no reason. Measured on one VSN
    // batch: 213 of 5,699 rows, all with a valid folio and scheme, all with an
    // empty PAN, and an empty `errors` array to explain it.
    if (!r.folioNumber || !r.schemeCode) {
      skipped++;
      errors.push({
        row: i + 1,
        reason: `row carries no ${!r.folioNumber ? "folio number" : "scheme"} — a SIP cannot be keyed without it`,
      });
      continue;
    }

    // Resolve the folio FIRST: it carries the investor link, so it can identify
    // the client even when the registrar omitted the PAN.
    // The folio carries the client link, so it identifies the client even when
    // the registrar omitted the PAN. A folio number held under several AMC
    // codes by DIFFERENT clients is ambiguous and the row is held back.
    const folios = await dir.foliosFor(r.folioNumber);
    if (!folios.length) {
      skipped++;
      errors.push({ row: r.line, reason: `Folio ${r.folioNumber} not found — import the folio master first` });
      continue;
    }
    const folioOwner = await dir.byFolio(r.folioNumber);
    if (folioOwner.kind === "blocked" || folioOwner.kind === "ambiguous") {
      skipped++;
      errors.push({ row: r.line, reason: notAttached(folioOwner, r.pan, r.folioNumber) });
      continue;
    }

    // PAN wins when the registrar supplies a valid one (it is the platform's
    // dedup key) — but it must name the folio's own client.
    let investorId: string | null = null;
    let rmId: string | null = null;
    const byPan = await dir.byPan(r.pan);
    if (byPan.kind === "blocked" || byPan.kind === "ambiguous") {
      skipped++;
      errors.push({ row: r.line, reason: notAttached(byPan, r.pan, r.folioNumber) });
      continue;
    }
    if (byPan.kind === "found") {
      if (folioOwner.kind === "found" && folioOwner.id !== byPan.id && !dir.isGuardianOf(byPan.id, folioOwner.id)) {
        skipped++;
        errors.push({ row: r.line, reason: `folio ${r.folioNumber} belongs to a different client in the CRM than this row's PAN — held back for review, nothing reassigned` });
        continue;
      }
      investorId = folioOwner.kind === "found" && dir.isGuardianOf(byPan.id, folioOwner.id) ? folioOwner.id : byPan.id;
      rmId = folioOwner.kind === "found" && investorId === folioOwner.id ? folioOwner.rmId : byPan.rmId;
    } else if (folioOwner.kind === "found") {
      investorId = folioOwner.id;
      rmId = folioOwner.rmId;
    }
    if (!investorId) {
      skipped++;
      errors.push({ row: r.line, reason: notAttached({ kind: "none" }, r.pan, r.folioNumber) + `, and folio ${r.folioNumber} is not linked to a client` });
      continue;
    }

    // The folio row this SIP hangs off: the one the owner holds, preferring a
    // row with a real AMC code over an AMC-less one an AUM statement created.
    const ownFolios = folios
      .filter((f) => f.investor_id && (f.investor_id === investorId || folioOwner.kind === "found"))
      .sort((a, b) => (b.amc_code ?? "").localeCompare(a.amc_code ?? ""));
    const folioRow = ownFolios[0] ?? folios[0];
    const folioId = folioRow.id;
    const amcCode = (folioRow.amc_code ?? "").trim() || null;
    const amcName = ((await tx.execute(sql`SELECT amc_name FROM folios WHERE id = ${folioId}::uuid`)).rows[0] as any)?.amc_name || "Unknown AMC";

    // Resolve mandate (if reference is present)
    let mandateId: string | null = null;
    if (r.mandateRefNo) {
      const mandate = await tx.execute(sql`
        SELECT id FROM mandates WHERE tenant_id = ${args.tenantId}::uuid AND mandate_ref_no = ${r.mandateRefNo} LIMIT 1
      `);
      mandateId = (mandate.rows[0] as any)?.id ?? null;
    }

    await tx.execute(sql`SAVEPOINT rta_item`);
    try {
      // Match on the STABLE key (tenant, investor, folio, scheme) — NOT amount.
      // Including amount meant a step-up SIP (amount changes between monthly
      // books) failed to match and inserted a duplicate active SIP, inflating
      // active-SIP count + AUM projections. Update the amount on match instead.
      //
      // Match on folio_NUMBER, not folio_id. folio_id is a surrogate key that
      // CHANGES when the folio master is re-imported: the new folio row gets a
      // fresh uuid, the existing SIP still points at the old one, the lookup
      // misses and a duplicate active SIP is inserted. That is not theoretical —
      // it produced 96 byte-identical duplicate SIPs on one firm, same folio,
      // scheme, amount and start date, differing only in when they were written.
      //
      // The folio number is what the registrar actually keys on and survives a
      // re-import. investor_id is dropped from the match for the same reason:
      // a re-imported client is a new row, and the folio number already scopes
      // this tightly enough.
      // A registration already identified as an STP/SWP (not a SIP) stays out
      // of the book — the registrar re-sends it in every report.
      const transfer = await tx.execute(sql`
        SELECT 1 FROM sips
        WHERE tenant_id = ${args.tenantId}::uuid
          AND folio_number = ${r.folioNumber}
          AND scheme_code = ${r.schemeCode}
          AND remarks = ${NOT_A_SIP_REMARK}
        LIMIT 1
      `);
      if (transfer.rows.length) {
        await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
        skipped++;
        continue;
      }

      const existing = await tx.execute(sql`
        SELECT id FROM sips
        WHERE tenant_id = ${args.tenantId}::uuid
          AND folio_number = ${r.folioNumber}
          AND scheme_code = ${r.schemeCode}
          AND status = 'active'
        LIMIT 1
      `);

      let existingId = (existing.rows[0] as any)?.id;

      // The same registration under a different scheme key: a report that
      // carried no code column was keyed on the scheme NAME, and the next one
      // (with a code column) missed it and inserted a second copy beside it —
      // 846 such pairs on one book. Same folio + same scheme name is the same
      // SIP; adopt that row and give it the proper code.
      if (!existingId && r.schemeName) {
        const byName = await tx.execute(sql`
          SELECT id FROM sips
          WHERE tenant_id = ${args.tenantId}::uuid
            AND folio_number = ${r.folioNumber}
            AND lower(regexp_replace(COALESCE(scheme_name, ''), '[^a-zA-Z0-9]', '', 'g'))
              = lower(regexp_replace(${r.schemeName}, '[^a-zA-Z0-9]', '', 'g'))
            AND status = 'active'
          ORDER BY amount DESC NULLS LAST
          LIMIT 1
        `);
        existingId = (byName.rows[0] as any)?.id;
        if (existingId) {
          await tx.execute(sql`UPDATE sips SET scheme_code = ${r.schemeCode} WHERE id = ${existingId}::uuid`);
        }
      }

      // The same registration, already CLOSED here — completed on evidence that
      // its instalments stopped (completeExpiredSips, scripts/mark-sip-transfers),
      // stopped on a cease date, or stopped by hand. Registrars keep listing a
      // registration long after it stops collecting, and matching only active
      // rows re-inserted every one of them as a fresh active SIP on the next
      // report, undoing the closure. Same folio + scheme + start date is the
      // same registration (an older CAMS import read 2/9 as 2 September, so the
      // swapped date matches too); a later start date is a new one.
      if (!existingId) {
        const closed = await tx.execute(sql`
          SELECT id, investor_id, status, amount, updated_at FROM sips
          WHERE tenant_id = ${args.tenantId}::uuid
            AND folio_number = ${r.folioNumber}
            AND status IN ('completed', 'stopped')
            AND (scheme_code = ${r.schemeCode}
                 OR lower(regexp_replace(COALESCE(scheme_name, ''), '[^a-zA-Z0-9]', '', 'g'))
                  = lower(regexp_replace(${r.schemeName || r.schemeCode}, '[^a-zA-Z0-9]', '', 'g')))
            AND (${r.startDate ?? null}::date IS NULL
                 OR start_date = ${r.startDate ?? null}::date
                 OR to_char(start_date, 'YYYY-DD-MM') = ${r.startDate ?? null}
                 OR (start_date IS NULL AND ${r.startDate ?? null}::date <= COALESCE(end_date, updated_at::date)))
          ORDER BY updated_at DESC
          LIMIT 1
        `);
        const c = closed.rows[0] as { id: string; investor_id: string; status: string; amount: string | null; updated_at: string } | undefined;
        if (c) {
          // Completed on evidence, so only evidence reopens it: an instalment
          // of this amount collected after it was closed (the feed can arrive
          // late). A stopped one — cease date, or a person — stays stopped.
          const amt = Number(c.amount ?? 0);
          const resumed = c.status === "completed" && sipStatus === "active" && amt > 0
            ? (await tx.execute(sql`
                SELECT 1 FROM transactions x
                WHERE x.tenant_id = ${args.tenantId}::uuid AND x.investor_id = ${c.investor_id}::uuid
                  AND x.folio_number = ${r.folioNumber} AND x.type = 'sip'
                  AND x.order_date > ${c.updated_at}::date
                  AND abs(x.amount - ${amt}::numeric) <= ${amt}::numeric * 0.02
                LIMIT 1
              `)).rows.length > 0
            : false;
          if (!resumed) {
            await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
            skipped++;
            continue;
          }
          existingId = c.id;
        }
      }

      if (existingId) {
        // `?? null` on every optional value here is load-bearing, not defensive
        // style: drizzle OMITS an `undefined` interpolation from the template
        // rather than binding NULL, so a SIP row with no next-installment date
        // emitted literal `COALESCE(::date, ...)` — malformed SQL. Postgres then
        // aborts the ENTIRE transaction, so one such row failed not only itself
        // but every remaining row in the file and the final status write too,
        // surfacing as an opaque "Failed query" with the real cause buried.
        // The INSERT branch below already did this correctly; this one was missed.
        await tx.execute(sql`
          UPDATE sips
          SET amount = ${r.amount}::numeric,
              next_installment_at = COALESCE(${r.nextInstallmentAt ?? null}::date, next_installment_at),
              start_date = COALESCE(${r.startDate ?? null}::date, start_date),
              end_date = COALESCE(${r.endDate ?? null}::date, end_date),
              mandate_id = COALESCE(${mandateId ?? null}::uuid, mandate_id),
              status = ${sipStatus},
              updated_at = now()
          WHERE id = ${existingId}::uuid
        `);
      } else if (sipStatus !== "active") {
        // A cancelled SIP we never had on record: history, not part of the
        // book — nothing to add.
        await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
        skipped++;
        continue;
      } else {
        await tx.execute(sql`
          INSERT INTO sips (
            tenant_id, investor_id, folio_id, folio_number, amc_code, amc_name, scheme_code, scheme_name,
            amount, frequency, sip_date, start_date, end_date, next_installment_at, mandate_id, status, rm_id
          ) VALUES (
            ${args.tenantId}::uuid, ${investorId}::uuid, ${folioId}::uuid, ${r.folioNumber}, ${amcCode}, ${amcName},
            ${r.schemeCode}, ${r.schemeName}, ${r.amount}, ${r.frequency}, ${r.sipDate ?? null}, ${r.startDate ?? null}::date,
            ${r.endDate ?? null}::date, ${r.nextInstallmentAt ?? null}::date, ${mandateId}::uuid, 'active', ${rmId}::uuid
          )
        `);
      }

      imported++;
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
    } catch (e: any) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_item`);
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
      failed++;
      errors.push({ row: r.line, reason: e.message ?? "SIP import failed" });
    }
  }

  // The SIP book changed underneath the clients' cached "Monthly SIP" — and a
  // match by folio number can move a SIP between client records — so refresh
  // the whole firm's cache in one set-based pass (lib/metrics/sip.ts).
  // A Rs 0 copy of a registration this or an earlier report stored again WITH
  // its amount (a file keyed on scheme name, then one with a code column) is a
  // duplicate, not a second SIP.
  await tx.execute(sql`
    UPDATE sips z
       SET status = 'stopped', updated_at = now(),
           remarks = 'Duplicate: the same registration was re-imported with its amount'
     WHERE z.tenant_id = ${args.tenantId}::uuid AND z.status = 'active' AND COALESCE(z.amount, 0) = 0
       AND EXISTS (
         SELECT 1 FROM sips o
          WHERE o.tenant_id = z.tenant_id AND o.id <> z.id AND o.status = 'active'
            AND o.folio_number = z.folio_number AND COALESCE(o.amount, 0) > 0
            AND lower(regexp_replace(COALESCE(o.scheme_name, ''), '[^a-zA-Z0-9]', '', 'g'))
              = lower(regexp_replace(COALESCE(z.scheme_name, ''), '[^a-zA-Z0-9]', '', 'g'))
       )
  `);

  // Registrations the ledger shows to be STPs/SWPs leave the book
  // (lib/finance/sip-lifecycle.ts) before the cache is refreshed.
  const transfers = await markSystematicTransfers(tx, args.tenantId);
  if (imported > 0 || transfers > 0) await refreshActiveSipAmount(tx, { tenantId: args.tenantId });

  return {
    rowsTotal: rows.length + counts.rejected,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: today(),
    periodEnd: today(),
  };
}

async function processMandateStatus(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const parsed = parseMandateStatus(args.text, args.source);
  const rows: CanonicalMandateRow[] = parsed.rows;
  const { errors, counts } = startOutcome(parsed);
  let imported = 0;
  let skipped = counts.skipped;
  let failed = 0;
  const dir = new InvestorDirectory(tx, args.tenantId);
  await dir.preload({ pans: rows.map((r) => r.pan) });

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!validPan(r.pan) || !r.mandateRefNo) {
      skipped++;
      errors.push({ row: r.line, reason: `row carries no ${!r.mandateRefNo ? "mandate reference" : "valid PAN"} — a mandate is keyed on both` });
      continue;
    }

    const who = await dir.byPan(r.pan);
    if (who.kind !== "found") {
      skipped++;
      errors.push({ row: r.line, reason: notAttached(who, r.pan, null) });
      continue;
    }
    const investorId = who.id;

    await tx.execute(sql`SAVEPOINT rta_item`);
    try {
      await tx.execute(sql`
        INSERT INTO mandates (
          tenant_id, investor_id, mandate_ref_no, bank_account_masked, ifsc, amount_limit, registered_at, expires_at, status
        ) VALUES (
          ${args.tenantId}::uuid, ${investorId}::uuid, ${r.mandateRefNo}, ${r.bankAccountMasked ?? null},
          ${r.ifsc ?? null}, ${r.amountLimit ?? null}, ${r.registeredAt ?? null}::date, ${r.expiresAt ?? null}::date, ${r.status}
        )
        ON CONFLICT (tenant_id, mandate_ref_no) DO UPDATE SET
          bank_account_masked = COALESCE(EXCLUDED.bank_account_masked, bank_account_masked),
          ifsc = COALESCE(EXCLUDED.ifsc, ifsc),
          amount_limit = COALESCE(EXCLUDED.amount_limit, amount_limit),
          status = EXCLUDED.status,
          expires_at = COALESCE(EXCLUDED.expires_at, expires_at),
          updated_at = now()
      `);

      imported++;
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
    } catch (e: any) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_item`);
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
      failed++;
      errors.push({ row: r.line, reason: e.message ?? "mandate import failed" });
    }
  }

  return {
    rowsTotal: rows.length + counts.rejected,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: today(),
    periodEnd: today(),
  };
}

async function processAumStatement(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; text: string }
): Promise<ProcessOutcome> {
  const parsed = parseAumStatement(args.text, args.source);
  const rows: CanonicalAumRow[] = parsed.rows;
  const { errors, counts } = startOutcome(parsed);
  let imported = 0;
  let skipped = counts.skipped;
  let failed = 0;
  const dir = new InvestorDirectory(tx, args.tenantId);
  await dir.preload({
    pans: rows.map((r) => r.pan),
    folios: rows.map((r) => r.folioNumber),
    nopanKeys: [...new Set(rows.map((r) => nopanFolioKey(r.folioNumber)))],
  });
  /** Folios this report was the first to reveal — surfaced in the summary so a
   *  valuation-led import is visible rather than looking like a plain refresh. */
  let createdFolios = 0;

  // Group rows by folio number
  const aumRowsGrouped = new Map<string, CanonicalAumRow[]>();
  for (const r of rows) {
    if (!r.folioNumber || !r.schemeCode) {
      skipped++;
      errors.push({ row: r.line, reason: `row carries no ${!r.folioNumber ? "folio number" : "scheme code"}` });
      continue;
    }
    const key = r.folioNumber;
    if (!aumRowsGrouped.has(key)) {
      aumRowsGrouped.set(key, []);
    }
    aumRowsGrouped.get(key)!.push(r);
  }

  for (const [folioNum, fRows] of aumRowsGrouped) {
    const firstRow = fRows[0];
    const who = await dir.resolve({ pan: firstRow.pan, folioNumber: folioNum });
    if (who.kind === "blocked" || who.kind === "ambiguous") {
      skipped += fRows.length;
      errors.push({ row: firstRow.line, reason: notAttached(who, firstRow.pan, folioNum) });
      continue;
    }
    let investorId: string | null = who.kind === "found" ? who.id : null;

    // Same gap the transaction feed had: the folio is not in the book yet and
    // this report cannot supply a PAN to match on. CAMS WBR22 has NO PAN COLUMN
    // AT ALL, so on a book whose master is incomplete every such folio was
    // dropped — 270 rows of one real file, each carrying units and a closing
    // value. Stand the client up keyed on the FOLIO (migration 0151's
    // rta_nopan_key) so the holding lands — never on the holder's name, which
    // two different people can share. A later master with a real PAN creates
    // the PAN-keyed client and re-points the folio to it.
    if (!investorId && folioNum && !validPan(firstRow.pan)) {
      const key = nopanFolioKey(folioNum);
      const existing = await dir.byNopanKey(key);
      if (existing.kind === "blocked" || existing.kind === "ambiguous") {
        skipped += fRows.length;
        errors.push({ row: firstRow.line, reason: notAttached(existing, null, folioNum) });
        continue;
      }
      if (existing.kind === "found") investorId = existing.id;
      else {
        const holder = splitRepresentedBy(firstRow.investorName);
        const created = await tx.execute(sql`
          INSERT INTO investors (tenant_id, pan, rta_nopan_key, name, investor_category, is_minor, kyc_status)
          VALUES (
            ${args.tenantId}::uuid, NULL, ${key},
            ${holder.name ?? `Folio ${folioNum}`},
            ${holder.isMinor ? "minor" : "individual"}, ${holder.isMinor}, 'pending'
          )
          ON CONFLICT (tenant_id, rta_nopan_key) WHERE rta_nopan_key IS NOT NULL
          DO UPDATE SET updated_at = now()
          RETURNING id, deleted_at, merged_into_id
        `);
        const row = created.rows[0] as { id: string; deleted_at: string | null; merged_into_id: string | null } | undefined;
        if (row && !row.deleted_at && !row.merged_into_id) {
          investorId = String(row.id);
          dir.remember({ id: investorId, rta_nopan_key: key });
        }
      }
    }

    if (!investorId) {
      skipped += fRows.length;
      errors.push({ row: firstRow.line, reason: `Folio ${folioNum} could not be attached to a client` });
      continue;
    }

    // Find the folio — and CREATE it when this report is the first thing to
    // mention it. A valuation report legitimately arrives before any master:
    // CAMS WBR22 is pulled per-ARN on demand, while the folio master is a
    // separate subscription that may not cover the same ARNs. Refusing to
    // create the folio meant the holding was dropped even though we had the
    // folio number, the scheme, the units and the value in hand — 268 rows of
    // one real file, after the client-resolution gap above was already fixed.
    //
    // The transaction feed has always done this (processTransactionFeed inserts
    // the folio ON CONFLICT before writing the transaction); this path just
    // never did. amc_code is unknown here — WBR22 carries a PRODUCT code per
    // scheme, not a folio-level AMC — so it is left blank for a later master to
    // fill in, and the ON CONFLICT target below matches the same
    // (tenant, amc_code, folio_number) key the rest of the importer uses.
    // The folio this holding belongs to: when several rows share the number,
    // only the one the resolved client holds (preferring a real AMC code over
    // an AMC-less one) — never an arbitrary first row.
    const candidates = (await dir.foliosFor(folioNum))
      .filter((f) => f.investor_id === investorId)
      .sort((a, b) => (b.amc_code ?? "").localeCompare(a.amc_code ?? ""));
    const others = (await dir.foliosFor(folioNum)).filter((f) => f.investor_id && f.investor_id !== investorId);
    if (!candidates.length && others.length) {
      skipped += fRows.length;
      errors.push({ row: firstRow.line, reason: `folio ${folioNum} belongs to a different client in the CRM than this row's PAN — held back for review, nothing reassigned` });
      continue;
    }
    let folio = await tx.execute(sql`
      SELECT id, schemes FROM folios
      WHERE tenant_id = ${args.tenantId}::uuid AND id = ${candidates[0]?.id ?? null}::uuid
    `);
    if (!folio.rows[0]) {
      const rtaEnum = args.source === "cams" || args.source === "kfintech" ? args.source : "other";
      await tx.execute(sql`
        INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta, schemes)
        VALUES (${args.tenantId}::uuid, ${investorId}::uuid, ${folioNum}, '', '', ${rtaEnum}, '[]'::jsonb)
        ON CONFLICT (tenant_id, amc_code, folio_number) DO UPDATE SET updated_at = now()
      `);
      folio = await tx.execute(sql`
        SELECT id, schemes FROM folios
        WHERE tenant_id = ${args.tenantId}::uuid AND folio_number = ${folioNum}
          AND investor_id = ${investorId}::uuid
        ORDER BY amc_code DESC NULLS LAST
        LIMIT 1
      `);
      if (folio.rows[0]) createdFolios++;
    }
    const folioId = (folio.rows[0] as any)?.id;
    if (!folioId) {
      skipped += fRows.length;
      errors.push({ row: firstRow.line, reason: `Folio ${folioNum} could not be created` });
      continue;
    }

    await tx.execute(sql`SAVEPOINT rta_item`);
    try {
      const existingSchemes = ((folio.rows[0] as any)?.schemes ?? []) as Array<{
        schemeCode: string;
        schemeName: string;
        category?: string;
        units?: number;
        nav?: number;
        value?: number;
        /** ARN whose slice of the holding this leg is. Absent on legs written
         *  before per-ARN slicing existed. */
        arn?: string;
      }>;

      // Match an incoming holding to an existing leg by CODE **or by scheme
      // NAME**. The same holding is routinely already present under a different
      // code: the rich importer rewrites schemeCode to the AMFI code via
      // resolveSchemeIdentity, while this report carries the registrar's own
      // product code. Keying the merge on code alone stored it twice, with
      // identical units and identical value —
      //
      //   folio 1000073825   Y1035  = 16,206,449 / 890,757.88
      //                      150347 = 16,206,449 / 890,757.88
      //
      // Measured on VSN Financial Services: 3,632 duplicated legs worth
      // Rs 158.49 Cr, which is why firm AUM read Rs 779 Cr against an actual
      // Rs 640 Cr. Double-counted AUM is worse than missing AUM: it looks right.
      // The match is also keyed on ARN. A firm holding several ARNs gets one
      // statement per broker code, and a client who bought the same scheme in
      // the same folio through two of them has their units SPLIT across the two
      // files — complementary halves, not restatements. Keying on scheme alone
      // let the second statement overwrite the first, so the folio kept only
      // whichever ARN imported last:
      //
      //   folio 18069442/27  ICICI Large & Mid Cap
      //     ARN-114688  11,284.153 units   Rs 1,17,72,983
      //     ARN-90577    7,289.173 units   Rs   76,04,940
      //   stored: Rs 76,04,940 — the ARN-90577 slice alone.
      //
      // Measured on VSN Financial Services: 731 holdings under-valued by
      // Rs 32.93 Cr against the registrars' own statements.
      //
      // A leg with NO arn matches ANY incoming arn deliberately: legs written
      // before this change carry none, and treating them as a separate slice
      // would add the incoming one alongside and DOUBLE COUNT. Replacing them
      // instead lets the register converge as each ARN's statement lands,
      // without ever overstating on the way there.
      const normName = (s?: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const merged = existingSchemes.map((s) => ({ ...s }));
      // A missing ARN is a wildcard on BOTH sides. Stored-none/incoming-one is
      // a leg written before slicing existed; stored-one/incoming-none is a
      // report whose layout has no broker column restating the same holding.
      // Either way it is the same holding and must REPLACE, not sit alongside —
      // handling only the first direction let arn-less restatements pile up as
      // second copies (721 folio+scheme pairs, Rs 37.27 Cr, 5-7 Sep).
      const slotFor = (code: string, name: string, arn?: string): number | undefined => {
        const n = normName(name);
        let fallback: number | undefined;
        for (let idx = 0; idx < merged.length; idx++) {
          const s = merged[idx];
          const sameScheme = (s.schemeCode && s.schemeCode === code) || (n && normName(s.schemeName) === n);
          if (!sameScheme) continue;
          if (s.arn === arn) return idx;                    // same ARN's slice — restate it
          if ((s.arn == null || arn == null) && fallback == null) fallback = idx; // wildcard either way
        }
        return fallback;
      };

      for (const r of fRows) {
        if (!r.schemeCode) continue;
        const at = slotFor(r.schemeCode, r.schemeName, r.arn);
        const value = r.aumValue || (r.nav ? Math.round(r.units * r.nav * 100) / 100 : undefined);
        if (at != null) {
          const cur = merged[at];
          merged[at] = {
            ...cur,
            // Keep the EXISTING code. When it is the resolved AMFI code that is
            // what live-NAV revaluation joins on; overwriting it with the
            // registrar's product code would silently un-price the holding.
            schemeName: cur.schemeName || r.schemeName || "",
            units: r.units,
            nav: r.nav ?? cur.nav,
            value: value ?? cur.value,
            arn: r.arn ?? cur.arn,
          };
        } else {
          merged.push({
            schemeCode: r.schemeCode,
            schemeName: r.schemeName || "",
            units: r.units,
            nav: r.nav,
            value,
            arn: r.arn,
          });
        }
      }

      const mergedSchemes = merged;
      const roundedAum = mergedSchemes.reduce((acc, s) => acc + (s.value ?? 0), 0);

      await tx.execute(sql`
        UPDATE folios
        SET schemes = ${JSON.stringify(mergedSchemes)}::jsonb,
            aum = ${roundedAum}::numeric,
            updated_at = now()
        WHERE id = ${folioId}::uuid
      `);

      imported += fRows.length;
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
    } catch (e: any) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_item`);
      await tx.execute(sql`RELEASE SAVEPOINT rta_item`);
      failed += fRows.length;
      errors.push({ row: firstRow.line, reason: e.message ?? "AUM import failed" });
    }
  }

  if (createdFolios > 0) {
    // Not an error — recorded so a valuation-led import is visible as such,
    // rather than reading like a plain refresh of folios we already had.
    errors.push({ row: 0, reason: `${createdFolios} folio(s) were first seen in this report and created from it` });
  }

  await tx.execute(sql`SAVEPOINT rta_refresh`);
  try {
    const { revalueAllFolios, recomputeCombinedAum } = await import("@/lib/finance/aum-persist");
    await revalueAllFolios(tx);
    // Roll the (just-imported) folio holdings up to investors.aum so the client
    // profile headline reflects them — combined with transaction-derived value
    // for any scheme the folios don't cover. Without this, a holdings-only book
    // (RTA folio-master / AUM import, no transaction feed) shows ₹0 AUM.
    await recomputeCombinedAum(tx);
    await tx.execute(sql`RELEASE SAVEPOINT rta_refresh`);
  } catch (err: any) {
    await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_refresh`);
    await tx.execute(sql`RELEASE SAVEPOINT rta_refresh`);
    console.error("[processAumStatement] revalueAllFolios failed:", err);
    errors.push({ row: 0, reason: `AUM values imported but investor AUM revaluation failed: ${err?.message ?? err}` });
    failed++;
  }

  return {
    rowsTotal: rows.length + counts.rejected,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsFailed: failed,
    errors,
    periodStart: today(),
    periodEnd: today(),
  };
}

/** Preserve the caller's import-attempt row even if parsing/setup fails in SQL. */
export async function processRtaFile(
  tx: Tx,
  args: { tenantId: string; source: RtaSource; kind: RtaFileKind; text: string }
): Promise<ProcessOutcome> {
  await tx.execute(sql`SAVEPOINT rta_import`);
  try {
    const result = await processRtaFileUnsafe(tx, args);
    await tx.execute(sql`RELEASE SAVEPOINT rta_import`);
    // Row errors are shown to staff and stored: never with a full PAN.
    result.errors = result.errors
      .map((e) => ({ row: e.row, reason: maskPansInText(e.reason) }))
      .sort((a, b) => a.row - b.row);
    return result;
  } catch (error) {
    await tx.execute(sql`ROLLBACK TO SAVEPOINT rta_import`);
    await tx.execute(sql`RELEASE SAVEPOINT rta_import`);
    // A layout error quotes the file's first line, which can be a data row.
    if (error instanceof Error) error.message = maskPansInText(error.message);
    throw error;
  }
}

