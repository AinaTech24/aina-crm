/**
 * Phase 3G — recovering from an incorrect posting batch, on a real Postgres
 * (a disposable firm in the test database). A feature flag stops future
 * writes; this proves past writes can be undone, audited, and restored:
 *
 *   halt → reverse (two people) → every CRM row the batch wrote is archived
 *   and gone, matched rows untouched, ledger consistent → re-import of the
 *   corrected file posts again → or undo → the rows come back exactly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MFSD201_HEADER, csvOf, P } from "./rta-real-layouts";

const TEST_DB = process.env.TEST_DATABASE_URL;
const kfin = (txn: string, v: Record<string, string> = {}) => ({
  "Fund": "117", "Folio Number": "97500001", "Product Code": "117EQGR", "Fund Description": "Example Equity Fund - Growth", "Transaction Head": "P",
  "Transaction Description": "Systematic Investment", "Transaction Type": "SIN", "Transaction Status": "Y", "Transaction Date": "15/4/2026",
  "Nav": "50.0000", "Price": "50.0000", Units: "20.000", Amount: "1000.00", "Transaction Number": txn, PAN1: P.adult, ...v,
});

describe.skipIf(!TEST_DB)("recovery of an incorrect posting batch (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let vf: typeof import("@/lib/rta/posting/validate-first");
  let R: typeof import("@/lib/rta/posting/reversal");
  let C: typeof import("@/lib/rta/posting/controls");
  const t = randomUUID();
  const ops = { a: randomUUID(), b: randomUUID() };
  const inv = randomUUID();
  const q = async <T = any>(s: ReturnType<typeof import("drizzle-orm").sql>) => withTenant(t, async (tx) => (await tx.execute(s)).rows as T[]);
  const run = async (name: string, buf: Buffer) => {
    const id = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key, status)
      VALUES (${id}::uuid, ${t}::uuid, 'kfintech', 'daily_transaction_feed', '2026-10-08', '2026-10-08', ${name}, ${"test/" + name}, 'parsing')`));
    return vf.validateFirstImport({ tenantId: t, importId: id, fileName: name, fileRef: `test:${name}`, buf, asOf: "2026-10-08" });
  };
  const fingerprint = async () => (await q(sql`SELECT md5(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id)) AS h, count(*)::int AS n FROM (
      SELECT t.* FROM transactions t WHERE t.tenant_id = ${t}::uuid) x`))[0];
  // Set by a registrar master in the setup (newer than anything the batch posts).
  const lastTx = async () => new Date((await q(sql`SELECT last_transaction_at AS d FROM investors WHERE id = ${inv}::uuid`))[0].d).toISOString().slice(0, 10);
  const sipRej = async () => (await q(sql`SELECT count(*)::int AS n FROM sip_rejections WHERE tenant_id = ${t}::uuid`))[0].n;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    process.env.ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    (process.env as Record<string, string>).NODE_ENV = "test";
    process.env.RTA_POSTING_MODE = "development";
    process.env.RTA_POSTING_DATABASE = new URL(TEST_DB!).pathname.slice(1);
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    vf = await import("@/lib/rta/posting/validate-first");
    R = await import("@/lib/rta/posting/reversal");
    C = await import("@/lib/rta/posting/controls");
    await C.setPostingHalt({ scope: "global", halted: false, reason: "development test database: posting released", changedBy: ops.a, approvedBy: ops.b });
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'Recovery', 'Recovery', ${"ARN-RC" + t.slice(0, 6)})`);
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, last_transaction_at) VALUES (${inv}::uuid, ${t}::uuid, ${P.adult}, 'Recovery Adult', '2026-09-15T00:00:00Z')`);
      await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, amc_code, amc_name, folio_number, rta) VALUES (${t}::uuid, ${inv}::uuid, '117', 'AMC 117', '97500001', 'kfintech')`);
      // A CRM transaction that predates the batch (the batch will only MATCH it).
      await tx.execute(sql`INSERT INTO transactions (tenant_id, investor_id, folio_number, amc_code, scheme_code, type, direction, amount, units, order_id, order_date, status)
        VALUES (${t}::uuid, ${inv}::uuid, '97500001', '117', '117EQGR', 'sip', 'inflow', 1000, 20, '975000', '2026-04-15', 'processed')`);
    });
  });

  afterAll(async () => {
    const tryRun = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    await tryRun(sql`ALTER TABLE rta_posting_reversals DISABLE TRIGGER rta_posting_reversals_append_only`);
    await tryRun(sql`DELETE FROM events_outbox WHERE tenant_id = ${t}::uuid`);
    for (const table of ["rta_posting_reversals", "rta_posted_transactions", "rta_sip_registrations", "sip_rejections", "sips", "transactions", "tasks", "rta_staging_lots", "rta_staging_checks", "rta_staging_rows"]) {
      await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    }
    await tryRun(sql`ALTER TABLE rta_posting_reversals ENABLE TRIGGER rta_posting_reversals_append_only`);
    await tryRun(sql`UPDATE rta_staging_economic_txns SET duplicate_of_id = NULL WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM rta_staging_economic_txns WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`UPDATE rta_staging_batches SET rerun_of_batch_id = NULL, same_file_as_batch_id = NULL WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM rta_staging_batches WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM rta_file_imports WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM rta_posting_controls WHERE scope = ${t}`);
    await tryRun(sql`DELETE FROM folios WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM investors WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM audit_log WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
  });

  let batchId = "";
  let before: any;
  let afterPost: any;

  it("a batch posts: two new transactions, a refused instalment (with its SIP Rejection), and a match to an existing row", async () => {
    before = await fingerprint();
    const r = await run("bad.csv", csvOf(MFSD201_HEADER, [kfin("975000"), kfin("975001"), kfin("975002"),
      kfin("975003", { "Transaction Type": "SIND", "Transaction Description": "Pre rejection", Units: "0.000", Amount: "2000.00", Price: "0", Remarks: "Required amount not available" })]));
    expect(r.posting).toMatchObject({ counts: { matched_existing: 1, posted: 2, rejected_recorded: 1 } });
    batchId = r.batchId;
    afterPost = await fingerprint();
    expect(afterPost.n).toBe(before.n + 3);
    expect(await sipRej()).toBe(1);
  });

  it("reversal is refused while posting can run, and without two people", async () => {
    await expect(R.reversePostingBatch(t, batchId, { requestedBy: ops.a, approvedBy: ops.b, reason: "wrong file posted for the firm" })).rejects.toThrow(/halt posting for this firm first/);
    await C.setPostingHalt({ scope: t, halted: true, reason: "incident: wrong file posted", changedBy: ops.a });
    await expect(R.reversePostingBatch(t, batchId, { requestedBy: ops.a, approvedBy: ops.a, reason: "wrong file posted for the firm" })).rejects.toThrow(/DIFFERENT approver/);
  });

  it("a dry run reports what would be removed and changes nothing", async () => {
    const d = await R.reversePostingBatch(t, batchId, { requestedBy: ops.a, approvedBy: ops.b, reason: "wrong file posted for the firm", dryRun: true });
    expect(d).toMatchObject({ dryRun: true, counts: { transactions: 3, sipRejections: 1, ledger: 4, matchedExistingUnlinked: 1 } });
    expect(await fingerprint()).toEqual(afterPost);
  });

  let reversalId = "";
  it("reversal removes exactly what the batch wrote, keeps the pre-existing row, archives everything, and reconciles", async () => {
    const r = await R.reversePostingBatch(t, batchId, { requestedBy: ops.a, approvedBy: ops.b, reason: "wrong file posted for the firm" });
    reversalId = r.reversalId!;
    expect(await fingerprint()).toEqual(before); // back to the CRM as it was before the batch
    expect(await sipRej()).toBe(0);
    expect(await lastTx()).toBe("2026-09-15"); // a master's date is not the batch's to lower
    const [arch] = await q(sql`SELECT jsonb_array_length(archived->'transactions') AS t, jsonb_array_length(archived->'ledger') AS l FROM rta_posting_reversals WHERE id = ${reversalId}::uuid`);
    expect(arch).toEqual({ t: 3, l: 4 });
    expect(await R.reconcilePosting(t)).toEqual({ ledgerWithoutTransaction: 0, validateFirstTransactionWithoutLedger: 0, postedOutcomeWithoutLedger: 0, ledgerIdentityTwice: 0, rejectedWithUnits: 0 });
    const [b] = await q(sql`SELECT posting_state FROM rta_staging_batches WHERE id = ${batchId}::uuid`);
    expect(b.posting_state).toBe("reversed");
    const audit = await q(sql`SELECT action FROM audit_log WHERE tenant_id = ${t}::uuid AND action = 'rta.posting.reverse'`);
    expect(audit).toHaveLength(1);
    await expect(withTenant(t, (tx) => tx.execute(sql`DELETE FROM rta_posting_reversals WHERE id = ${reversalId}::uuid`))).rejects.toThrow();
  });

  it("undo restores every row exactly as it was; reconciliation is clean again", async () => {
    await R.undoReversal(t, reversalId, { by: ops.b, reason: "reversal was a mistake — restoring" });
    expect(await fingerprint()).toEqual(afterPost);
    expect(await sipRej()).toBe(1);
    expect(await lastTx()).toBe("2026-09-15");
    expect(await R.reconcilePosting(t)).toEqual({ ledgerWithoutTransaction: 0, validateFirstTransactionWithoutLedger: 0, postedOutcomeWithoutLedger: 0, ledgerIdentityTwice: 0, rejectedWithUnits: 0 });
    await expect(R.undoReversal(t, reversalId, { by: ops.b, reason: "second undo attempt here" })).rejects.toThrow(/already been undone/);
  });

  it("reverse again, then the corrected file posts afresh once posting is released", async () => {
    await R.reversePostingBatch(t, batchId, { requestedBy: ops.a, approvedBy: ops.b, reason: "wrong file posted — second time, for real" });
    await C.setPostingHalt({ scope: t, halted: false, reason: "incident closed — corrected file to follow", changedBy: ops.a, approvedBy: ops.b });
    const r = await run("corrected.csv", csvOf(MFSD201_HEADER, [kfin("975001")]));
    expect(r.posting).toMatchObject({ counts: { posted: 1 } }); // the reversed transaction posts again, once
    // A file that restates a reversed registrar number with DIFFERENT figures is not trusted silently: held for review.
    const restated = await run("restated.csv", csvOf(MFSD201_HEADER, [kfin("975002", { Amount: "1500.00", Units: "30.000" })]));
    expect(restated.posting).toMatchObject({ counts: { quarantined: 1 } });
    expect(await R.reconcilePosting(t)).toMatchObject({ ledgerWithoutTransaction: 0, validateFirstTransactionWithoutLedger: 0 });
  });

  it("a batch later work depends on is NOT reversed automatically; the reviewed order (newest first) works", async () => {
    // Batch A posts two transactions; batch B (an overlapping re-delivery) records one of them as already posted.
    const a = await run("depA.csv", csvOf(MFSD201_HEADER, [kfin("975101"), kfin("975102")]));
    expect(a.posting).toMatchObject({ counts: { posted: 2 } });
    const b = await run("depB.csv", csvOf(MFSD201_HEADER, [kfin("975102"), kfin("975103")]));
    expect(b.posting).toMatchObject({ counts: { already_posted: 1, posted: 1 } });
    await C.setPostingHalt({ scope: t, halted: true, reason: "incident: dependency drill", changedBy: ops.a });
    const fp = await fingerprint();
    const dry = await R.reversePostingBatch(t, a.batchId, { requestedBy: ops.a, approvedBy: ops.b, reason: "reverse batch A of the drill", dryRun: true });
    expect(dry).toMatchObject({ blocked: true, dependencies: { laterBatchClaims: 1, businessEntryMatches: 0, outboxEvents: 0, workedSipRejections: 0 } });
    await expect(R.reversePostingBatch(t, a.batchId, { requestedBy: ops.a, approvedBy: ops.b, reason: "reverse batch A of the drill" })).rejects.toThrow(/automatic reversal refused — later work depends on this batch \(laterBatchClaims 1\)/);
    expect(await fingerprint()).toEqual(fp); // refused: nothing changed
    // Reviewed order: B first (its own posting AND its "already posted" claim are withdrawn), then A.
    const rb = await R.reversePostingBatch(t, b.batchId, { requestedBy: ops.a, approvedBy: ops.b, reason: "reverse batch B first, newest first" });
    expect(rb.counts).toMatchObject({ transactions: 1, claimsWithdrawn: 1 });
    const ra = await R.reversePostingBatch(t, a.batchId, { requestedBy: ops.a, approvedBy: ops.b, reason: "then reverse batch A of the drill" });
    expect(ra.counts).toMatchObject({ transactions: 2 });
    expect(await R.reconcilePosting(t)).toEqual({ ledgerWithoutTransaction: 0, validateFirstTransactionWithoutLedger: 0, postedOutcomeWithoutLedger: 0, ledgerIdentityTwice: 0, rejectedWithUnits: 0 });
    // Undo B restores its claim exactly.
    const [rev] = await q(sql`SELECT id::text AS id FROM rta_posting_reversals WHERE tenant_id = ${t}::uuid AND batch_id = ${b.batchId}::uuid`);
    await R.undoReversal(t, ra.reversalId!, { by: ops.b, reason: "undo A: drill restores everything" });
    await R.undoReversal(t, rev.id, { by: ops.b, reason: "undo B: drill restores everything" });
    const [claim] = await q(sql`SELECT posting_outcome FROM rta_staging_economic_txns WHERE tenant_id = ${t}::uuid AND batch_id = ${b.batchId}::uuid AND registrar_txn_no = '975102'`);
    expect(claim.posting_outcome).toBe("already_posted");
    expect(await fingerprint()).toEqual(fp);
  });

  it("emitted workflow events and worked SIP rejections block an automatic reversal", async () => {
    await C.setPostingHalt({ scope: t, halted: false, reason: "dependency drill: posting released again", changedBy: ops.a, approvedBy: ops.b });
    const c = await run("depC.csv", csvOf(MFSD201_HEADER, [kfin("975201"),
      kfin("975202", { "Transaction Type": "SIND", "Transaction Description": "Pre rejection", Units: "0.000", Amount: "2000.00", Price: "0", Remarks: "Required amount not available" })]));
    expect(c.posting).toMatchObject({ counts: { posted: 1, rejected_recorded: 1 } });
    const [tx1] = await q(sql`SELECT id::text AS id, investor_id::text AS inv FROM transactions WHERE tenant_id = ${t}::uuid AND order_id = '975201'`);
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO events_outbox (tenant_id, kind, entity_type, entity_id, after, meta)
      VALUES (${t}::uuid, 'transaction.redemption', 'investor', ${tx1.inv}::uuid, '{}'::jsonb, ${JSON.stringify({ txId: tx1.id })}::jsonb)`));
    await withTenant(t, (tx) => tx.execute(sql`UPDATE sip_rejections SET recovery_status = 'contacted', updated_at = now() + interval '1 minute' WHERE tenant_id = ${t}::uuid`));
    await C.setPostingHalt({ scope: t, halted: true, reason: "incident: dependency drill, second batch", changedBy: ops.a });
    const dry = await R.reversePostingBatch(t, c.batchId, { requestedBy: ops.a, approvedBy: ops.b, reason: "reverse batch C of the drill", dryRun: true });
    expect(dry).toMatchObject({ blocked: true, dependencies: { outboxEvents: 1, workedSipRejections: 1 } });
    await withTenant(t, (tx) => tx.execute(sql`DELETE FROM events_outbox WHERE tenant_id = ${t}::uuid`));
  });

  it("the nightly reconciliation raises an alert (monitor + audit) when the ledger and the CRM disagree", async () => {
    const M = await import("@/lib/rta/posting/monitor");
    expect((await M.reconcilePostingFirms()).find((x) => x.tenantId === t)).toMatchObject({ ok: true });
    // Damage the ledger behind the CRM's back (as a stray script would).
    const [row] = await q(sql`SELECT to_jsonb(p) AS j, p.id::text AS id FROM rta_posted_transactions p WHERE p.tenant_id = ${t}::uuid AND p.kind = 'posted_new' LIMIT 1`);
    await withSystem((tx) => tx.execute(sql`DELETE FROM rta_posted_transactions WHERE id = ${row.id}::uuid`));
    const r = (await M.reconcilePostingFirms()).find((x) => x.tenantId === t)!;
    expect(r).toMatchObject({ ok: false, counts: { validateFirstTransactionWithoutLedger: 1 } });
    expect(await q(sql`SELECT action FROM audit_log WHERE tenant_id = ${t}::uuid AND action = 'rta.posting.reconcile_alert'`)).toHaveLength(1);
    await withSystem((tx) => tx.execute(sql`INSERT INTO rta_posted_transactions SELECT * FROM jsonb_populate_record(NULL::rta_posted_transactions, ${JSON.stringify(row.j)}::jsonb)`));
    expect((await M.reconcilePostingFirms()).find((x) => x.tenantId === t)).toMatchObject({ ok: true });
  });

  it("a master / holdings batch is never reversed by this procedure", async () => {
    const [m] = await withSystem(async (tx) => (await tx.execute(sql`
      INSERT INTO rta_staging_batches (tenant_id, mode, rta, report_code, record_kind, file_name, file_ref, file_checksum, file_size_bytes, parser_version, state)
      VALUES (${t}::uuid, 'validate_first', 'kfintech', 'MFSD211', 'master', 'm.csv', 'test:m.csv', ${"x" + t}, 1, 'test', 'ready_to_commit') RETURNING id::text AS id`)).rows as any[]);
    await expect(R.reversePostingBatch(t, m.id, { requestedBy: ops.a, approvedBy: ops.b, reason: "try to reverse a master batch" })).rejects.toThrow(/master batch is not reversed here/);
  });
});
