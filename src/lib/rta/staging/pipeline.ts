/**
 * The RTA staging pipeline — SHADOW mode (Phase 3B).
 *
 *   uploaded ─identify─▶ identified ─parse+validate─▶ validated ─match─▶ matched
 *            ─group+reconcile─▶ ready_to_commit | exception        (or failed)
 *
 * Each arrow is ONE database transaction under the tenant's RLS context. A
 * stage either commits entirely or not at all, and the batch's `state` names
 * the last stage that committed — so a crash, a lost lease or a killed worker
 * leaves a batch that the next attempt resumes from exactly that point
 * (`attempt` counts tries; `stage_log` records each). Re-running a finished
 * batch is a no-op that returns its result.
 *
 * WHAT IT NEVER DOES: write to investors, folios, transactions, sips, holdings
 * or any other live table. Live tables are only READ — to match clients and
 * folios (InvestorDirectory, the same rules as the importer) and to compare
 * against transactions the existing importer already holds. The proposed
 * posting is a column (`proposed_action`), not a write.
 *
 * Idempotency, four cases:
 *   1. the same batch again        → no-op (state is final; rows are unique
 *                                     per (batch_id, row_no) regardless)
 *   2. the same file, a new batch  → `same_file_as_batch_id` names the earlier
 *                                     batch; every registrar transaction comes
 *                                     out `duplicate` of the earlier one
 *   3. overlapping report periods  → a registrar transaction already staged by
 *                                     an earlier batch, with the same invariants
 *                                     and the same lots, is `duplicate`
 *   4. a corrected / revised report → same identity, same invariants, different
 *                                     lots → `restated`; different invariants →
 *                                     `conflict`. Both are held; neither side is
 *                                     changed.
 * A re-run AFTER new client data arrived (transactions before masters) is a
 * new batch with `rerun_of_batch_id`: the batch it re-runs is set aside for
 * duplicate detection, so its transactions are re-matched, not "duplicated".
 *
 * Concurrency: the group stage takes a per-tenant transaction-scoped advisory
 * lock, so two batches carrying the same registrar transaction are decided one
 * after the other — exactly one of them is first. A batch is claimed with a
 * lease (`lease_owner`, `lease_until`), so two workers never run one batch.
 */
import { and, eq, sql } from "drizzle-orm";
import { withTenant, type Tx } from "@/db/client";
import { rtaStagingBatches, rtaStagingEconomicTxns, rtaStagingLots, rtaStagingRows, rtaStagingChecks, type RtaBatchState } from "@/db/schema/rta_staging";
import { InvestorDirectory } from "../identity";
import { InvestorOwnerDirectory } from "../owner-directory";
import { resolveOwner } from "../owner";
import { STAGING_CHUNK, STAGING_LEASE_MS, STAGING_PARSER_VERSION } from "./config";
import { assertTokenKey } from "./pan-token";
import { identifyLayout, normalizeRows, LAYOUTS, type Layout, type NormRow } from "./layouts";
import { readLines, sha256, tableFrom } from "./source";
import { groupTransactions, type EconOut } from "./group";
import { buildChecks, type CheckOut } from "./checks";

export type StageName = "identify" | "parse" | "match" | "reconcile";

export type RunOptions = {
  workerId?: string;
  /** Test hook: throw after a stage's work, before its transaction commits. */
  failInsideStage?: StageName;
};

export type CreateBatchInput = {
  tenantId: string;
  fileName: string;
  fileRef: string;
  buf: Uint8Array;
  importId?: string | null;
  createdBy?: string | null;
  rerunOfBatchId?: string | null;
};

export class StagingStageError extends Error {
  constructor(public stage: StageName, message: string) {
    super(message);
    this.name = "StagingStageError";
  }
}

const ORDER: RtaBatchState[] = ["uploaded", "identified", "parsed", "validated", "matched", "reconciled", "ready_to_commit"];
const FINAL = new Set<RtaBatchState>(["ready_to_commit", "exception"]);
const reached = (state: RtaBatchState, target: RtaBatchState) => ORDER.indexOf(state) >= ORDER.indexOf(target);

function chunks<T>(arr: T[], n = STAGING_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Record a new batch for a file. Never reuses an earlier batch: history is kept. */
export async function createShadowBatch(input: CreateBatchInput): Promise<string> {
  assertTokenKey();
  const checksum = sha256(input.buf);
  return withTenant(input.tenantId, async (tx) => {
    const prior = (await tx.execute(sql`
      SELECT id FROM rta_staging_batches
       WHERE tenant_id = ${input.tenantId}::uuid AND file_checksum = ${checksum} AND state <> 'failed'
         AND (${input.rerunOfBatchId ?? null}::uuid IS NULL OR id <> ${input.rerunOfBatchId ?? null}::uuid)
       ORDER BY created_at ASC, id ASC LIMIT 1
    `)).rows as Array<{ id: string }>;
    const [row] = await tx.insert(rtaStagingBatches).values({
      tenantId: input.tenantId,
      importId: input.importId ?? null,
      fileName: input.fileName,
      fileRef: input.fileRef,
      fileChecksum: checksum,
      fileSizeBytes: input.buf.length,
      parserVersion: STAGING_PARSER_VERSION,
      sameFileAsBatchId: input.rerunOfBatchId ? null : prior[0]?.id ?? null,
      rerunOfBatchId: input.rerunOfBatchId ?? null,
      createdBy: input.createdBy ?? null,
    }).returning({ id: rtaStagingBatches.id });
    return row.id;
  });
}

type BatchRow = typeof rtaStagingBatches.$inferSelect;

async function loadBatch(tx: Tx, tenantId: string, batchId: string, lock = false): Promise<BatchRow> {
  const q = tx.select().from(rtaStagingBatches).where(and(eq(rtaStagingBatches.tenantId, tenantId), eq(rtaStagingBatches.id, batchId)));
  const [b] = lock ? await q.for("update") : await q;
  if (!b) throw new Error("staging batch not found");
  return b;
}

const logEntry = (stage: string, attempt: number, ms: number, note?: string) =>
  JSON.stringify([{ stage, at: new Date().toISOString(), attempt, ms, ...(note ? { note } : {}) }]);

/**
 * Run (or resume) a batch to a final state. `buf` must be the file the batch
 * was created for — its checksum is verified, so a resumed batch can never be
 * finished against different bytes.
 */
export async function runShadowBatch(tenantId: string, batchId: string, buf: Uint8Array, opts: RunOptions = {}): Promise<{ state: RtaBatchState; busy?: boolean }> {
  assertTokenKey();
  const me = opts.workerId ?? `pid:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;

  // Claim the lease (or find the batch already final / held by another worker).
  const claim = await withTenant(tenantId, async (tx) => {
    const b = await loadBatch(tx, tenantId, batchId, true);
    if (FINAL.has(b.state)) return { done: b.state };
    if (b.leaseOwner && b.leaseOwner !== me && b.leaseUntil && b.leaseUntil.getTime() > Date.now()) return { busy: b.state };
    if (b.fileChecksum !== sha256(buf)) throw new Error("the file supplied is not the file this batch was created for (checksum differs)");
    await tx.update(rtaStagingBatches).set({
      leaseOwner: me, leaseUntil: new Date(Date.now() + STAGING_LEASE_MS),
      attempt: sql`${rtaStagingBatches.attempt} + 1`,
      state: b.state === "failed" ? lastGoodState(b) : b.state,
      error: null, updatedAt: new Date(),
    }).where(and(eq(rtaStagingBatches.tenantId, tenantId), eq(rtaStagingBatches.id, batchId)));
    return { go: true };
  });
  if ("done" in claim) return { state: claim.done as RtaBatchState };
  if ("busy" in claim) return { state: claim.busy as RtaBatchState, busy: true };

  // Everything below works from the file in memory; nothing personal is persisted.
  let lines: string[][] | null = null;
  let found: { layout: Layout; headerIndex: number } | null = null;
  let norm: NormRow[] | null = null;
  const prepare = () => {
    if (norm) return;
    lines = readLines(buf, "");
    found = identifyLayout(lines);
    if (!found) return;
    const table = tableFrom(lines, found.headerIndex);
    norm = normalizeRows(tenantId, found.layout, table.header, table.rows);
  };

  try {
    // ── identify ──────────────────────────────────────────────────────────
    await stage(tenantId, batchId, me, "identify", "uploaded", "identified", opts, async (tx, b) => {
      lines = readLines(buf, b.fileName);
      found = identifyLayout(lines);
      if (!found) {
        return { final: "exception" as const, error: "the file's header matches none of the verified layouts (KFintech MFSD201 / MFSD203 / MFSD211 / MFSD230 / MFSD243, CAMS R2 / R9 / WBR4 / WBR10 / WBR49) — nothing staged" };
      }
      const rows = lines.length - found.headerIndex - 1;
      await tx.update(rtaStagingBatches).set({
        rta: found.layout.rta, reportCode: found.layout.reportCode, recordKind: found.layout.recordKind,
        identityScheme: found.layout.identityScheme, rowCount: rows,
      }).where(and(eq(rtaStagingBatches.tenantId, tenantId), eq(rtaStagingBatches.id, batchId)));
      return {};
    });

    // ── parse + validate: every data row, exactly once ────────────────────
    await stage(tenantId, batchId, me, "parse", "identified", "validated", opts, async (tx) => {
      prepare();
      if (!norm || !found) throw new Error("layout not identified");
      for (const part of chunks(norm)) {
        await tx.insert(rtaStagingRows).values(part.map((r) => rowValues(tenantId, batchId, r))).onConflictDoNothing();
      }
      const dates = norm.map((r) => r.tradeDate ?? r.asOfDate).filter((d): d is string => !!d).sort();
      const asOf = [...new Set(norm.map((r) => r.asOfDate).filter(Boolean))];
      await tx.update(rtaStagingBatches).set({
        periodStart: dates[0] ?? null, periodEnd: dates[dates.length - 1] ?? null,
        asOfDate: asOf.length === 1 ? asOf[0] : null,
      }).where(and(eq(rtaStagingBatches.tenantId, tenantId), eq(rtaStagingBatches.id, batchId)));
      return {};
    });

    // ── match: read-only against live clients and folios ─────────────────
    await stage(tenantId, batchId, me, "match", "validated", "matched", opts, async (tx) => {
      prepare();
      const results = await matchRows(tx, tenantId, norm!, found!.layout.rta);
      for (const part of chunks(results)) {
        const values = sql.join(part.map((m) => sql`(${m.rowNo}::int, ${m.state}, ${m.investorId}::uuid, ${m.folioId}::uuid, ${m.rule}, ${m.exception}, ${m.reason}, ${m.proposal ? JSON.stringify(m.proposal) : null}::jsonb)`), sql`, `);
        await tx.execute(sql`
          UPDATE rta_staging_rows r
             SET state = v.state, match_investor_id = v.inv, match_folio_id = v.fol, match_rule = v.rule,
                 exception_code = COALESCE(v.exc, r.exception_code), reason = COALESCE(v.reason, r.reason),
                 attrs = CASE WHEN v.prop IS NULL THEN r.attrs ELSE r.attrs || jsonb_build_object('proposedOwner', v.prop) END,
                 updated_at = now()
            FROM (VALUES ${values}) AS v(row_no, state, inv, fol, rule, exc, reason, prop)
           WHERE r.tenant_id = ${tenantId}::uuid AND r.batch_id = ${batchId}::uuid AND r.row_no = v.row_no AND r.state <> 'invalid'
        `);
      }
      return {};
    });

    // ── group + reconcile (serialised per tenant) ─────────────────────────
    await stage(tenantId, batchId, me, "reconcile", "matched", "reconciled", opts, async (tx, b) => {
      prepare();
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"rta_staging:" + tenantId}, 0))`);
      const layout = LAYOUTS.find((l) => l.reportCode === b.reportCode && l.rta === b.rta)!;
      const outcome = await reconcile(tx, tenantId, b, layout, norm!);
      return { final: outcome.anyFail ? ("exception" as const) : ("ready_to_commit" as const), counts: outcome.counts };
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Another worker took the batch over: it is theirs to finish, not ours to fail.
    if (e instanceof StagingStageError && /lease lost|expected/.test(e.message)) throw e;
    await withTenant(tenantId, async (tx) => {
      await tx.update(rtaStagingBatches).set({
        state: "failed", error: message.slice(0, 2000), leaseOwner: null, leaseUntil: null, updatedAt: new Date(),
        stageLog: sql`${rtaStagingBatches.stageLog} || ${logEntry("failed", 0, 0, message.slice(0, 300))}::jsonb`,
      }).where(and(eq(rtaStagingBatches.tenantId, tenantId), eq(rtaStagingBatches.id, batchId)));
    });
    throw e;
  }

  return withTenant(tenantId, async (tx) => ({ state: (await loadBatch(tx, tenantId, batchId)).state }));
}

/** A failed batch resumes from the last stage that committed (recorded in its log). */
function lastGoodState(b: BatchRow): RtaBatchState {
  const done = (b.stageLog ?? []).map((e) => e.stage);
  if (done.includes("reconcile")) return "reconciled";
  if (done.includes("match")) return "matched";
  if (done.includes("parse")) return "validated";
  if (done.includes("identify")) return "identified";
  return "uploaded";
}

async function stage(
  tenantId: string, batchId: string, me: string, name: StageName, from: RtaBatchState, to: RtaBatchState, opts: RunOptions,
  work: (tx: Tx, b: BatchRow) => Promise<{ final?: "exception" | "ready_to_commit"; error?: string; counts?: Record<string, number> }>,
) {
  await withTenant(tenantId, async (tx) => {
    const b = await loadBatch(tx, tenantId, batchId, true);
    if (FINAL.has(b.state) || reached(b.state, to)) return; // already done on an earlier attempt
    if (b.state !== from) throw new StagingStageError(name, `batch is in state ${b.state}, expected ${from}`);
    if (b.leaseOwner !== me) throw new StagingStageError(name, "lease lost to another worker");
    const t0 = Date.now();
    const r = await work(tx, b);
    if (opts.failInsideStage === name) throw new StagingStageError(name, `injected failure inside stage ${name}`);
    const finalState = r.final ?? to;
    await tx.update(rtaStagingBatches).set({
      state: finalState,
      error: r.error ?? null,
      ...(r.counts ? { counts: r.counts } : {}),
      ...(r.final ? { completedAt: new Date(), leaseOwner: null, leaseUntil: null } : { leaseUntil: new Date(Date.now() + STAGING_LEASE_MS) }),
      stageLog: sql`${rtaStagingBatches.stageLog} || ${logEntry(name, b.attempt, Date.now() - t0)}::jsonb`,
      updatedAt: new Date(),
    }).where(and(eq(rtaStagingBatches.tenantId, tenantId), eq(rtaStagingBatches.id, batchId)));
  });
}

function rowValues(tenantId: string, batchId: string, r: NormRow): typeof rtaStagingRows.$inferInsert {
  return {
    tenantId, batchId, rowNo: r.rowNo, rowHash: r.rowHash, recordKind: r.recordKind,
    state: r.valid ? "validated" : "invalid",
    rtaClass: r.cls?.rtaClass ?? null, classConfidence: r.cls?.confidence ?? null,
    registrarTxnNo: r.registrarTxnNo, economicKey: r.economicKey,
    amcCode: r.amcCode, folioNumber: r.folioNumber, schemeCode: r.schemeCode, isin: r.isin,
    tradeDate: r.tradeDate, asOfDate: r.asOfDate,
    units: r.units?.text ?? null, amount: r.amount?.text ?? null, nav: r.nav?.text ?? null, price: r.price?.text ?? null,
    loadAmount: r.loadAmount?.text ?? null, stt: r.stt?.text ?? null, stampDuty: r.stampDuty?.text ?? null,
    holdingValue: r.holdingValue?.text ?? null,
    panToken: r.panToken, guardianPanToken: r.guardianPanToken,
    attrs: r.attrs,
    validation: { issues: r.issues, src: r.src },
    exceptionCode: r.valid ? null : "row_invalid",
    reason: r.valid ? null : r.issues.map((i) => `${i.field}: ${i.reason}`).join("; ").slice(0, 1000),
  };
}

// ── Matching ─────────────────────────────────────────────────────────────────

type Match = {
  rowNo: number; state: "matched" | "unmatched" | "ambiguous"; investorId: string | null; folioId: string | null;
  rule: string; exception: string | null; reason: string | null; proposal: Record<string, unknown> | null;
};

/**
 * Who owns each row's folio — lib/rta/owner.ts (the owner decisions of
 * 2026-10-08), read-only. The folio on record (registrar + AMC + folio) comes
 * first; then the legal owner's OWN PAN; a minor without a PAN gets a
 * provisional folio-keyed owner with the guardian as a link — the guardian's
 * PAN never makes the guardian the owner. Ownership is never changed: a
 * conflict is an exception for review (automatic reassignment stays off).
 */
async function matchRows(tx: Tx, tenantId: string, rows: NormRow[], rta: string): Promise<Match[]> {
  const dir = new InvestorDirectory(tx, tenantId);
  const live = rows.filter((r) => r.valid);
  await dir.preload({ pans: live.flatMap((r) => [r.owner?.ownerPan, r.owner?.guardianPan]), folios: live.map((r) => r.folioNumber) });
  const owners = new InvestorOwnerDirectory(dir);
  const out: Match[] = [];
  for (const r of live) {
    const base = { rowNo: r.rowNo, investorId: null, folioId: null, exception: null, reason: null, proposal: null };
    if (!r.folioNumber || !r.owner) { out.push({ ...base, state: "unmatched", rule: "no_folio" }); continue; }
    const d = await resolveOwner(owners, { rta, amcCode: r.amcCode, folioNumber: r.folioNumber }, r.owner);
    switch (d.kind) {
      case "existing_folio_owner":
        out.push({ ...base, state: "matched", investorId: d.investorId, folioId: d.folioId, rule: `existing_folio_owner:${d.rule}` });
        break;
      case "owner_by_pan":
        out.push({ ...base, state: "matched", investorId: d.investorId, rule: `owner_by_pan:${d.rule}`, proposal: { newFolio: true } });
        break;
      case "new_owner_by_pan":
        out.push({ ...base, state: "unmatched", rule: `new_owner_by_pan:${d.ownerType}`, proposal: { newOwner: d.ownerType } });
        break;
      case "new_provisional_owner":
        out.push({ ...base, state: "unmatched", rule: `new_provisional_owner:${d.rule}`,
          proposal: { newOwner: d.ownerType, provisional: true, guardianInvestorId: d.guardianInvestorId } });
        break;
      case "exception":
        out.push({ ...base, state: "ambiguous", investorId: d.investorId ?? null, rule: `exception:${d.code}`, exception: d.code, reason: d.reason });
        break;
    }
  }
  return out;
}

// ── Group + reconcile ────────────────────────────────────────────────────────

type DbRow = { id: string; row_no: number; state: string; match_investor_id: string | null; match_folio_id: string | null; match_rule: string | null; exception_code: string | null; reason: string | null };

async function reconcile(tx: Tx, tenantId: string, b: BatchRow, layout: Layout, norm: NormRow[]) {
  const dbRows = (await tx.execute(sql`
    SELECT id, row_no, state, match_investor_id, match_folio_id, match_rule, exception_code, reason
      FROM rta_staging_rows WHERE tenant_id = ${tenantId}::uuid AND batch_id = ${b.id}::uuid ORDER BY row_no
  `)).rows as DbRow[];
  const byNo = new Map(dbRows.map((r) => [Number(r.row_no), { ...r, row_no: Number(r.row_no), id: String(r.id) }]));

  // Final per-row state, decided below.
  const final = new Map<number, { state: string; exception: string | null; reason: string | null; econ?: string; rtaClass?: string | null }>();
  for (const r of norm) {
    const db = byNo.get(r.rowNo)!;
    if (!r.valid) final.set(r.rowNo, { state: "invalid", exception: "row_invalid", reason: db.reason });
  }

  const econs: Array<EconOut & { finalStatus: "complete" | "quarantined" | "duplicate" | "restated" | "conflict"; duplicateOf: string | null; investorId: string | null; folioId: string | null; matchRule: string | null; action: string; legacyId: string | null }> = [];

  if (layout.recordKind === "transaction") {
    const grouped = groupTransactions(tenantId, norm, layout.rta);

    // Identity per transaction: every row must agree.
    for (const g of grouped) {
      const ms = g.rowNos.map((n) => byNo.get(n)!);
      let status: EconOut["status"] = g.status, exception = g.exception, reason = g.reason;
      const ambiguous = ms.find((m) => m.state === "ambiguous");
      const investors = new Set(ms.map((m) => m.match_investor_id ?? "none"));
      if (status === "complete" && ambiguous) { status = "quarantined"; exception = ambiguous.exception_code ?? "identity_ambiguous"; reason = ambiguous.reason; }
      else if (status === "complete" && investors.size > 1) { status = "quarantined"; exception = "identity_split"; reason = "rows of one transaction resolve to different clients — held"; }
      econs.push({
        ...g, status, exception, reason, finalStatus: status, duplicateOf: null,
        investorId: ms[0].match_investor_id ? String(ms[0].match_investor_id) : null,
        folioId: ms[0].match_folio_id ? String(ms[0].match_folio_id) : null,
        matchRule: ms[0].match_rule, action: "none", legacyId: null,
      });
    }

    // Earlier batches: duplicate / restated / conflict.
    const keys = econs.map((e) => e.identityKey);
    const prior = new Map<string, { id: string; invariant_hash: string; lot_signature: string }>();
    for (const part of chunks(keys, 1000)) {
      const rows = (await tx.execute(sql`
        SELECT DISTINCT ON (e.identity_key) e.id, e.identity_key, e.invariant_hash, e.lot_signature
          FROM rta_staging_economic_txns e
          JOIN rta_staging_batches pb ON pb.tenant_id = e.tenant_id AND pb.id = e.batch_id
         WHERE e.tenant_id = ${tenantId}::uuid
           AND e.identity_key IN (${sql.join(part.map((k) => sql`${k}`), sql`, `)})
           AND e.batch_id <> ${b.id}::uuid
           AND (${b.rerunOfBatchId}::uuid IS NULL OR e.batch_id <> ${b.rerunOfBatchId}::uuid)
           AND e.status IN ('complete', 'quarantined')
           AND pb.state IN ('ready_to_commit', 'exception')
           AND NOT EXISTS (SELECT 1 FROM rta_staging_batches s
                            WHERE s.tenant_id = pb.tenant_id AND s.rerun_of_batch_id = pb.id AND s.id <> ${b.id}::uuid
                              AND s.state IN ('ready_to_commit', 'exception'))
         ORDER BY e.identity_key, e.created_at, e.id
      `)).rows as Array<{ id: string; identity_key: string; invariant_hash: string; lot_signature: string }>;
      for (const r of rows) prior.set(r.identity_key, { id: String(r.id), invariant_hash: r.invariant_hash, lot_signature: r.lot_signature });
    }
    for (const e of econs) {
      const p = prior.get(e.identityKey);
      if (!p) continue;
      e.duplicateOf = p.id;
      if (p.invariant_hash !== e.invariantHash) {
        e.finalStatus = "conflict"; e.exception = "identity_conflict";
        e.reason = "an earlier file reported this registrar transaction number for a different folio, scheme, date or type — neither is changed; held for review";
      } else if (p.lot_signature !== e.lotSignature) {
        e.finalStatus = "restated"; e.exception = "restated_by_registrar";
        e.reason = "an earlier file reported this transaction with different lots or figures — a correction by the registrar? Held for review; the earlier record is not changed";
      } else {
        e.finalStatus = "duplicate"; e.exception = null;
        e.reason = "already staged from an earlier file — not counted again";
      }
    }

    // Read-only comparison with what the existing importer holds.
    const complete = econs.filter((e) => e.finalStatus === "complete");
    const legacy = new Map<string, Array<{ id: string; amc_code: string | null; folio_number: string | null; scheme_code: string | null; d: string | null; amount: string | null; units: string | null; direction: string }>>();
    for (const part of chunks(complete.map((e) => e.registrarTxnNo), 1000)) {
      if (!part.length) continue;
      const rows = (await tx.execute(sql`
        SELECT id, order_id, amc_code, folio_number, scheme_code, order_date::text AS d, amount::text AS amount, units::text AS units, direction
          FROM transactions WHERE tenant_id = ${tenantId}::uuid AND order_id IN (${sql.join(part.map((k) => sql`${k}`), sql`, `)})
      `)).rows as Array<{ id: string; order_id: string; amc_code: string | null; folio_number: string | null; scheme_code: string | null; d: string | null; amount: string | null; units: string | null; direction: string }>;
      for (const r of rows) legacy.set(r.order_id, [...(legacy.get(r.order_id) ?? []), { ...r, id: String(r.id) }]);
    }
    for (const e of complete) {
      const found = (legacy.get(e.registrarTxnNo) ?? []).filter((t) => !t.amc_code || t.amc_code === e.amcCode);
      if (found.length) {
        const t = found[0];
        const same = found.length === 1 && t.folio_number === e.folioNumber && t.d === e.tradeDate && t.direction === e.direction
          && Math.abs(Math.abs(Number(t.amount)) - Math.abs(Number(e.reportedAmount))) <= 0.005
          && Math.abs(Math.abs(Number(t.units)) - Math.abs(Number(e.reportedUnits))) <= 0.0005;
        e.action = same ? "adopt_legacy" : "legacy_conflict";
        e.legacyId = t.id;
      } else {
        e.action = e.investorId ? "post_new" : "unmatched";
      }
    }

    // Write transactions, lots, row dispositions.
    const ids = new Map<string, string>();
    for (const part of chunks(econs)) {
      const inserted = await tx.insert(rtaStagingEconomicTxns).values(part.map((e) => ({
        tenantId, batchId: b.id, identityScheme: layout.identityScheme!, identityKey: e.identityKey, rta: layout.rta,
        amcCode: e.amcCode, folioNumber: e.folioNumber, schemeCode: e.schemeCode, registrarTxnNo: e.registrarTxnNo,
        tradeDate: e.tradeDate, rtaClass: e.rtaClass, classConfidence: e.classConfidence, direction: e.direction,
        status: e.finalStatus, reason: e.exception ? `${e.exception}: ${e.reason}` : e.reason,
        rowCount: e.rowNos.length, lotCount: e.lots.length,
        reportedUnits: e.reportedUnits, reportedAmount: e.reportedAmount, reportedNav: e.reportedNav,
        reportedExitLoad: e.reportedExitLoad, reportedStt: e.reportedStt, reportedStampDuty: e.reportedStampDuty,
        derivedGrossAmount: e.derivedGrossAmount, arithmeticDelta: e.arithmeticDelta, arithmeticTolerance: e.arithmeticTolerance,
        invariantHash: e.invariantHash, lotSignature: e.lotSignature, duplicateOfId: e.duplicateOf,
        matchInvestorId: e.investorId, matchFolioId: e.folioId, matchRule: e.matchRule,
        proposedAction: e.action as "post_new", legacyTransactionId: e.legacyId,
      }))).onConflictDoNothing().returning({ id: rtaStagingEconomicTxns.id, key: rtaStagingEconomicTxns.identityKey });
      for (const r of inserted) ids.set(r.key, r.id);
    }
    const lotRows = econs.flatMap((e) => e.lots.map((l) => ({
      tenantId, economicTxnId: ids.get(e.identityKey)!, rowId: byNo.get(l.rowNo)!.id,
      registrarLotId: l.registrarLotId, lotPart: l.lotPart, purchaseTxnNo: l.purchaseTxnNo, purchaseDate: l.purchaseDate,
      purchaseUnits: l.purchaseUnits, purchaseAmount: l.purchaseAmount, units: l.units, amount: l.amount,
      price: l.price, nav: l.nav, loadAmount: l.loadAmount, stt: l.stt,
    })));
    for (const part of chunks(lotRows)) await tx.insert(rtaStagingLots).values(part).onConflictDoNothing();

    for (const e of econs) {
      const multi = e.rowNos.length > 1;
      for (const n of e.rowNos) {
        if (final.has(n)) { final.get(n)!.econ = ids.get(e.identityKey); continue; } // an invalid row keeps its own reason
        const s = e.finalStatus === "complete" ? (multi ? "staged_as_part" : "staged")
          : e.finalStatus === "duplicate" ? "duplicate" : "quarantined";
        final.set(n, { state: s, exception: s === "quarantined" ? e.exception : null, reason: e.reason, econ: ids.get(e.identityKey), rtaClass: e.rtaClass });
      }
    }
  } else {
    // Holdings / masters: no economic transaction. Repeated positions are held;
    // a row already staged from an earlier file (same keyed row hash) is a duplicate.
    const posKey = (r: NormRow) => `${r.amcCode}|${r.folioNumber}|${r.schemeCode}|${r.asOfDate}`;
    const seen = new Map<string, number>();
    for (const r of norm) if (r.valid) seen.set(posKey(r), (seen.get(posKey(r)) ?? 0) + 1);
    const hashes = norm.filter((r) => r.valid).map((r) => r.rowHash);
    const priorHashes = new Set<string>();
    for (const part of chunks(hashes, 1000)) {
      if (!part.length) continue;
      const rows = (await tx.execute(sql`
        SELECT DISTINCT r.row_hash FROM rta_staging_rows r
          JOIN rta_staging_batches pb ON pb.tenant_id = r.tenant_id AND pb.id = r.batch_id
         WHERE r.tenant_id = ${tenantId}::uuid AND r.batch_id <> ${b.id}::uuid
           AND (${b.rerunOfBatchId}::uuid IS NULL OR r.batch_id <> ${b.rerunOfBatchId}::uuid)
           AND pb.state IN ('ready_to_commit', 'exception') AND r.state = 'staged'
           AND r.row_hash IN (${sql.join(part.map((h) => sql`${h}`), sql`, `)})
      `)).rows as Array<{ row_hash: string }>;
      rows.forEach((r) => priorHashes.add(r.row_hash));
    }
    for (const r of norm) {
      if (!r.valid) continue;
      const m = byNo.get(r.rowNo)!;
      if (layout.recordKind === "holding" && (seen.get(posKey(r)) ?? 0) > 1) {
        final.set(r.rowNo, { state: "quarantined", exception: "holding_position_repeated", reason: "this folio and scheme appear more than once in the statement — held" });
      } else if (m.state === "ambiguous") {
        final.set(r.rowNo, { state: "quarantined", exception: m.exception_code, reason: m.reason });
      } else if (priorHashes.has(r.rowHash)) {
        final.set(r.rowNo, { state: "duplicate", exception: null, reason: "the same row was staged from an earlier file" });
      } else {
        final.set(r.rowNo, { state: "staged", exception: null, reason: null });
      }
    }
  }

  // Persist row dispositions.
  const finals = [...final.entries()];
  for (const part of chunks(finals)) {
    const values = sql.join(part.map(([n, f]) => sql`(${n}::int, ${f.state}, ${f.exception}, ${f.reason}, ${f.econ ?? null}::uuid)`), sql`, `);
    await tx.execute(sql`
      UPDATE rta_staging_rows r
         SET state = v.state, exception_code = v.exc, reason = v.reason, economic_txn_id = v.econ, disposition = v.state, updated_at = now()
        FROM (VALUES ${values}) AS v(row_no, state, exc, reason, econ)
       WHERE r.tenant_id = ${tenantId}::uuid AND r.batch_id = ${b.id}::uuid AND r.row_no = v.row_no
    `);
  }

  // Checks.
  const rowStates = new Map(finals.map(([n, f]) => [n, f.state]));
  const checks: CheckOut[] = await buildChecks(tx, { tenantId, batch: b, layout, norm, econs, rowStates, matches: byNo });
  for (const part of chunks(checks)) {
    await tx.insert(rtaStagingChecks).values(part.map((c) => ({
      tenantId, batchId: b.id, checkCode: c.code, scope: c.scope, scopeRef: c.scopeRef ?? "", status: c.status,
      expected: c.expected ?? null, actual: c.actual ?? null, tolerance: c.tolerance ?? null, detail: c.detail ?? {},
    }))).onConflictDoNothing();
  }

  const counts: Record<string, number> = { rows: norm.length };
  for (const [, s] of rowStates) counts[`rows.${s}`] = (counts[`rows.${s}`] ?? 0) + 1;
  for (const e of econs) counts[`econ.${e.finalStatus}`] = (counts[`econ.${e.finalStatus}`] ?? 0) + 1;
  counts["econ.total"] = econs.length;
  counts["econ.multi_lot"] = econs.filter((e) => e.multiLot).length;
  counts["lots"] = econs.reduce((s, e) => s + e.lots.length, 0);
  counts["lots.in_multi_lot_groups"] = econs.filter((e) => e.multiLot).reduce((s, e) => s + e.lots.length, 0);
  for (const c of checks) counts[`checks.${c.status}`] = (counts[`checks.${c.status}`] ?? 0) + 1;

  return { anyFail: checks.some((c) => c.status === "fail" && c.blocking !== false), counts };
}

export { type EconOut };
