/**
 * Posting staged RTA transactions into the CRM (Phase 3F) — DEVELOPMENT ONLY,
 * behind the fail-closed gate (./gate.ts), checked inside the posting
 * transaction itself.
 *
 * Input: one staged transaction batch that has been through every validation
 * stage (identify → decode → stage → strict field validation → owner
 * resolution → classification → duplicate / correction checks → financial
 * reconciliation). Nothing in this file decides those; it only commits what
 * they made eligible, and re-checks the CRM at commit time.
 *
 * One batch posts in ONE database transaction under a per-tenant advisory
 * lock: everything or nothing. Per economic transaction the outcome is one of
 *   posted              a new CRM transaction (a multi-lot redemption once,
 *                       its lots kept in rta_staging_lots)
 *   matched_existing    the CRM already holds the same transaction — linked,
 *                       not duplicated, not changed
 *   rejected_recorded   a refused instruction: a rejected transaction (0
 *                       units, never business) + a SIP Rejection for a SIP
 *   already_posted      this registrar identity is in the posting ledger
 *                       (retry, re-import, overlapping file)
 *   duplicate           restated identically by an earlier file that has not
 *                       posted it either (nothing to write)
 *   quarantined         identity, owner or figures not established; or the
 *                       CRM holds a DIFFERENT transaction under this number
 *                       (never overwritten)
 *   unsupported         a code, reversal or cancellation with no verified
 *                       meaning — visible in exceptions, never posted
 *   correction_held     a proved folio correction — not a transaction
 *   held_dependent      would be independent, but shares its folio with a
 *                       quarantined transaction of this batch
 *   blocked             partial commits not allowed and the batch has problems
 *
 * Identity is the registrar's (kfin.v1:<Fund>:<No> / cams.v1:<amc>:<No>) —
 * never a row number. A registrar number is not assumed unique beyond that
 * key: an existing CRM row under the same number that differs in folio,
 * scheme, date, direction, amount or units is a conflict, never a match.
 */
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { CLASS_META, type RtaClass } from "../staging/classify";
import { assertPostingAllowed } from "./gate";
import { classifyRejectionReason } from "../process";

type Tx = any;

export type PostingOutcome =
  | "posted" | "matched_existing" | "rejected_recorded" | "already_posted" | "duplicate"
  | "quarantined" | "unsupported" | "correction_held" | "held_dependent" | "blocked";

export type PostOptions = {
  /** "none": any problem blocks the whole batch. "independent": post what is proven independent. */
  partial?: "none" | "independent";
  userId?: string | null;
  /** TEST ONLY: throw after this many writes, to prove a crash commits nothing. */
  failAfterWrites?: number;
  /** Mark the related rta_file_imports row with the committed outcome. */
  importId?: string | null;
};

export type PostResult = {
  batchId: string;
  state: "posted" | "partially_posted" | "blocked" | "nothing_to_post";
  counts: Partial<Record<PostingOutcome, number>>;
  /** Σ over what was POSTED (new CRM transactions), by direction — for reconciliation. */
  postedTotals: { inflowAmount: number; outflowAmount: number; units: number; transactions: number; lots: number };
  replayed: boolean;
};

const UNSUPPORTED = new Set([
  "unknown_transaction_code", "non_financial_event", "class_unverified_idcw", "rejection_semantics_unverified",
  "reversal_unlinked", "cancellation_unlinked", "pre_rejection_unlinked", "switch_stp_ambiguous", "head_code_conflict",
  "registrar_status_not_processed",
]);
/** Exceptions that make a folio's other transactions in the batch dependent (ownership / identity not settled). */
const TAINTS_FOLIO = /^(identity_|folio_|owner_|placeholder_|huf_|pan_matches_|group_|lot_|restated_by_registrar)/;

export type Econ = {
  id: string; identity_key: string; rta: string; amc_code: string | null; folio_number: string | null; scheme_code: string | null;
  registrar_txn_no: string; trade_date: string | null; rta_class: RtaClass; direction: "inflow" | "outflow" | null; status: string;
  reason: string | null; row_count: number; lot_count: number; reported_units: string | null; reported_amount: string | null;
  reported_nav: string | null; reported_exit_load: string | null; reported_stt: string | null; reported_stamp_duty: string | null;
  match_investor_id: string | null; match_folio_id: string | null; match_rule: string | null; duplicate_of_id: string | null;
  first_attrs: Record<string, unknown> | null; row_nos: number[];
};

const exceptionOf = (e: Econ) => (e.status === "complete" ? null : (e.reason ?? "").split(":")[0].trim() || null);
const abs = (v: string | null) => (v == null ? null : Math.abs(Number(v)));

export async function postTransactionBatch(tenantId: string, batchId: string, opts: PostOptions = {}): Promise<PostResult> {
  return withTenant(tenantId, async (tx: Tx) => {
    await assertPostingAllowed(tx, tenantId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"rta_posting:" + tenantId}, 0))`);

    const b = (await tx.execute(sql`
      SELECT id, state, record_kind, rta, posting_state, posting_counts FROM rta_staging_batches
       WHERE tenant_id = ${tenantId}::uuid AND id = ${batchId}::uuid FOR UPDATE
    `)).rows[0] as { id: string; state: string; record_kind: string | null; rta: string; posting_state: string; posting_counts: Record<string, number> } | undefined;
    if (!b) throw new Error("staging batch not found for this firm");
    if (b.record_kind !== "transaction") throw new Error(`batch is a ${b.record_kind ?? "unidentified"} file, not transactions`);
    if (!["ready_to_commit", "exception"].includes(b.state)) throw new Error(`batch is "${b.state}" — validation has not finished, nothing can post`);
    const totals0 = { inflowAmount: 0, outflowAmount: 0, units: 0, transactions: 0, lots: 0 };
    if (["posted", "partially_posted", "nothing_to_post"].includes(b.posting_state)) {
      return { batchId, state: b.posting_state as PostResult["state"], counts: b.posting_counts as PostResult["counts"], postedTotals: totals0, replayed: true };
    }

    const econs = (await tx.execute(sql`
      SELECT e.id, e.identity_key, e.rta, e.amc_code, e.folio_number, e.scheme_code, e.registrar_txn_no, e.trade_date::text AS trade_date,
             e.rta_class, e.direction, e.status, e.reason, e.row_count, e.lot_count, e.reported_units::text AS reported_units,
             e.reported_amount::text AS reported_amount, e.reported_nav::text AS reported_nav, e.reported_exit_load::text AS reported_exit_load,
             e.reported_stt::text AS reported_stt, e.reported_stamp_duty::text AS reported_stamp_duty,
             e.match_investor_id, e.match_folio_id, e.match_rule, e.duplicate_of_id,
             (SELECT r.attrs FROM rta_staging_rows r WHERE r.tenant_id = e.tenant_id AND r.economic_txn_id = e.id ORDER BY r.row_no LIMIT 1) AS first_attrs,
             (SELECT array_agg(r.row_no ORDER BY r.row_no) FROM rta_staging_rows r WHERE r.tenant_id = e.tenant_id AND r.economic_txn_id = e.id) AS row_nos
        FROM rta_staging_economic_txns e
       WHERE e.tenant_id = ${tenantId}::uuid AND e.batch_id = ${batchId}::uuid
       ORDER BY e.identity_key
    `)).rows as Econ[];

    const ledger = new Set<string>();
    if (econs.length) {
      const rows = (await tx.execute(sql`
        SELECT identity_key FROM rta_posted_transactions
         WHERE tenant_id = ${tenantId}::uuid AND identity_key IN (${sql.join(econs.map((e) => sql`${e.identity_key}`), sql`, `)})
      `)).rows as Array<{ identity_key: string }>;
      rows.forEach((r) => ledger.add(r.identity_key));
    }

    // ── 1. Decide, before any write ──────────────────────────────────────────
    type Plan = { e: Econ; outcome: PostingOutcome; reason: string | null; write?: "new" | "rejected" };
    const plan: Plan[] = econs.map((e): Plan => {
      const ex = exceptionOf(e);
      if (ledger.has(e.identity_key)) return { e, outcome: "already_posted", reason: "this registrar transaction is already in the posting ledger" };
      if (e.status === "conflict") return { e, outcome: "quarantined", reason: e.reason };
      if (e.status === "restated") return { e, outcome: "quarantined", reason: e.reason };
      if (e.status === "quarantined") {
        if (ex === "instalment_rejected") {
          // A refused instruction is recorded only against a folio already on record.
          if (!e.match_investor_id || !e.match_folio_id || !(e.match_rule ?? "").startsWith("existing_folio_owner")) {
            return { e, outcome: "quarantined", reason: `owner_not_on_record: a refused instruction is recorded only against a folio on record (decision "${e.match_rule ?? "none"}")` };
          }
          return { e, outcome: "rejected_recorded", reason: null, write: "rejected" };
        }
        if (ex === "folio_consolidation") return { e, outcome: "correction_held", reason: e.reason };
        if (ex && UNSUPPORTED.has(ex)) return { e, outcome: "unsupported", reason: e.reason };
        return { e, outcome: "quarantined", reason: e.reason };
      }
      // complete, or an identical restatement of an earlier file's (never-posted) transaction
      const rule = (e.match_rule ?? "").split(":")[0];
      if (!e.match_investor_id || !["existing_folio_owner", "owner_by_pan"].includes(rule)) {
        return { e, outcome: "quarantined", reason: `owner_not_on_record: the owner decision is "${e.match_rule ?? "none"}" — a transaction posts only to a client already on record (masters first); nothing created` };
      }
      if (!CLASS_META[e.rta_class]?.legacyType || !e.direction) return { e, outcome: "unsupported", reason: `class ${e.rta_class} has no CRM transaction type` };
      return { e, outcome: "posted", reason: null, write: "new" };
    });

    // ── 2. Independence: a transaction shares its folio with an unsettled one ─
    const tainted = new Set(plan.filter((p) => p.outcome === "quarantined" && TAINTS_FOLIO.test(exceptionOf(p.e) ?? (p.e.status === "conflict" ? "identity_conflict" : "")))
      .map((p) => `${p.e.amc_code}|${p.e.folio_number}`));
    const problems = plan.filter((p) => ["quarantined", "unsupported"].includes(p.outcome)).length;
    const partial = opts.partial ?? "none";
    if (problems && partial === "none") {
      for (const p of plan) if (p.write) { p.outcome = "blocked"; p.reason = "partial commits are not allowed for this batch and it has quarantined or unsupported transactions"; p.write = undefined; }
    } else {
      for (const p of plan) {
        if (p.write && tainted.has(`${p.e.amc_code}|${p.e.folio_number}`)) {
          p.outcome = "held_dependent"; p.write = undefined;
          p.reason = "another transaction of this folio in the same file is quarantined for identity or figures — held until it is resolved, so the folio's history is not split";
        }
      }
    }

    // ── 3. Commit ───────────────────────────────────────────────────────────
    let writes = 0;
    const tick = () => { writes++; if (opts.failAfterWrites != null && writes >= opts.failAfterWrites) throw new Error("injected crash after partial progress (test)"); };
    const totals = { ...totals0 };
    const lastTx = new Map<string, string>();

    for (const p of plan) {
      if (!p.write) continue;
      const r = await commitEconomicTxn(tx, tenantId, p.e, p.write, { batchId, userId: opts.userId ?? null, tick });
      p.outcome = r.outcome; p.reason = r.reason;
      if (r.outcome !== "posted" && r.outcome !== "rejected_recorded" && r.outcome !== "matched_existing") p.write = undefined;
      if (r.posted) {
        if (r.posted.direction === "inflow") totals.inflowAmount += r.posted.amount; else totals.outflowAmount += r.posted.amount;
        totals.units += r.posted.units; totals.transactions++; totals.lots += r.posted.lots;
        const prev = lastTx.get(r.posted.investorId);
        if (r.posted.tradeDate && (!prev || r.posted.tradeDate > prev)) lastTx.set(r.posted.investorId, r.posted.tradeDate);
      }
    }

    for (const [inv, d] of lastTx) {
      await tx.execute(sql`UPDATE investors SET last_transaction_at = GREATEST(COALESCE(last_transaction_at, 'epoch'::timestamptz), ${d}::timestamptz), updated_at = now() WHERE id = ${inv}::uuid`);
    }

    // ── 4. Record every outcome: economic transactions, rows, batch, import ──
    const counts: Partial<Record<PostingOutcome, number>> = {};
    for (const p of plan) counts[p.outcome] = (counts[p.outcome] ?? 0) + 1;
    for (const p of plan) await recordOutcome(tx, tenantId, p.e.id, p.outcome, p.reason, { by: opts.userId ?? null, via: "batch", batchId });
    const committed = (counts.posted ?? 0) + (counts.rejected_recorded ?? 0) + (counts.matched_existing ?? 0);
    const state: PostResult["state"] = !plan.length || (!committed && !problems && !(counts.blocked ?? 0)) ? "nothing_to_post"
      : (counts.blocked ?? 0) > 0 ? "blocked"
      : plan.every((p) => ["posted", "matched_existing", "rejected_recorded", "already_posted", "duplicate"].includes(p.outcome)) ? "posted" : "partially_posted";
    await tx.execute(sql`
      UPDATE rta_staging_batches SET posting_state = ${state}, posted_at = now(), posting_counts = ${JSON.stringify(counts)}::jsonb, updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND id = ${batchId}::uuid`);
    // Operator / file audit trail: one row per committed posting run, in the same transaction.
    await tx.execute(sql`
      INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
      VALUES (${tenantId}::uuid, ${opts.userId ?? null}::uuid, ${opts.userId ? "user" : "system"}, 'rta.posting.batch', 'rta_staging_batch', ${batchId}::uuid,
              ${JSON.stringify({ state, counts, importId: opts.importId ?? null, postedTotals: totals })}::jsonb)`);
    if (opts.importId) {
      const held = (counts.quarantined ?? 0) + (counts.unsupported ?? 0) + (counts.correction_held ?? 0) + (counts.held_dependent ?? 0) + (counts.blocked ?? 0);
      const imported = (counts.posted ?? 0) + (counts.rejected_recorded ?? 0);
      const unchanged = (counts.matched_existing ?? 0) + (counts.already_posted ?? 0) + (counts.duplicate ?? 0);
      await tx.execute(sql`
        UPDATE rta_file_imports
           SET status = ${state === "blocked" || (imported + unchanged === 0 && held > 0) ? "failed" : held > 0 ? "partial" : "completed"},
               parsed_at = now(), rows_imported = ${imported}, rows_skipped = ${held}, rows_failed = 0,
               remarks = ${`Validate-first: ${imported} committed, ${unchanged} already in the CRM, ${held} held (see the staging exceptions). Counts are economic transactions, not file rows.`}
         WHERE tenant_id = ${tenantId}::uuid AND id = ${opts.importId}::uuid`);
    }
    return { batchId, state, counts, postedTotals: totals, replayed: false };
  });
}

/** The outcome of committing one economic transaction. */
export type CommitResult = {
  outcome: Extract<PostingOutcome, "posted" | "rejected_recorded" | "matched_existing" | "quarantined">;
  reason: string | null;
  posted?: { investorId: string; direction: "inflow" | "outflow" | null; amount: number; units: number; lots: number; tradeDate: string | null };
};

/**
 * Commit ONE validated economic transaction whose owner is settled
 * (e.match_investor_id, and e.match_folio_id or a folio this owner may open).
 * Shared by batch posting and by re-evaluation of held transactions, so a
 * promoted transaction is written exactly like one that posted first time.
 * Caller holds the posting gate and the firm's posting lock.
 */
export async function commitEconomicTxn(tx: Tx, tenantId: string, e: Econ, write: "new" | "rejected", ctx: { batchId: string; userId: string | null; tick?: () => void }): Promise<CommitResult> {
    const attrs = (e.first_attrs ?? {}) as Record<string, unknown>;
    // The folio this posts to: the one on record; an owner_by_pan transaction may open the owner's new folio.
    let folioId = e.match_folio_id;
    if (!folioId) {
      await tx.execute(sql`
        INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta)
        VALUES (${tenantId}::uuid, ${e.match_investor_id}::uuid, ${e.folio_number}, ${e.amc_code}, ${e.amc_code}, ${e.rta})
        ON CONFLICT (tenant_id, amc_code, folio_number) DO NOTHING`);
      const f = (await tx.execute(sql`SELECT id, investor_id FROM folios WHERE tenant_id = ${tenantId}::uuid AND amc_code = ${e.amc_code} AND folio_number = ${e.folio_number}`)).rows[0] as { id: string; investor_id: string | null } | undefined;
      if (!f || String(f.investor_id) !== String(e.match_investor_id)) {
        return { outcome: "quarantined", reason: "folio_owner_conflict: the folio is on record under a different client — nothing reassigned" };
      }
      folioId = String(f.id);
    }
    const units = abs(e.reported_units) ?? 0;
    const amount = abs(e.reported_amount);
    const lineage = {
      pipeline: "validate_first", identityKey: e.identity_key, batchId: ctx.batchId, economicTxnId: e.id, sourceRows: e.row_nos, lotCount: e.lot_count,
      reportedExitLoad: e.reported_exit_load, reportedStt: e.reported_stt, reportedStampDuty: e.reported_stamp_duty,
      // The registrar's amount, not a verified payout: whether STT is deducted from it is not evidenced.
      amountMeaning: "registrar_reported", payoutVerified: false,
      eventCategory: attrs.eventCategory ?? null, switchRef: attrs.switchRef ?? null,
    };

    // The CRM may already hold this registrar number.
    const existing = (await tx.execute(sql`
      SELECT id, amc_code, folio_number, scheme_code, order_date::text AS d, direction, amount::text AS amount, units::text AS units, status
        FROM transactions WHERE tenant_id = ${tenantId}::uuid AND order_id = ${e.registrar_txn_no}
    `)).rows as Array<{ id: string; amc_code: string | null; folio_number: string | null; scheme_code: string | null; d: string; direction: string; amount: string | null; units: string | null; status: string }>;
    if (existing.length) {
      const t = existing[0];
      const same = existing.length === 1 && (!t.amc_code || t.amc_code === e.amc_code) && t.folio_number === e.folio_number && t.d === e.trade_date
        && (write === "rejected" ? t.status === "rejected" : t.direction === e.direction && Math.abs((abs(t.amount) ?? 0) - (amount ?? 0)) <= 0.005 && Math.abs((abs(t.units) ?? 0) - units) <= 0.0005);
      if (!same) {
        return { outcome: "quarantined", reason: "identity_conflict: the CRM holds a different transaction under this registrar number — neither is changed" };
      }
      await tx.execute(sql`
        INSERT INTO rta_posted_transactions (tenant_id, identity_key, economic_txn_id, batch_id, kind, transaction_id, posted_by)
        VALUES (${tenantId}::uuid, ${e.identity_key}, ${e.id}::uuid, ${ctx.batchId}::uuid, 'matched_existing', ${t.id}::uuid, ${ctx.userId}::uuid)
        ON CONFLICT (tenant_id, identity_key) DO NOTHING`);
      ctx.tick?.();
      return { outcome: "matched_existing", reason: "the CRM already holds this transaction — linked, not duplicated" };
    }

    if (write === "rejected") {
      const cat = String(attrs.eventCategory ?? "failed_sip_instalment");
      const reason = String(attrs.rejectionReason ?? "No reason given in the file");
      const type = cat === "failed_stp_leg" ? "stp" : "sip";
      const ins = (await tx.execute(sql`
        INSERT INTO transactions (tenant_id, investor_id, folio_id, folio_number, amc_code, amc_name, scheme_code, scheme_name,
          type, direction, amount, units, nav, order_id, order_date, status, reason_code, reason_description, source_feed, raw_feed_row, dedup_key)
        VALUES (${tenantId}::uuid, ${e.match_investor_id}::uuid, ${folioId}::uuid, ${e.folio_number}, ${e.amc_code}, ${e.amc_code}, ${e.scheme_code},
          ${String(attrs.schemeName ?? e.scheme_code)}, ${type}, ${e.direction ?? (attrs.head === "R" ? "outflow" : "inflow")}, ${amount}, 0, NULL,
          ${e.registrar_txn_no}, ${e.trade_date}::date, 'rejected', ${cat}, ${reason}, 'rta_validate_first', ${JSON.stringify(lineage)}::jsonb, ${e.identity_key})
        ON CONFLICT DO NOTHING RETURNING id`)).rows[0] as { id: string } | undefined;
      if (!ins) return { outcome: "quarantined", reason: "identity_conflict: a concurrent write took this registrar number" };
      let sipRejectionId: string | null = null;
      if (cat === "failed_sip_instalment") {
        const inv = (await tx.execute(sql`SELECT rm_id FROM investors WHERE id = ${e.match_investor_id}::uuid`)).rows[0] as { rm_id: string | null } | undefined;
        const followUp = new Date(new Date(e.trade_date!).getTime() + 2 * 864e5).toISOString().slice(0, 10);
        const r = (await tx.execute(sql`
          INSERT INTO sip_rejections (tenant_id, investor_id, transaction_id, rejection_date, rejection_amount, rejection_reason, scheme_name,
            folio_number, amc_name, recovery_status, assigned_rm_id, follow_up_date, reason_category, dedup_key)
          VALUES (${tenantId}::uuid, ${e.match_investor_id}::uuid, ${ins.id}::uuid, ${e.trade_date}::date, ${amount}, ${reason}, ${String(attrs.schemeName ?? e.scheme_code)},
            ${e.folio_number}, ${e.amc_code}, 'pending', ${inv?.rm_id ?? null}::uuid, ${followUp}::date, ${classifyRejectionReason(String(reason ?? ""))}, ${"rta-vf:" + e.identity_key})
          ON CONFLICT DO NOTHING RETURNING id`)).rows[0] as { id: string } | undefined;
        sipRejectionId = r?.id ?? null;
      }
      await tx.execute(sql`
        INSERT INTO rta_posted_transactions (tenant_id, identity_key, economic_txn_id, batch_id, kind, transaction_id, sip_rejection_id, posted_by)
        VALUES (${tenantId}::uuid, ${e.identity_key}, ${e.id}::uuid, ${ctx.batchId}::uuid, 'rejected_recorded', ${ins.id}::uuid, ${sipRejectionId}::uuid, ${ctx.userId}::uuid)`);
      ctx.tick?.();
      return { outcome: "rejected_recorded", reason: null };
    }

    const type = CLASS_META[e.rta_class].legacyType!;
    const ins = (await tx.execute(sql`
      INSERT INTO transactions (tenant_id, investor_id, folio_id, folio_number, amc_code, amc_name, scheme_code, scheme_name,
        type, direction, amount, units, nav, order_id, order_date, status, source_feed, raw_feed_row, dedup_key)
      VALUES (${tenantId}::uuid, ${e.match_investor_id}::uuid, ${folioId}::uuid, ${e.folio_number}, ${e.amc_code}, ${e.amc_code}, ${e.scheme_code},
        ${String(attrs.schemeName ?? e.scheme_code)}, ${type}, ${e.direction}, ${amount}, ${units}, ${e.reported_nav},
        ${e.registrar_txn_no}, ${e.trade_date}::date, 'processed', 'rta_validate_first', ${JSON.stringify(lineage)}::jsonb, ${e.identity_key})
      ON CONFLICT DO NOTHING RETURNING id`)).rows[0] as { id: string } | undefined;
    if (!ins) return { outcome: "quarantined", reason: "identity_conflict: a concurrent write took this registrar number" };
    await tx.execute(sql`
      INSERT INTO rta_posted_transactions (tenant_id, identity_key, economic_txn_id, batch_id, kind, transaction_id, posted_by)
      VALUES (${tenantId}::uuid, ${e.identity_key}, ${e.id}::uuid, ${ctx.batchId}::uuid, 'posted_new', ${ins.id}::uuid, ${ctx.userId}::uuid)`);
    ctx.tick?.();
    return { outcome: "posted", reason: null, posted: { investorId: String(e.match_investor_id), direction: e.direction, amount: amount ?? 0, units, lots: e.lot_count, tradeDate: e.trade_date } };
}

/**
 * Set an economic transaction's current posting outcome AND append it to its
 * history (migration 0236), so a later promotion or resolution never erases
 * why it was held. Its rows' disposition follows the current outcome.
 */
export async function recordOutcome(tx: Tx, tenantId: string, econId: string, outcome: string, reason: string | null,
  meta: { by: string | null; via: "batch" | "reevaluation" | "manual_resolution" | "reversal"; batchId?: string | null; extra?: Record<string, unknown> }): Promise<void> {
  const entry = { at: new Date().toISOString(), outcome, reason, by: meta.by, via: meta.via, batchId: meta.batchId ?? null, ...(meta.extra ?? {}) };
  await tx.execute(sql`
    UPDATE rta_staging_economic_txns
       SET posting_outcome = ${outcome}, posting_reason = ${reason}, posted_at = now(), updated_at = now(),
           posting_history = posting_history || ${JSON.stringify([entry])}::jsonb
     WHERE tenant_id = ${tenantId}::uuid AND id = ${econId}::uuid`);
  await tx.execute(sql`
    UPDATE rta_staging_rows SET disposition = ${outcome}, updated_at = now()
     WHERE tenant_id = ${tenantId}::uuid AND economic_txn_id = ${econId}::uuid`);
}
