/**
 * Recovering from an incorrect posting batch (Phase 3G).
 *
 * Turning posting off (kill switch, revoked activation) stops FUTURE writes;
 * it does not undo what a bad batch already wrote. This does, auditably:
 *
 *   reversePostingBatch  every CRM row the batch posted — its transactions,
 *                        their SIP rejections and business-entry matches, and
 *                        its posting-ledger rows — is archived WHOLE in one
 *                        append-only rta_posting_reversals record, then
 *                        removed. Rows the batch only MATCHED (already in the
 *                        CRM before it) are not touched; only the link goes.
 *                        Needs posting halted for the firm, a requester and a
 *                        different approver, and a reason.
 *   undoReversal         puts every archived row back exactly as it was.
 *   reconcilePosting     checks ledger ↔ CRM ↔ staging agree for a firm.
 *
 * Masters (clients, folios, holdings legs) are not reversed here: a wrong
 * master is corrected by importing the right statement (an older one never
 * overwrites a newer one) or, for a wider error, by the database restore in
 * the recovery plan (docs/rta/PHASE3G_PRODUCTION_READINESS.md).
 */
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { haltState } from "./controls";
import { recordOutcome } from "./post";

type Tx = any;

export class RecoveryError extends Error {
  status = 409;
}

export type ReversalResult = { reversalId: string | null; dryRun: boolean; counts: Record<string, number> };

export async function reversePostingBatch(tenantId: string, batchId: string, input: { requestedBy: string; approvedBy: string; reason: string; dryRun?: boolean }): Promise<ReversalResult> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10) throw new RecoveryError("a reason of at least 10 characters is required");
  if (!input.requestedBy || input.requestedBy === input.approvedBy) throw new RecoveryError("a reversal needs a requester and a DIFFERENT approver");
  const DRY = "__dry_run_rollback__";
  try {
    return await withTenant(tenantId, async (tx: Tx) => {
      const halt = await haltState(tx, tenantId, { lock: true });
      if (!halt.halted) throw new RecoveryError("halt posting for this firm first (kill switch) — a batch is never reversed while new batches can post");
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"rta_posting:" + tenantId}, 0))`);
      const b = (await tx.execute(sql`SELECT posting_state FROM rta_staging_batches WHERE tenant_id = ${tenantId}::uuid AND id = ${batchId}::uuid FOR UPDATE`)).rows[0] as { posting_state: string } | undefined;
      if (!b) throw Object.assign(new RecoveryError("batch not found for this firm"), { status: 404 });
      if (b.posting_state === "reversed") throw new RecoveryError("this batch is already reversed");

      const ledger = (await tx.execute(sql`SELECT * FROM rta_posted_transactions WHERE tenant_id = ${tenantId}::uuid AND batch_id = ${batchId}::uuid`)).rows as any[];
      const written = ledger.filter((l) => l.kind !== "matched_existing" && l.transaction_id).map((l) => String(l.transaction_id));
      const ids = written.length ? sql.join(written.map((id) => sql`${id}::uuid`), sql`, `) : null;
      const txns = ids ? (await tx.execute(sql`SELECT to_jsonb(t) AS j FROM transactions t WHERE t.tenant_id = ${tenantId}::uuid AND t.id IN (${ids})`)).rows.map((r: any) => r.j) : [];
      const rejections = ids ? (await tx.execute(sql`SELECT to_jsonb(s) AS j FROM sip_rejections s WHERE s.tenant_id = ${tenantId}::uuid AND s.transaction_id IN (${ids})`)).rows.map((r: any) => r.j) : [];
      const matches = ids ? (await tx.execute(sql`SELECT to_jsonb(m) AS j FROM business_entry_rta_matches m WHERE m.transaction_id IN (${ids})`)).rows.map((r: any) => r.j) : [];
      const counts = { ledger: ledger.length, transactions: txns.length, sipRejections: rejections.length, businessEntryMatches: matches.length, matchedExistingUnlinked: ledger.filter((l) => l.kind === "matched_existing").length };
      const investors = [...new Set<string>(txns.map((t: any) => String(t.investor_id)))];
      // The client's last-transaction date can also come from a registrar
      // master, so it is not simply "max of the transactions". Keep each prior
      // value for the undo, and lower it only when the batch is what set it.
      const lastTxBefore: Record<string, string | null> = {};
      const batchMax: Record<string, string> = {};
      for (const t of txns as any[]) {
        const inv = String(t.investor_id); const d = t.order_date ? String(t.order_date).slice(0, 10) : null;
        if (d && (!batchMax[inv] || d > batchMax[inv])) batchMax[inv] = d;
      }
      if (investors.length) {
        const invIds = sql.join(investors.map((i) => sql`${i}::uuid`), sql`, `);
        for (const r of (await tx.execute(sql`SELECT id::text, last_transaction_at FROM investors WHERE id IN (${invIds})`)).rows as any[]) {
          lastTxBefore[r.id] = r.last_transaction_at == null ? null : new Date(r.last_transaction_at).toISOString();
        }
      }

      await tx.execute(sql`DELETE FROM rta_posted_transactions WHERE tenant_id = ${tenantId}::uuid AND batch_id = ${batchId}::uuid`);
      if (ids) {
        await tx.execute(sql`DELETE FROM business_entry_rta_matches WHERE transaction_id IN (${ids})`);
        await tx.execute(sql`DELETE FROM sip_rejections WHERE tenant_id = ${tenantId}::uuid AND transaction_id IN (${ids})`);
        await tx.execute(sql`DELETE FROM transactions WHERE tenant_id = ${tenantId}::uuid AND id IN (${ids})`);
      }
      for (const l of ledger) {
        await recordOutcome(tx, tenantId, String(l.economic_txn_id), "reversed", `reversed: ${reason.slice(0, 200)}`, { by: input.approvedBy, via: "reversal", batchId, extra: { requestedBy: input.requestedBy, previousKind: l.kind } });
      }
      // last_transaction_at follows what remains — unless something newer
      // than this batch (another batch, a registrar master) set it.
      for (const inv of investors) {
        const before = lastTxBefore[inv];
        if (before && batchMax[inv] && before.slice(0, 10) > batchMax[inv]) continue;
        await tx.execute(sql`UPDATE investors SET last_transaction_at = (SELECT max(order_date)::timestamptz FROM transactions WHERE investor_id = ${inv}::uuid AND status IN ('processed', 'successful')), updated_at = now() WHERE id = ${inv}::uuid`);
      }
      await tx.execute(sql`UPDATE rta_staging_batches SET posting_state = 'reversed', updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${batchId}::uuid`);
      const row = (await tx.execute(sql`
        INSERT INTO rta_posting_reversals (tenant_id, batch_id, reason, requested_by, approved_by, archived, counts)
        VALUES (${tenantId}::uuid, ${batchId}::uuid, ${reason}, ${input.requestedBy}::uuid, ${input.approvedBy}::uuid,
                ${JSON.stringify({ transactions: txns, sip_rejections: rejections, business_entry_rta_matches: matches, ledger, previousPostingState: b.posting_state, investorLastTransactionAt: lastTxBefore })}::jsonb,
                ${JSON.stringify(counts)}::jsonb)
        RETURNING id::text`)).rows[0] as { id: string };
      await tx.execute(sql`
        INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, after, reason)
        VALUES (${tenantId}::uuid, ${input.approvedBy}::uuid, 'user', 'rta.posting.reverse', 'rta_staging_batch', ${batchId}::uuid,
                ${JSON.stringify({ reversalId: row.id, requestedBy: input.requestedBy, counts })}::jsonb, ${reason})`);
      if (input.dryRun) throw Object.assign(new Error(DRY), { result: { reversalId: null, dryRun: true, counts } });
      return { reversalId: row.id, dryRun: false, counts };
    });
  } catch (e: any) {
    if (e?.message === DRY) return e.result as ReversalResult;
    throw e;
  }
}

/** Put every row a reversal removed back, exactly as it was. Needs posting halted, like the reversal. */
export async function undoReversal(tenantId: string, reversalId: string, input: { by: string; reason: string }): Promise<Record<string, number>> {
  if ((input.reason?.trim() ?? "").length < 10) throw new RecoveryError("a reason of at least 10 characters is required");
  return withTenant(tenantId, async (tx: Tx) => {
    const halt = await haltState(tx, tenantId, { lock: true });
    if (!halt.halted) throw new RecoveryError("halt posting for this firm first (kill switch)");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"rta_posting:" + tenantId}, 0))`);
    const r = (await tx.execute(sql`SELECT batch_id::text, archived, undone_at FROM rta_posting_reversals WHERE tenant_id = ${tenantId}::uuid AND id = ${reversalId}::uuid FOR UPDATE`)).rows[0] as any;
    if (!r) throw Object.assign(new RecoveryError("reversal not found"), { status: 404 });
    if (r.undone_at) throw new RecoveryError("this reversal has already been undone");
    const a = r.archived as { transactions: any[]; sip_rejections: any[]; business_entry_rta_matches: any[]; ledger: any[]; previousPostingState: string; investorLastTransactionAt?: Record<string, string | null> };
    const put = async (table: string, rows: any[]) => {
      for (const j of rows) await tx.execute(sql`INSERT INTO ${sql.identifier(table)} SELECT * FROM jsonb_populate_record(NULL::${sql.identifier(table)}, ${JSON.stringify(j)}::jsonb)`);
    };
    await put("transactions", a.transactions);
    await put("sip_rejections", a.sip_rejections);
    await put("business_entry_rta_matches", a.business_entry_rta_matches);
    await put("rta_posted_transactions", a.ledger);
    const outcomeOf: Record<string, string> = { posted_new: "posted", rejected_recorded: "rejected_recorded", matched_existing: "matched_existing" };
    for (const l of a.ledger) {
      await recordOutcome(tx, tenantId, String(l.economic_txn_id), outcomeOf[l.kind] ?? "posted", `restored: ${input.reason.trim().slice(0, 200)}`, { by: input.by, via: "reversal", batchId: r.batch_id, extra: { undoOf: reversalId } });
    }
    // Back to the value before the reversal (or newer, if something has moved it on since).
    for (const inv of new Set(a.transactions.map((t) => String(t.investor_id)))) {
      const prior = a.investorLastTransactionAt?.[inv] ?? null;
      await tx.execute(sql`UPDATE investors SET last_transaction_at = GREATEST(
          last_transaction_at, ${prior}::timestamptz,
          (SELECT max(order_date)::timestamptz FROM transactions WHERE investor_id = ${inv}::uuid AND status IN ('processed', 'successful'))),
        updated_at = now() WHERE id = ${inv}::uuid`);
    }
    await tx.execute(sql`UPDATE rta_staging_batches SET posting_state = ${a.previousPostingState}, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${r.batch_id}::uuid`);
    await tx.execute(sql`UPDATE rta_posting_reversals SET undone_at = now(), undone_by = ${input.by}::uuid WHERE id = ${reversalId}::uuid`);
    const counts = { transactions: a.transactions.length, sipRejections: a.sip_rejections.length, businessEntryMatches: a.business_entry_rta_matches.length, ledger: a.ledger.length };
    await tx.execute(sql`
      INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, after, reason)
      VALUES (${tenantId}::uuid, ${input.by}::uuid, 'user', 'rta.posting.reverse_undo', 'rta_posting_reversal', ${reversalId}::uuid, ${JSON.stringify(counts)}::jsonb, ${input.reason.trim()})`);
    return counts;
  });
}

/**
 * Do the posting ledger, the CRM and staging agree for this firm? Every count
 * below should be zero; run it after any recovery (and nightly in a pilot).
 */
export async function reconcilePosting(tenantId: string) {
  return withTenant(tenantId, async (tx: Tx) => {
    const one = async (q: any) => Number(((await tx.execute(q)).rows[0] as any).n);
    return {
      ledgerWithoutTransaction: await one(sql`SELECT count(*)::int AS n FROM rta_posted_transactions p WHERE p.tenant_id = ${tenantId}::uuid AND p.kind <> 'matched_existing' AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = p.transaction_id)`),
      validateFirstTransactionWithoutLedger: await one(sql`SELECT count(*)::int AS n FROM transactions t WHERE t.tenant_id = ${tenantId}::uuid AND t.source_feed = 'rta_validate_first' AND NOT EXISTS (SELECT 1 FROM rta_posted_transactions p WHERE p.transaction_id = t.id)`),
      postedOutcomeWithoutLedger: await one(sql`SELECT count(*)::int AS n FROM rta_staging_economic_txns e WHERE e.tenant_id = ${tenantId}::uuid AND e.posting_outcome IN ('posted', 'rejected_recorded', 'matched_existing') AND NOT EXISTS (SELECT 1 FROM rta_posted_transactions p WHERE p.tenant_id = e.tenant_id AND p.identity_key = e.identity_key)`),
      ledgerIdentityTwice: await one(sql`SELECT count(*)::int AS n FROM (SELECT identity_key FROM rta_posted_transactions WHERE tenant_id = ${tenantId}::uuid GROUP BY 1 HAVING count(*) > 1) x`),
      rejectedWithUnits: await one(sql`SELECT count(*)::int AS n FROM transactions WHERE tenant_id = ${tenantId}::uuid AND source_feed = 'rta_validate_first' AND status = 'rejected' AND coalesce(units, 0) <> 0`),
    };
  });
}
