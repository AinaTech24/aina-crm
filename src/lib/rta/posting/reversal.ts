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
 *                        Needs posting halted for the firm and a reason. The
 *                        DRY RUN is read-only and open to one operator;
 *                        committing runs only from an approved two-person
 *                        control request (approvals.ts, migration 0243).
 *   undoReversal         puts every archived row back exactly as it was.
 *   reconcilePosting     checks ledger ↔ CRM ↔ staging agree for a firm.
 *
 * Masters (clients, folios, holdings legs) are not reversed here: a wrong
 * master is corrected by importing the right statement (an older one never
 * overwrites a newer one) or, for a wider error, by the database restore in
 * the recovery plan (docs/rta/PHASE3G_PRODUCTION_READINESS.md).
 */
import { sql, type SQL } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { haltState } from "./controls";
import { recordOutcome } from "./post";

type Tx = any;

export class RecoveryError extends Error {
  status = 409;
}

/**
 * What a reversal would break if it ran automatically (Phase 3H). Any count
 * above zero BLOCKS it: the recovery is then reviewed, in the documented order
 * (reverse the dependent later batches newest-first, or restore the backup).
 */
export type ReversalDependencies = {
  /** Later, unreversed batches that recorded these transactions as already posted. */
  laterBatchClaims: number;
  /** Booked business whose RTA outcome was decided from these transactions. */
  businessEntryMatches: number;
  /** Workflow events already emitted for these transactions (messages may have gone). */
  outboxEvents: number;
  /** SIP rejections someone has already worked (status changed / edited). */
  workedSipRejections: number;
};
export type ReversalResult = { reversalId: string | null; dryRun: boolean; counts: Record<string, number>; dependencies?: ReversalDependencies; blocked?: boolean };

/**
 * DRY RUN only (read-only): what reversing this batch would remove, and what
 * depends on it. Committing a reversal is a two-person control request
 * (approvals.ts, action "reverse"), which runs reverseBatchTx.
 */
export async function reversePostingBatch(tenantId: string, batchId: string, input: { reason: string; dryRun?: boolean; requestedBy?: string; approvedBy?: string }): Promise<ReversalResult> {
  if (input.dryRun === false) {
    throw new RecoveryError("committing a reversal needs a two-person control request: one operator requests it, a DIFFERENT signed-in operator approves it (POST /api/super-admin/rta-pipeline)");
  }
  return withTenant(tenantId, (tx: Tx) => reverseBatchTx(tx, tenantId, batchId, { reason: input.reason, dryRun: true }));
}

/** The reversal itself, in the caller's transaction. Writes only with an executed control request. */
export async function reverseBatchTx(tx: Tx, tenantId: string, batchId: string, input: {
  reason: string; dryRun: boolean; requestedBy?: string; approvedBy?: string; controlRequestId?: string;
}): Promise<ReversalResult> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10) throw new RecoveryError("a reason of at least 10 characters is required");
  if (!input.dryRun && (!input.requestedBy || input.requestedBy === input.approvedBy || !input.controlRequestId)) {
    throw new RecoveryError("a reversal needs an executed two-person control request (a requester and a DIFFERENT approver)");
  }
  {
    {
      const halt = await haltState(tx, tenantId, { lock: true });
      if (!halt.halted) throw new RecoveryError("halt posting for this firm first (kill switch) — a batch is never reversed while new batches can post");
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"rta_posting:" + tenantId}, 0))`);
      const b = (await tx.execute(sql`SELECT posting_state, record_kind FROM rta_staging_batches WHERE tenant_id = ${tenantId}::uuid AND id = ${batchId}::uuid FOR UPDATE`)).rows[0] as { posting_state: string; record_kind: string } | undefined;
      if (!b) throw Object.assign(new RecoveryError("batch not found for this firm"), { status: 404 });
      if (b.posting_state === "reversed") throw new RecoveryError("this batch is already reversed");
      if (b.record_kind !== "transaction") {
        throw new RecoveryError(`a ${b.record_kind} batch is not reversed here — a wrong master or statement is corrected by importing the right one (an older statement never replaces a newer one) or by the reviewed database restore`);
      }

      const ledger = (await tx.execute(sql`SELECT * FROM rta_posted_transactions WHERE tenant_id = ${tenantId}::uuid AND batch_id = ${batchId}::uuid`)).rows as any[];
      const written = ledger.filter((l) => l.kind !== "matched_existing" && l.transaction_id).map((l) => String(l.transaction_id));
      const ids = written.length ? sql.join(written.map((id) => sql`${id}::uuid`), sql`, `) : null;
      const txns = ids ? (await tx.execute(sql`SELECT to_jsonb(t) AS j FROM transactions t WHERE t.tenant_id = ${tenantId}::uuid AND t.id IN (${ids})`)).rows.map((r: any) => r.j) : [];
      const rejections = ids ? (await tx.execute(sql`SELECT to_jsonb(s) AS j FROM sip_rejections s WHERE s.tenant_id = ${tenantId}::uuid AND s.transaction_id IN (${ids})`)).rows.map((r: any) => r.j) : [];
      const matches = ids ? (await tx.execute(sql`SELECT to_jsonb(m) AS j FROM business_entry_rta_matches m WHERE m.transaction_id IN (${ids})`)).rows.map((r: any) => r.j) : [];
      const counts = { ledger: ledger.length, transactions: txns.length, sipRejections: rejections.length, businessEntryMatches: matches.length, matchedExistingUnlinked: ledger.filter((l) => l.kind === "matched_existing").length };
      const investors = [...new Set<string>(txns.map((t: any) => String(t.investor_id)))];

      // ── Dependencies: what an automatic reversal would silently break ──
      const keys = ledger.map((l) => String(l.identity_key));
      const keyList = keys.length ? sql.join(keys.map((k) => sql`${k}`), sql`, `) : null;
      const n = async (q: SQL) => Number(((await tx.execute(q)).rows[0] as { n: unknown }).n);
      const dependencies: ReversalDependencies = {
        laterBatchClaims: keyList ? await n(sql`
          SELECT count(*)::int AS n FROM rta_staging_economic_txns e JOIN rta_staging_batches ob ON ob.tenant_id = e.tenant_id AND ob.id = e.batch_id
           WHERE e.tenant_id = ${tenantId}::uuid AND e.batch_id <> ${batchId}::uuid AND ob.posting_state <> 'reversed'
             AND e.posting_outcome IN ('already_posted', 'duplicate') AND e.identity_key IN (${keyList})`) : 0,
        businessEntryMatches: matches.length,
        outboxEvents: ids ? await n(sql`
          SELECT count(*)::int AS n FROM events_outbox o WHERE o.tenant_id = ${tenantId}::uuid
             AND ((o.meta->>'txId') IN (SELECT id::text FROM transactions WHERE id IN (${ids}))
               OR (o.after->>'transactionId') IN (SELECT id::text FROM transactions WHERE id IN (${ids})))`) : 0,
        workedSipRejections: rejections.filter((r: any) => r.recovery_status !== "pending" || (r.updated_at && r.created_at && new Date(r.updated_at).getTime() - new Date(r.created_at).getTime() > 1000)).length,
      };
      const blocked = Object.values(dependencies).some((v) => v > 0);
      // This batch's own claims that something was ALREADY posted are withdrawn
      // with it, so an earlier batch they point at can be reversed afterwards.
      const claims = (await tx.execute(sql`SELECT id::text AS id, posting_outcome FROM rta_staging_economic_txns
        WHERE tenant_id = ${tenantId}::uuid AND batch_id = ${batchId}::uuid AND posting_outcome IN ('already_posted', 'duplicate')`)).rows as Array<{ id: string; posting_outcome: string }>;
      (counts as Record<string, number>).claimsWithdrawn = claims.length;
      // A dry run writes nothing at all.
      if (input.dryRun) return { reversalId: null, dryRun: true, counts, dependencies, blocked };
      if (blocked) {
        throw new RecoveryError(`automatic reversal refused — later work depends on this batch (${Object.entries(dependencies).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(", ")}). `
          + "Reviewed recovery: reverse the dependent later batches newest-first, or restore the backup (docs/rta/PHASE3H_PILOT_BLOCKERS.md).");
      }
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
        for (const r of (await tx.execute(sql`SELECT id::text, last_transaction_at FROM investors WHERE id IN (${invIds})`)).rows as Array<{ id: string; last_transaction_at: string | Date | null }>) {
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
        await recordOutcome(tx, tenantId, String(l.economic_txn_id), "reversed", `reversed: ${reason.slice(0, 200)}`, { by: input.approvedBy!, via: "reversal", batchId, extra: { requestedBy: input.requestedBy, previousKind: l.kind, controlRequestId: input.controlRequestId } });
      }
      // last_transaction_at follows what remains — unless something newer
      // than this batch (another batch, a registrar master) set it.
      for (const inv of investors) {
        const before = lastTxBefore[inv];
        if (before && batchMax[inv] && before.slice(0, 10) > batchMax[inv]) continue;
        await tx.execute(sql`UPDATE investors SET last_transaction_at = (SELECT max(order_date)::timestamptz FROM transactions WHERE investor_id = ${inv}::uuid AND status IN ('processed', 'successful')), updated_at = now() WHERE id = ${inv}::uuid`);
      }
      for (const c of claims) {
        await recordOutcome(tx, tenantId, c.id, "reversed", `reversed with its batch: ${reason.slice(0, 200)}`, { by: input.approvedBy!, via: "reversal", batchId, extra: { requestedBy: input.requestedBy, previousOutcome: c.posting_outcome, controlRequestId: input.controlRequestId } });
      }
      await tx.execute(sql`UPDATE rta_staging_batches SET posting_state = 'reversed', updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${batchId}::uuid`);
      const row = (await tx.execute(sql`
        INSERT INTO rta_posting_reversals (tenant_id, batch_id, reason, requested_by, approved_by, archived, counts, control_request_id)
        VALUES (${tenantId}::uuid, ${batchId}::uuid, ${reason}, ${input.requestedBy}::uuid, ${input.approvedBy}::uuid,
                ${JSON.stringify({ transactions: txns, sip_rejections: rejections, business_entry_rta_matches: matches, ledger, previousPostingState: b.posting_state, investorLastTransactionAt: lastTxBefore, withdrawnClaims: claims })}::jsonb,
                ${JSON.stringify(counts)}::jsonb, ${input.controlRequestId}::uuid)
        RETURNING id::text`)).rows[0] as { id: string };
      await tx.execute(sql`
        INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, after, reason)
        VALUES (${tenantId}::uuid, ${input.approvedBy}::uuid, 'user', 'rta.posting.reverse', 'rta_staging_batch', ${batchId}::uuid,
                ${JSON.stringify({ reversalId: row.id, requestedBy: input.requestedBy, counts, controlRequestId: input.controlRequestId })}::jsonb, ${reason})`);
      return { reversalId: row.id, dryRun: false, counts };
    }
  }
}

/** Undoing a reversal is a two-person control request (approvals.ts, action "undo"). */
export async function undoReversal(_tenantId: string, _reversalId: string, _input: { by: string; reason: string }): Promise<Record<string, number>> {
  throw new RecoveryError("undoing a reversal needs a two-person control request: one operator requests it, a DIFFERENT signed-in operator approves it (POST /api/super-admin/rta-pipeline)");
}

/** Put every row a reversal removed back, exactly as it was — in the caller's transaction, from an executed control request. Needs posting halted, like the reversal. */
export async function undoReversalTx(tx: Tx, tenantId: string, reversalId: string, input: { by: string; requestedBy: string; reason: string; undoRequestId: string }): Promise<Record<string, number>> {
  if ((input.reason?.trim() ?? "").length < 10) throw new RecoveryError("a reason of at least 10 characters is required");
  if (!input.undoRequestId || !input.requestedBy || input.requestedBy === input.by) throw new RecoveryError("an undo needs an executed two-person control request");
  {
    const halt = await haltState(tx, tenantId, { lock: true });
    if (!halt.halted) throw new RecoveryError("halt posting for this firm first (kill switch)");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"rta_posting:" + tenantId}, 0))`);
    const r = (await tx.execute(sql`SELECT batch_id::text, archived, undone_at FROM rta_posting_reversals WHERE tenant_id = ${tenantId}::uuid AND id = ${reversalId}::uuid FOR UPDATE`)).rows[0] as { batch_id: string; archived: unknown; undone_at: unknown } | undefined;
    if (!r) throw Object.assign(new RecoveryError("reversal not found"), { status: 404 });
    if (r.undone_at) throw new RecoveryError("this reversal has already been undone");
    const a = r.archived as { transactions: any[]; sip_rejections: any[]; business_entry_rta_matches: any[]; ledger: any[]; previousPostingState: string; investorLastTransactionAt?: Record<string, string | null>; withdrawnClaims?: Array<{ id: string; posting_outcome: string }> };
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
    for (const c of a.withdrawnClaims ?? []) {
      await recordOutcome(tx, tenantId, c.id, c.posting_outcome, `restored: ${input.reason.trim().slice(0, 200)}`, { by: input.by, via: "reversal", batchId: r.batch_id, extra: { undoOf: reversalId } });
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
    await tx.execute(sql`UPDATE rta_posting_reversals SET undone_at = now(), undone_by = ${input.by}::uuid, undo_request_id = ${input.undoRequestId}::uuid WHERE id = ${reversalId}::uuid`);
    const counts = { transactions: a.transactions.length, sipRejections: a.sip_rejections.length, businessEntryMatches: a.business_entry_rta_matches.length, ledger: a.ledger.length };
    await tx.execute(sql`
      INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, after, reason)
      VALUES (${tenantId}::uuid, ${input.by}::uuid, 'user', 'rta.posting.reverse_undo', 'rta_posting_reversal', ${reversalId}::uuid, ${JSON.stringify({ ...counts, requestedBy: input.requestedBy, controlRequestId: input.undoRequestId })}::jsonb, ${input.reason.trim()})`);
    return counts;
  }
}

/**
 * Do the posting ledger, the CRM and staging agree for this firm? Every count
 * below should be zero; run it after any recovery (and nightly in a pilot).
 */
export async function reconcilePosting(tenantId: string) {
  return withTenant(tenantId, async (tx: Tx) => {
    const one = async (q: SQL) => Number(((await tx.execute(q)).rows[0] as { n: unknown }).n);
    return {
      ledgerWithoutTransaction: await one(sql`SELECT count(*)::int AS n FROM rta_posted_transactions p WHERE p.tenant_id = ${tenantId}::uuid AND p.kind <> 'matched_existing' AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = p.transaction_id)`),
      // The ledger probe names the firm too: the index is (tenant_id, transaction_id),
      // and without it each probe walked the whole index — 6 s at 20,000 rows,
      // growing with the square of the book, past the 30 s statement timeout on a
      // production-sized firm right after a large import (B-1 stabilisation, I-6).
      validateFirstTransactionWithoutLedger: await one(sql`SELECT count(*)::int AS n FROM transactions t WHERE t.tenant_id = ${tenantId}::uuid AND t.source_feed = 'rta_validate_first' AND NOT EXISTS (SELECT 1 FROM rta_posted_transactions p WHERE p.tenant_id = t.tenant_id AND p.transaction_id = t.id)`),
      postedOutcomeWithoutLedger: await one(sql`SELECT count(*)::int AS n FROM rta_staging_economic_txns e WHERE e.tenant_id = ${tenantId}::uuid AND e.posting_outcome IN ('posted', 'rejected_recorded', 'matched_existing') AND NOT EXISTS (SELECT 1 FROM rta_posted_transactions p WHERE p.tenant_id = e.tenant_id AND p.identity_key = e.identity_key)`),
      ledgerIdentityTwice: await one(sql`SELECT count(*)::int AS n FROM (SELECT identity_key FROM rta_posted_transactions WHERE tenant_id = ${tenantId}::uuid GROUP BY 1 HAVING count(*) > 1) x`),
      rejectedWithUnits: await one(sql`SELECT count(*)::int AS n FROM transactions WHERE tenant_id = ${tenantId}::uuid AND source_feed = 'rta_validate_first' AND status = 'rejected' AND coalesce(units, 0) <> 0`),
    };
  });
}
