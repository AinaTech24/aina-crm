/**
 * RTA infrastructure integration check (Phase 3G) — REAL services, SYNTHETIC data.
 *
 * Unlike the vitest suites (which call the import functions), this drives the
 * running system end to end: the Next.js server's HTTP routes and a real
 * Chromium for the upload dialog, presigned PUTs into an S3-compatible store,
 * BullMQ on a real Redis, and SEPARATE worker processes that it kills, starves
 * and restarts. Every check prints PASS / FAIL; the exit code is the failures.
 *
 * Refuses to run unless every service URL is on this machine. Needs:
 *   DATABASE_URL (app role) and ADMIN_DATABASE_URL (superuser) — a disposable DB
 *   REDIS_URL, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE=1
 *   BASE_URL — a `next dev` server started with the same env
 *   RTA_POSTING_MODE=controlled, RTA_PIPELINE_MODE=validate_first, RTA_POSTING_DATABASE
 *   NEXTAUTH_SECRET, ENCRYPTION_KEY
 *
 *   npx tsx scripts/rta-infra-check.ts
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import * as XLSX from "xlsx";
import { MFSD201_HEADER, MFSD211_HEADER, R2_HEADER, R9_HEADER, csvOf, xlsOf, serial } from "../tests/rta-real-layouts";

const env = process.env;
const LOCAL = /^(?:[a-z0-9+]+:\/\/)?(?:[^@/]*@)?(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i;
for (const k of ["DATABASE_URL", "ADMIN_DATABASE_URL", "REDIS_URL", "S3_ENDPOINT", "BASE_URL"]) {
  if (!env[k] || !LOCAL.test(env[k]!)) { console.error(`${k} must be set and point at this machine`); process.exit(2); }
}
const BASE = env.BASE_URL!.replace(/\/$/, "");
const WORK = mkdtempSync(join(tmpdir(), "rta-infra-"));
/**
 * Every check records its evidence (B-1 stabilisation, I-6): what was
 * exercised, the records expected and actually committed, the database change
 * it caused, and the reconciliation outcome where posting was involved. A check
 * that needs a posting never passes on zero records. The report is written to
 * INFRA_REPORT (default: the run's work directory) — counts only, no PAN.
 */
type Evidence = { exercised: string; expected?: unknown; actual?: unknown; dbChange?: unknown; reconcile?: unknown };
const results: Array<{ name: string; ok: boolean; detail: string; evidence?: Evidence }> = [];
const check = (name: string, ok: boolean, detail = "", evidence?: Evidence) => {
  results.push({ name, ok, detail, evidence });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Synthetic PANs (valid structure, invented): two firms, never a real person.
const PAN = { a1: "ZZZPA1111A", a2: "ZZZPB2222B", a3: "ZZZPC3333C", b1: "ZZZPD4444D" };

// Reference fixture (B-1 stabilisation, I-6). Since the Phase 3H scheme gate a
// transaction posts only on a VERIFIED scheme identity, so the run seeds a
// deterministic, clearly synthetic AMFI reference — never real reference data:
//   KFintech 117EQGR prints the fixture ISIN → resolved by ISIN, exactly as the pilot's codes are;
//   CAMS H / HFC prints none → two operators approve the AMC identity and the mapping.
const FX = {
  amc: "Infra Synthetic Mutual Fund (TEST FIXTURE)",
  kfinCode: "IF0001", kfinIsin: "INFIFA01AA11", kfinName: "Infra Synthetic Equity Fund - Regular Plan - Growth",
  camsCode: "IF0002", camsIsin: "INFIFB01BB22", camsName: "Infra Synthetic Flexi Cap Fund - Regular Plan - Growth",
};

const kfinRow = (txn: string, folio: string, pan: string, extra: Record<string, string> = {}) => ({
  "Fund": "117", "Folio Number": folio, "Product Code": "117EQGR", "Fund Description": FX.kfinName, ISIN: FX.kfinIsin, "Transaction Head": "P",
  "Transaction Description": "Systematic Investment", "Transaction Type": "SIN", "Transaction Status": "Y", "Transaction Date": "15/4/2026",
  "Nav": "50.0000", "Price": "50.0000", Units: "20.000", Amount: "1000.00", "Transaction Number": txn, PAN1: pan, ...extra,
});
const m211 = (folio: string, pan: string) => csvOf(MFSD211_HEADER, [{ Fund: "117", Folio: folio, "Product Code": "117EQGR", "PAN Number": pan, "Report Date": "18/5/2026", "Investor Name": "Synthetic Person", "Tax Status": "Individual" }]);
const r9Rows = (folio: string, pan: string) => [{ foliochk: folio, product: "HFC", sch_name: FX.camsName, amc_code: "H", rep_date: serial("2026-05-18"), clos_bal: "20.000", rupee_bal: "1000.00", pan_no: pan, inv_name: "Synthetic Person", tax_status: "Individual" }];

async function main() {
  const pg = await import("pg");
  const admin = new pg.default.Client({ connectionString: env.ADMIN_DATABASE_URL }); await admin.connect();
  const one = async (q: string, p: unknown[] = []) => (await admin.query(q, p)).rows[0];

  // ── Setup: two firms, an RM without import rights, operators, licences, activations ──
  const T1 = randomUUID(), T2 = randomUUID(), PF = randomUUID();
  const u = { o1: randomUUID(), o2: randomUUID(), rm1: randomUUID(), mk1: randomUUID(), op1: randomUUID(), op2: randomUUID() };
  await admin.query(`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES ($1,'Infra One','Infra One',$4),($2,'Infra Two','Infra Two',$5),($3,'Infra Ops','Infra Ops',$6)`,
    [T1, T2, PF, `ARN-IF1-${T1.slice(0, 6)}`, `ARN-IF2-${T2.slice(0, 6)}`, `ARN-IFP-${PF.slice(0, 6)}`]);
  const addUser = (id: string, t: string, roles: string[], n: string) => admin.query(`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES ($1,$2,$3,$4,$5,'active')`, [id, t, `${n}-${id.slice(0, 6)}@example.test`, n, roles]);
  await addUser(u.o1, T1, ["owner"], "Owner One"); await addUser(u.o2, T2, ["owner"], "Owner Two"); await addUser(u.rm1, T1, ["rm"], "RM One"); await addUser(u.mk1, T1, ["marketing"], "Marketing One");
  await addUser(u.op1, PF, ["platform_admin"], "Operator One"); await addUser(u.op2, PF, ["platform_admin"], "Operator Two");
  // Two-person starts (migration 0243) need each operator signed in with 2FA on: synthetic sessions, local database only.
  const sess = { op1: `infra-${randomUUID()}`, op2: `infra-${randomUUID()}` };
  await admin.query(`UPDATE users SET two_fa_enabled = true WHERE id = ANY($1::uuid[])`, [[u.op1, u.op2]]);
  for (const k of ["op1", "op2"] as const) await admin.query(`INSERT INTO user_sessions (tenant_id, user_id, session_id, auth_method, mfa_verified_at) VALUES ($1, $2, $3, 'password_totp', now())`, [PF, u[k], sess[k]]);
  const mods = JSON.stringify(["crm", "dashboards", "client_master", "transactions", "sip_tracker", "sip_rejection", "reports", "tasks"]);
  const pk = await one(`INSERT INTO packages (key, name, max_users, max_investors, enabled_modules) VALUES ($1, 'Infra', 50, 100000, $2::jsonb) RETURNING id`, [`infra-${T1.slice(0, 6)}`, mods]);
  for (const t of [T1, T2]) await admin.query(`INSERT INTO subscriptions (tenant_id, package_id, package_key, status) VALUES ($1, $2, $3, 'active')`, [t, pk.id, `infra-${T1.slice(0, 6)}`]);
  const C = await import("@/lib/rta/posting/controls");
  const AP = await import("@/lib/rta/posting/approvals");
  const twoPerson = async (input: import("@/lib/rta/posting/approvals").ControlRequestInput) => {
    const r = await AP.requestControlAction({ userId: u.op1, sid: sess.op1 }, input);
    return AP.approveControlAction({ userId: u.op2, sid: sess.op2 }, { requestId: r.id, payloadHash: r.payloadHash });
  };
  void C;
  await twoPerson({ action: "release", scope: "global", changeRef: "INFRA-3G", reason: "infrastructure check: posting released" });
  // The synthetic AMFI reference (see FX): one applied feed dated yesterday (IST), two schemes of one AMC.
  await admin.query(`INSERT INTO amfi_feed_imports (source, sha256, bytes, layout, feed_date, status, note)
    VALUES ('file', $1, 0, 'current8', (now() AT TIME ZONE 'Asia/Kolkata')::date - 1, 'applied', 'rta-infra-check synthetic fixture — not AMFI data')`, [`infra-fixture-${T1}`]);
  for (const [code, isin, name] of [[FX.kfinCode, FX.kfinIsin, FX.kfinName], [FX.camsCode, FX.camsIsin, FX.camsName]]) {
    await admin.query(`INSERT INTO scheme_nav (scheme_code, isin, isin_payout_growth, scheme_name, plan, option_name, amc_name, nav, nav_date, first_seen_feed, last_seen_feed)
      VALUES ($1, $2, $2, $3, 'Regular Plan', 'Growth', $4, 50, (now() AT TIME ZONE 'Asia/Kolkata')::date - 1, (now() AT TIME ZONE 'Asia/Kolkata')::date - 1, (now() AT TIME ZONE 'Asia/Kolkata')::date - 1)
      ON CONFLICT (scheme_code) DO NOTHING`, [code, isin, name, FX.amc]);
  }
  // CAMS prints no ISIN: the AMC identity and the scheme mapping are approved by two operators (the production route).
  await twoPerson({ action: "approve_amc_identity", rta: "cams", amcCode: "H", amfiAmc: FX.amc, role: "primary", note: "synthetic fixture: CAMS AMC H is the infra-check AMC", changeRef: "INFRA-3G", reason: "infrastructure check reference fixture" });
  await twoPerson({ action: "approve_scheme_mapping", rta: "cams", amcCode: "H", schemeCode: "HFC", amfiSchemeCode: FX.camsCode, note: "synthetic fixture: CAMS HFC is the infra-check flexi cap scheme", changeRef: "INFRA-3G", reason: "infrastructure check reference fixture" });
  for (const t of [T1, T2]) await twoPerson({ action: "activate", tenantId: t, mode: "validate_first", postingEnabled: true, changeRef: "INFRA-3G", reason: "infrastructure integration check",
    registrars: ["cams", "kfintech"], reportCodes: [...C.REPORT_CODES.cams, ...C.REPORT_CODES.kfintech], expiresAt: new Date(Date.now() + 864e5).toISOString() });
  const alias = `rta-infra${T1.slice(0, 8)}@in.crm.example.test`;
  await admin.query(`INSERT INTO rta_forward_addresses (tenant_id, address, token, is_active, verified_at) VALUES ($1, $2, $3, true, now())`, [T1, alias, `infra${T1.slice(0, 8)}`]);

  // S3 bucket.
  const { S3Client, CreateBucketCommand, HeadObjectCommand, PutObjectCommand, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({ region: "ap-south-1", endpoint: env.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! } });
  await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET! })).catch(() => {});
  const objectExists = async (key: string) => s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET!, Key: key })).then(() => true, () => false);

  // Sessions (the same signed cookie the login issues; scripts/dev-session.mjs).
  const cookieFor = (userId: string) => {
    const outp = execFileSync("node", ["scripts/dev-session.mjs", userId], { env: { ...env, DATABASE_URL: env.ADMIN_DATABASE_URL } }).toString();
    return outp.match(/^COOKIE (.+)$/m)![1];
  };
  const ck = { o1: cookieFor(u.o1), o2: cookieFor(u.o2), rm1: cookieFor(u.rm1), mk1: cookieFor(u.mk1) };

  // ── Workers: separate processes, killable ─────────────────────────────────
  const workers = spawnedWorkers;
  const logPath = join(WORK, "workers.log");
  const log = createWriteStream(logPath, { flags: "a" });
  const startWorker = (extraEnv: Record<string, string> = {}) => {
    // node --import tsx: the PID is the worker itself, so a SIGKILL drill kills exactly it.
    const w = spawn(process.execPath, ["--import", "tsx", "src/workers/index.ts"], { env: { ...env, WORKER_GROUPS: "rta", RTA_STAGING_LEASE_MS: "20000", RTA_HOLD_RECHECK_MS: "4000", ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
    w.stdout!.pipe(log, { end: false }); w.stderr!.pipe(log, { end: false });
    workers.push(w);
    return w;
  };
  const stopWorker = async (w: ChildProcess, signal: NodeJS.Signals = "SIGTERM") => {
    if (w.exitCode !== null || w.signalCode !== null) return;
    w.kill(signal);
    for (let i = 0; i < 100 && w.exitCode === null && w.signalCode === null; i++) await sleep(100);
    if (w.exitCode === null && w.signalCode === null) w.kill("SIGKILL");
  };

  // ── HTTP helpers ──────────────────────────────────────────────────────────
  const api = async (path: string, cookie: string, body?: unknown, method = body === undefined ? "GET" : "POST") => {
    const r = await fetch(BASE + path, { method, headers: { cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json: any = null; try { json = await r.json(); } catch { /* not JSON */ }
    return { status: r.status, json };
  };
  const upload = async (cookie: string, name: string, buf: Buffer, kind: string, source: string, password?: string) => {
    const pre = await api("/api/rta-imports/upload-url", cookie, { filename: name, contentType: "application/octet-stream" });
    if (pre.status !== 200) return { status: pre.status, stage: "presign", json: pre.json };
    const put = await fetch(pre.json.url, { method: "PUT", body: new Uint8Array(buf), headers: { "content-type": "application/octet-stream" } });
    if (!put.ok) return { status: put.status, stage: "put", json: null };
    const up = await api("/api/rta-imports/upload", cookie, { source, kind, key: pre.json.key, filename: name, ...(password ? { password } : {}) });
    return { status: up.status, stage: "upload", json: up.json, key: pre.json.key as string };
  };
  const FINAL = new Set(["completed", "partial", "failed", "rejected"]);
  const waitImport = async (cookie: string, id: string, ms = 120_000) => {
    const end = Date.now() + ms;
    let last: any = null;
    while (Date.now() < end) {
      const r = await api(`/api/rta-imports/${id}`, cookie);
      last = r.json;
      if (r.status === 200 && FINAL.has(r.json?.status)) return r.json;
      await sleep(1000);
    }
    return { status: "timeout", last };
  };
  const txCount = async (t: string) => Number((await one(`SELECT count(*)::int n FROM transactions WHERE tenant_id = $1`, [t])).n);
  const ledgerCount = async (t: string) => Number((await one(`SELECT count(*)::int n FROM rta_posted_transactions WHERE tenant_id = $1`, [t])).n);
  const counts = async (t: string) => one(`SELECT
      (SELECT count(*)::int FROM transactions WHERE tenant_id = $1) AS transactions,
      (SELECT count(*)::int FROM rta_posted_transactions WHERE tenant_id = $1) AS ledger,
      (SELECT count(*)::int FROM investors WHERE tenant_id = $1) AS investors,
      (SELECT count(*)::int FROM folios WHERE tenant_id = $1) AS folios,
      (SELECT count(*)::int FROM rta_staging_batches WHERE tenant_id = $1) AS staging_batches,
      (SELECT count(*)::int FROM rta_file_imports WHERE tenant_id = $1) AS imports`, [t]);
  const delta = (a: Record<string, number>, b: Record<string, number>) => Object.fromEntries(Object.keys(b).map((k) => [k, b[k] - (a[k] ?? 0)]).filter(([, v]) => v !== 0));
  const { reconcilePosting } = await import("@/lib/rta/posting/reversal");
  // A reconciliation that cannot run is itself a failed check, recorded with its cause — never a crash of the run.
  const reconcile = async (t: string) => {
    const t0 = Date.now();
    try { const r = await reconcilePosting(t); return { ...r, allZero: Object.values(r).every((v) => v === 0), ms: Date.now() - t0 }; }
    catch (e: any) { return { allZero: false, error: String(e?.cause?.message ?? e?.message ?? e).slice(0, 200), ms: Date.now() - t0 }; }
  };
  /** Docker's `restart: unless-stopped` (docker-compose.prod.yml): a worker that exits is started again. */
  const supervise = async (until: () => Promise<boolean>, ms: number) => {
    let restarts = 0;
    const end = Date.now() + ms;
    while (Date.now() < end && !(await until())) {
      if (w1.exitCode !== null || w1.signalCode !== null) { w1 = startWorker(); restarts++; }
      await sleep(2000);
    }
    return restarts;
  };

  let w1 = startWorker();
  let t2Baseline: Record<string, number> | null = null; // firm two after its own imports — nothing later may change it
  await sleep(6000);

  // 1. Browser upload through the real dialog (MFSD211 master for T1).
  {
    const require = createRequire(import.meta.url);
    let chromium: any;
    try { ({ chromium } = require("playwright-core")); } catch { ({ chromium } = require("/opt/node-tools/node_modules/playwright-core")); }
    const file = join(WORK, "MFSD211_master.csv");
    writeFileSync(file, m211("98000001", PAN.a1));
    const b = await chromium.launch();
    const ctx = await b.newContext();
    const [n, ...v] = ck.o1.split("=");
    await ctx.addCookies([{ name: n, value: v.join("="), domain: new URL(BASE).hostname, path: "/" }]);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(e.message));
    await page.goto(BASE + "/dashboard/rta-imports", { waitUntil: "networkidle", timeout: 180_000 });
    await page.getByRole("button", { name: /Upload file/ }).first().click();
    // Folio master type, KFintech.
    // The type picker is the custom listbox Select, not a native <select>.
    await page.locator('button[aria-label="RTA file type"]').click();
    await page.getByRole("option", { name: /Folio master \/ holdings/ }).first().locator("button").click();
    await page.getByRole("button", { name: /^KFintech$/i }).first().click();
    await page.locator('input[type="file"]').first().setInputFiles(file);
    const done = page.waitForResponse((r: any) => r.url().endsWith("/api/rta-imports/upload") && r.request().method() === "POST", { timeout: 60_000 });
    await page.getByRole("button", { name: /Upload and parse/ }).click();
    const resp = await done;
    const body = await resp.json().catch(() => ({}));
    const id = body.importId ?? body.id;
    const final = id ? await waitImport(ck.o1, id) : { status: "no id" };
    const folio1 = (await one(`SELECT count(*)::int n FROM folios WHERE tenant_id = $1 AND folio_number = '98000001'`, [T1])).n;
    check("browser: the upload dialog sends the file through presign → S3 → queue → worker → database", final.status === "completed" && folio1 === 1, `HTTP ${resp.status()}, import ${final.status}`,
      { exercised: "Chromium: upload dialog → presigned PUT → upload API → BullMQ → worker → validate-first master post", expected: { folios: 1 }, actual: { importStatus: final.status, folios: folio1 }, dbChange: await counts(T1) });
    await page.waitForTimeout(3000);
    const shown = await page.getByText(/Imported|completed|Complete/i).count();
    check("browser: the dialog shows the outcome", shown > 0, `${shown} outcome elements`, { exercised: "the dialog after the import finished", expected: { outcomeElements: ">0" }, actual: { outcomeElements: shown } });
    check("browser: no uncaught page errors", errors.length === 0, errors.slice(0, 2).join(" | "), { exercised: "pageerror events during the whole dialog flow", expected: { pageErrors: 0 }, actual: { pageErrors: errors.length } });
    await b.close();
  }

  // 2. Formats: CSV, XLSX master, XLS feed, password ZIP; a two-file ZIP is refused.
  {
    const csv = await upload(ck.o1, "MFSD201_t1.csv", csvOf(MFSD201_HEADER, [kfinRow("990001", "98000001", PAN.a1), kfinRow("990002", "98000001", PAN.a1), kfinRow("990003", "98000001", PAN.a1)]), "daily_transaction_feed", "kfintech");
    const b1 = await counts(T1);
    const f1 = await waitImport(ck.o1, csv.json?.importId);
    const a1 = await counts(T1);
    check("CSV (KFintech MFSD201) posts through the queue", f1.status === "completed" && f1.rows_imported === 3 && a1.transactions - b1.transactions === 3 && a1.ledger - b1.ledger === 3, `${f1.status}, ${f1.rows_imported}`,
      { exercised: "KFintech MFSD201 CSV, 3 transactions, scheme resolved by the registrar's ISIN", expected: { committed: 3, ledger: 3 }, actual: { rowsImported: f1.rows_imported }, dbChange: delta(b1, a1), reconcile: await reconcile(T1) });

    // Built directly as OOXML so the date cells keep their date format (a
    // BIFF8 → XLSX round trip drops it, and a bare serial is rightly refused).
    const r9Data = r9Rows("5580001/11", PAN.a2);
    const aoa = [R9_HEADER, ...r9Data.map((r) => R9_HEADER.map((h) => (r as Record<string, string | number>)[h] ?? ""))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const dc = R9_HEADER.indexOf("rep_date");
    for (let r = 1; r < aoa.length; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: dc })];
      if (cell && typeof cell.v === "number") { cell.t = "n"; cell.z = "dd-mmm-yyyy"; }
    }
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const xlsx = XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: false }) as Buffer;
    const bx = await counts(T1);
    const x1 = await upload(ck.o1, "R9_master.xlsx", xlsx, "folio_master_dump", "cams");
    const fx = await waitImport(ck.o1, x1.json?.importId);
    const ax = await counts(T1);
    const camsFolio = (await one(`SELECT count(*)::int n FROM folios WHERE tenant_id = $1 AND folio_number = '5580001/11' AND amc_code = 'H'`, [T1])).n;
    check("XLSX (CAMS R9 master) is read as a workbook and posts", fx.status === "completed" && camsFolio === 1, `${fx.status} ${fx.remarks ?? ""}`.slice(0, 160),
      { exercised: "CAMS R9 master as .xlsx (OOXML), one folio", expected: { folio: 1 }, actual: { folio: camsFolio }, dbChange: delta(bx, ax) });

    const r2 = xlsOf(R2_HEADER, [{ amc_code: "H", folio_no: "5580001/11", prodcode: "HFC", scheme: FX.camsName, trxnno: "995001", traddate: serial("2026-05-02"), units: "20.0000", amount: "1000.00", purprice: "50.0000", trxn_type_flag: "Fresh Purchase", trxn_nature: "Fresh Purchase", trxntype: "P1", trxnstat: "Y", pan: PAN.a2, siptrxnno: "" }], ["traddate"]);
    const x2 = await upload(ck.o1, "R2_feed.xls", r2, "daily_transaction_feed", "cams");
    const fx2 = await waitImport(ck.o1, x2.json?.importId);
    const r2t = await one(`SELECT count(*)::int n, min(scheme_code) code, min(rta_scheme_code) rcode FROM transactions WHERE tenant_id = $1 AND order_id = '995001'`, [T1]);
    check("XLS (CAMS R2 BIFF8) posts", fx2.status === "completed" && fx2.rows_imported === 1 && r2t.n === 1 && r2t.code === FX.camsCode, `${fx2.status}, ${fx2.rows_imported}`,
      { exercised: "CAMS R2 as BIFF8 .xls; scheme by the two-operator platform mapping (CAMS prints no ISIN)", expected: { committed: 1, schemeCode: FX.camsCode, rtaSchemeCode: "HFC" }, actual: { committed: r2t.n, schemeCode: r2t.code, rtaSchemeCode: r2t.rcode }, reconcile: await reconcile(T1) });

    const inner = join(WORK, "MFSD201_zip.csv"); writeFileSync(inner, csvOf(MFSD201_HEADER, [kfinRow("990010", "98000001", PAN.a1)]));
    const zipPath = join(WORK, "mailback.zip");
    execFileSync("zip", ["-j", "-q", "-P", "Synth#2026", zipPath, inner]);
    const z = await upload(ck.o1, "mailback.zip", readFileSync(zipPath), "daily_transaction_feed", "kfintech", "Synth#2026");
    const fz = await waitImport(ck.o1, z.json?.importId);
    const zt = (await one(`SELECT count(*)::int n FROM transactions WHERE tenant_id = $1 AND order_id = '990010'`, [T1])).n;
    check("password-protected ZIP opens with the supplied password and posts", fz.status === "completed" && fz.rows_imported === 1 && zt === 1, `${fz.status}, ${fz.rows_imported}`,
      { exercised: "AES-less PKZIP password archive, one MFSD201 row", expected: { committed: 1 }, actual: { committed: zt } });

    const inner2 = join(WORK, "second.csv"); writeFileSync(inner2, csvOf(MFSD201_HEADER, [kfinRow("990011", "98000001", PAN.a1)]));
    const zip2 = join(WORK, "two.zip"); execFileSync("zip", ["-j", "-q", zip2, inner, inner2]);
    const beforeZip2 = await txCount(T1);
    const z2 = await upload(ck.o1, "two.zip", readFileSync(zip2), "daily_transaction_feed", "kfintech");
    const fz2 = await waitImport(ck.o1, z2.json?.importId);
    const afterZip2 = await txCount(T1);
    check("a ZIP holding two data files is refused, never half-read", ["failed", "rejected"].includes(fz2.status) && afterZip2 === beforeZip2, `${fz2.status}: ${(fz2.remarks ?? "").slice(0, 100)}`,
      { exercised: "archive with two data files", expected: { committed: 0, status: "failed|rejected" }, actual: { status: fz2.status, transactionsBefore: beforeZip2, transactionsAfter: afterZip2 } });
  }

  // 3. Duplicate file and overlapping file.
  {
    const before = await txCount(T1);
    const ledgerBefore = await ledgerCount(T1);
    const firstPosted = (await one(`SELECT count(*)::int n FROM transactions WHERE tenant_id = $1 AND order_id IN ('990001', '990002', '990003')`, [T1])).n;
    const d = await upload(ck.o1, "MFSD201_t1_again.csv", csvOf(MFSD201_HEADER, [kfinRow("990001", "98000001", PAN.a1), kfinRow("990002", "98000001", PAN.a1), kfinRow("990003", "98000001", PAN.a1)]), "daily_transaction_feed", "kfintech");
    const fd = await waitImport(ck.o1, d.json?.importId);
    const afterSame = await txCount(T1), ledgerSame = await ledgerCount(T1);
    // Never vacuous: the three transactions of the first file must be there to be "not added again".
    check("the same file again adds nothing", fd.status === "completed" && firstPosted === 3 && afterSame === before && ledgerSame === ledgerBefore, `${fd.status}, imported ${fd.rows_imported}`,
      { exercised: "re-import of the identical MFSD201 (3 rows already posted)", expected: { alreadyPresent: 3, added: 0, ledgerAdded: 0 }, actual: { alreadyPresent: firstPosted, added: afterSame - before, ledgerAdded: ledgerSame - ledgerBefore }, reconcile: await reconcile(T1) });
    const o = await upload(ck.o1, "MFSD201_overlap.csv", csvOf(MFSD201_HEADER, [kfinRow("990003", "98000001", PAN.a1), kfinRow("990004", "98000001", PAN.a1)]), "daily_transaction_feed", "kfintech");
    const fo = await waitImport(ck.o1, o.json?.importId);
    const afterOverlap = await txCount(T1);
    const n990003 = (await one(`SELECT count(*)::int n FROM transactions WHERE tenant_id = $1 AND order_id = '990003'`, [T1])).n;
    check("an overlapping file posts only what is new", fo.status === "completed" && fo.rows_imported === 1 && afterOverlap === before + 1 && n990003 === 1, `${fo.status}, imported ${fo.rows_imported}`,
      { exercised: "file with one known (990003) and one new (990004) transaction", expected: { added: 1, copiesOf990003: 1 }, actual: { added: afterOverlap - before, copiesOf990003: n990003 } });
  }

  // 4. Two firms at once, two workers; masters after transactions (re-evaluation through the queue).
  {
    const w2 = startWorker();
    await sleep(6000);
    const [a, b] = await Promise.all([
      upload(ck.o1, "t1_more.csv", csvOf(MFSD201_HEADER, [kfinRow("991001", "98000001", PAN.a1), kfinRow("991002", "98000001", PAN.a1)]), "daily_transaction_feed", "kfintech"),
      upload(ck.o2, "t2_txns_first.csv", csvOf(MFSD201_HEADER, [kfinRow("991001", "98100001", PAN.b1), kfinRow("991002", "98100001", PAN.b1)]), "daily_transaction_feed", "kfintech"),
    ]);
    const [fa, fb] = await Promise.all([waitImport(ck.o1, a.json?.importId), waitImport(ck.o2, b.json?.importId)]);
    const t1par = (await one(`SELECT count(*)::int n FROM transactions WHERE tenant_id = $1 AND order_id IN ('991001', '991002')`, [T1])).n;
    const t2held = (await one(`SELECT count(*)::int n FROM rta_staging_economic_txns WHERE tenant_id = $1 AND registrar_txn_no IN ('991001', '991002') AND posting_outcome NOT IN ('posted', 'matched_existing', 'rejected_recorded', 'already_posted')`, [T2])).n;
    check("two firms in parallel: firm one posts", fa.status === "completed" && fa.rows_imported === 2 && t1par === 2, `${fa.status}`,
      { exercised: "two firms upload at once, two workers; firm one's folio is on record", expected: { committed: 2 }, actual: { committed: t1par } });
    check("two firms in parallel: firm two holds its transactions (no master yet) — same numbers, no cross-firm effect", fb.status === "failed" && (await txCount(T2)) === 0 && t2held === 2, `${fb.status}, ${(fb.remarks ?? "").slice(0, 80)}`,
      { exercised: "the same registrar numbers for firm two, whose folio is not on record", expected: { committed: 0, held: 2 }, actual: { committed: await txCount(T2), held: t2held } });
    const m = await upload(ck.o2, "t2_master.csv", m211("98100001", PAN.b1), "folio_master_dump", "kfintech");
    const fm = await waitImport(ck.o2, m.json?.importId);
    const t2after = await counts(T2);
    check("master after transactions: its arrival posts the held transactions (no re-upload)", fm.status === "completed" && t2after.transactions === 2 && t2after.ledger === 2, `${fm.status}, T2 transactions ${t2after.transactions}`,
      { exercised: "firm two's master arrives; held transactions are re-evaluated through the queue", expected: { committed: 2, ledger: 2 }, actual: t2after, reconcile: await reconcile(T2) });
    const crossRows = (await one(`SELECT count(*)::int n FROM transactions WHERE tenant_id = $1 AND investor_id IN (SELECT id FROM investors WHERE tenant_id = $2)`, [T2, T1])).n;
    check("tenant isolation: firm two sees only its own rows", crossRows === 0 && t2after.transactions > 0, `${crossRows} cross-firm rows`,
      { exercised: "firm two's transactions against firm one's clients", expected: { crossFirmRows: 0, firmTwoRows: ">0" }, actual: { crossFirmRows: crossRows, firmTwoRows: t2after.transactions } });
    t2Baseline = t2after;
    await stopWorker(w2);
  }

  // 5. Worker crash mid-file: SIGKILL while staging, restart, resume — every transaction once.
  {
    const N = 20_000;
    const rows = Array.from({ length: N }, (_, i) => kfinRow(String(7_000_000 + i), "98000001", PAN.a1));
    const before = await txCount(T1);
    const big = await upload(ck.o1, "MFSD201_big.csv", csvOf(MFSD201_HEADER, rows), "daily_transaction_feed", "kfintech");
    const id = big.json?.importId;
    let leased = false;
    for (let i = 0; i < 120 && !leased; i++) {
      const b = await one(`SELECT lease_owner IS NOT NULL AS l, state FROM rta_staging_batches WHERE tenant_id = $1 AND import_id = $2`, [T1, id]);
      leased = !!b?.l && !["ready_to_commit", "exception"].includes(b.state);
      if (!leased) await sleep(250);
    }
    await stopWorker(w1, "SIGKILL");
    const mid = await one(`SELECT status FROM rta_file_imports WHERE id = $1`, [id]);
    const atKill = await counts(T1);
    check("crash drill: the worker was killed mid-staging", leased && mid.status === "parsing" && atKill.transactions === before, `leased ${leased}, status ${mid.status}`,
      { exercised: `SIGKILL of the worker while it held the staging lease of a ${N}-row file`, expected: { importStatus: "parsing", committedAtKill: 0 }, actual: { importStatus: mid.status, committedAtKill: atKill.transactions - before } });
    w1 = startWorker();
    const f = await waitImport(ck.o1, id, 360_000);
    const after = await txCount(T1);
    check("after the crash the queue retries, the lease expires, the batch resumes and completes", f.status === "completed" && after - before === N, `${f.status} ${(f.remarks ?? "").slice(0, 80)}`,
      { exercised: "worker restarted; BullMQ retries the job; the expired lease is taken over", expected: { status: "completed", committed: N }, actual: { status: f.status, committed: after - before } });
    const dupNumbers = (await one(`SELECT count(*)::int n FROM (SELECT amc_code, order_id FROM transactions WHERE tenant_id = $1 GROUP BY 1, 2 HAVING count(*) > 1) z`, [T1])).n;
    const ledgerNow = await ledgerCount(T1);
    const rcCrash = await reconcile(T1);
    check("after the crash every transaction is posted exactly once", after - before === N && ledgerNow === after && dupNumbers === 0 && rcCrash.allZero, `+${after - before} of ${N}, ledger ${ledgerNow}, reconcile ${rcCrash.allZero ? "0" : "≠0"} in ${rcCrash.ms} ms`,
      { exercised: "exactly-once after the crash", expected: { added: N, ledgerEqualsTransactions: true, registrarNumberTwice: 0, reconcileAllZero: true }, actual: { added: after - before, transactions: after, ledger: ledgerNow, registrarNumberTwice: dupNumbers }, reconcile: rcCrash });
  }

  // 6. Redis unavailable at enqueue; then recovered.
  {
    const redisPort = new URL(env.REDIS_URL!).port || "6379";
    try { execFileSync("redis-cli", ["-p", redisPort, "shutdown", "nosave"]); } catch { /* exits as it shuts down */ }
    await sleep(1000);
    const r = await upload(ck.o1, "redis_down.csv", csvOf(MFSD201_HEADER, [kfinRow("992001", "98000001", PAN.a1)]), "daily_transaction_feed", "kfintech");
    const row = r.json?.importId ? await one(`SELECT status, remarks FROM rta_file_imports WHERE id = $1`, [r.json.importId]) : null;
    const redisDownTxn = (await one(`SELECT count(*)::int n FROM transactions WHERE tenant_id = $1 AND order_id = '992001'`, [T1])).n;
    check("Redis down: the upload is refused or recorded as not queued — never a silent loss", (r.status >= 500 || row?.status === "failed" || row?.status === "uploaded") && redisDownTxn === 0, `HTTP ${r.status}, row ${row?.status ?? "none"}`,
      { exercised: "redis-server shut down before the upload's enqueue", expected: { httpOrRow: "5xx or failed/uploaded row", committed: 0 }, actual: { http: r.status, row: row?.status ?? null, committed: redisDownTxn } });
    spawn("redis-server", ["--port", redisPort, "--daemonize", "yes", "--save", "", "--appendonly", "no"], { stdio: "ignore" });
    await sleep(2500);
    await stopWorker(w1); w1 = startWorker(); await sleep(6000);
    const retry = await upload(ck.o1, "redis_back.csv", csvOf(MFSD201_HEADER, [kfinRow("992001", "98000001", PAN.a1)]), "daily_transaction_feed", "kfintech");
    const fr = await waitImport(ck.o1, retry.json?.importId);
    const redisBackTxn = (await one(`SELECT count(*)::int n FROM transactions WHERE tenant_id = $1 AND order_id = '992001'`, [T1])).n;
    check("Redis back: the same file imports normally", fr.status === "completed" && fr.rows_imported === 1 && redisBackTxn === 1, `${fr.status}`,
      { exercised: "Redis restarted, worker restarted, the same file uploaded again", expected: { committed: 1 }, actual: { committed: redisBackTxn } });
  }

  // 7. S3 unreachable from the worker; the file is kept; recovery by re-import.
  {
    await stopWorker(w1);
    w1 = startWorker({ S3_ENDPOINT: "http://127.0.0.1:9", S3_CONNECT_TIMEOUT_MS: "1000", S3_REQUEST_TIMEOUT_MS: "2000" });
    await sleep(6000);
    const r = await upload(ck.o1, "s3_down.csv", csvOf(MFSD201_HEADER, [kfinRow("993001", "98000001", PAN.a1)]), "daily_transaction_feed", "kfintech");
    const f = await waitImport(ck.o1, r.json?.importId, 180_000);
    const s3DownTxn = (await one(`SELECT count(*)::int n FROM transactions WHERE tenant_id = $1 AND order_id = '993001'`, [T1])).n;
    const s3Remark = (await one(`SELECT left(coalesce(remarks, ''), 120) r FROM rta_file_imports WHERE id = $1`, [r.json?.importId])).r;
    check("S3 unreachable: the import fails with a recorded reason (BullMQ retried it), nothing posted", ["failed", "timeout"].includes(f.status) && s3DownTxn === 0 && !!s3Remark, `${f.status}`,
      { exercised: "worker pointed at an unreachable object store", expected: { status: "failed", committed: 0, reasonRecorded: true }, actual: { status: f.status, committed: s3DownTxn, reason: s3Remark } });
    const kept = await objectExists(r.key!);
    check("S3 unreachable: the uploaded file is kept for the retry", kept, "", { exercised: "the uploaded object after the failed import", expected: { objectKept: true }, actual: { objectKept: kept } });
    await stopWorker(w1); w1 = startWorker(); await sleep(6000);
    const re = await api(`/api/rta-imports/${r.json?.importId}/reimport`, ck.o1, {});
    const f2 = await waitImport(ck.o1, r.json?.importId);
    const s3BackTxn = (await one(`SELECT count(*)::int n FROM transactions WHERE tenant_id = $1 AND order_id = '993001'`, [T1])).n;
    check("S3 back: re-import of the kept file completes", re.status < 300 && f2.status === "completed" && s3BackTxn === 1, `HTTP ${re.status}, ${f2.status}`,
      { exercised: "object store back; operator re-imports the kept file", expected: { committed: 1 }, actual: { http: re.status, status: f2.status, committed: s3BackTxn }, reconcile: await reconcile(T1) });
  }

  // 8. Database unavailable to the worker; BullMQ retries until it returns.
  {
    await stopWorker(w1);
    const r = await upload(ck.o1, "db_down.csv", csvOf(MFSD201_HEADER, [kfinRow("994001", "98000001", PAN.a1)]), "daily_transaction_feed", "kfintech");
    const role = new URL(env.DATABASE_URL!).username;
    await admin.query(`ALTER ROLE ${role} NOLOGIN`);
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1 AND pid <> pg_backend_pid()`, [role]);
    w1 = startWorker();
    // The worker refuses to start without its database (0244 runtime check) and
    // exits; production's compose restarts it (restart: unless-stopped). Model that.
    const refusedRestarts = await supervise(async () => false, 7000);
    const whileDown = (await one(`SELECT count(*)::int n FROM transactions WHERE tenant_id = $1 AND order_id = '994001'`, [T1])).n;
    await admin.query(`ALTER ROLE ${role} LOGIN`);
    const restarts = refusedRestarts + await supervise(async () => FINAL.has((await one(`SELECT status FROM rta_file_imports WHERE id = $1`, [r.json?.importId])).status), 180_000);
    const f = await waitImport(ck.o1, r.json?.importId, 30_000);
    const n = await one(`SELECT count(*)::int n FROM transactions WHERE tenant_id = $1 AND order_id = '994001'`, [T1]);
    check("database unreachable then back: the job is retried and posts once", f.status === "completed" && n.n === 1 && whileDown === 0, `${f.status}, ${n.n}, worker restarts ${restarts}`,
      { exercised: "app role NOLOGIN + its sessions terminated; worker starts (and is restarted as Docker would) until the role logs in again", expected: { committedWhileDown: 0, committedAfter: 1 }, actual: { committedWhileDown: whileDown, committedAfter: n.n, workerRestarts: restarts }, reconcile: await reconcile(T1) });
  }

  // 8b. The database connection is lost DURING posting: the posting
  //     transaction rolls back whole (nothing of the file is visible), and the
  //     retry posts every transaction exactly once (B-1 stabilisation, I-6).
  {
    const N2 = 5000;
    const rows = Array.from({ length: N2 }, (_, i) => kfinRow(String(8_000_000 + i), "98000001", PAN.a1));
    const before = await counts(T1);
    const up = await upload(ck.o1, "MFSD201_dbkill.csv", csvOf(MFSD201_HEADER, rows), "daily_transaction_feed", "kfintech");
    const role = new URL(env.DATABASE_URL!).username;
    let killed = 0;
    for (let i = 0; i < 2400 && !killed; i++) {
      const act = (await admin.query(`SELECT pid FROM pg_stat_activity WHERE usename = $1 AND state <> 'idle'
          AND (query ILIKE '%insert into "transactions"%' OR query ILIKE '%insert into transactions%' OR query ILIKE '%rta_posted_transactions%')`, [role])).rows;
      if (act.length) for (const a of act) { await admin.query(`SELECT pg_terminate_backend($1)`, [a.pid]); killed++; }
      else await sleep(25);
    }
    await sleep(1500);
    const ours = async () => (await one(`SELECT count(*)::int n FROM transactions WHERE tenant_id = $1 AND order_id >= '8000000' AND order_id < '8005000'`, [T1])).n;
    const afterKill = await ours();
    check("database lost during posting: the posting transaction rolls back whole", killed > 0 && afterKill === 0, `${killed} posting connection(s) terminated, ${afterKill} rows visible`,
      { exercised: `pg_terminate_backend on the worker's connection while it was inserting a ${N2}-row file's postings`, expected: { postingConnectionsKilled: ">0", rowsVisibleAfterKill: 0 }, actual: { postingConnectionsKilled: killed, rowsVisibleAfterKill: afterKill } });
    let restarts = await supervise(async () => FINAL.has((await one(`SELECT status FROM rta_file_imports WHERE id = $1`, [up.json?.importId])).status), 240_000);
    let f = await waitImport(ck.o1, up.json?.importId, 30_000);
    let path = "automatic retry";
    const firstOutcome = { status: f.status, remark: String((await one(`SELECT left(coalesce(remarks, ''), 160) r FROM rta_file_imports WHERE id = $1`, [up.json?.importId])).r).replace(/[A-Z]{5}[0-9]{4}[A-Z]/g, "<pan>") };
    // What the Exceptions / Imports team sees BEFORE acting (final qualification, Task 5):
    // the import is visibly failed with a reason, nothing of it is posted, its file is kept.
    const failedState = f.status === "completed" ? null : {
      status: f.status,
      reasonShown: firstOutcome.remark.length > 0,
      fileKept: !!(await one(`SELECT file_key FROM rta_file_imports WHERE id = $1`, [up.json?.importId])).file_key,
      postedOutcomes: (await one(`SELECT count(*)::int n FROM rta_staging_economic_txns e JOIN rta_staging_batches b ON b.id = e.batch_id
                                   WHERE b.import_id = $1 AND e.posting_outcome IN ('posted', 'matched_existing', 'rejected_recorded')`, [up.json?.importId])).n,
      ledgerRows: (await one(`SELECT count(*)::int n FROM rta_posted_transactions p JOIN rta_staging_batches b ON b.id = p.batch_id WHERE b.import_id = $1`, [up.json?.importId])).n,
    };
    if (f.status !== "completed") {
      // Validate-first records an interrupted posting as a failed import with its
      // reason (nothing written); the documented recovery is a re-import.
      path = "operator re-import";
      await api(`/api/rta-imports/${up.json?.importId}/reimport`, ck.o1, {});
      restarts += await supervise(async () => FINAL.has((await one(`SELECT status FROM rta_file_imports WHERE id = $1`, [up.json?.importId])).status), 240_000);
      f = await waitImport(ck.o1, up.json?.importId, 30_000);
    }
    const n = await ours();
    const after = await counts(T1);
    check("database lost during posting: the retry posts every transaction exactly once", f.status === "completed" && n === N2 && after.ledger - before.ledger === N2 && after.transactions - before.transactions === N2, `${f.status} via ${path}, ${n} of ${N2}`,
      { exercised: "after the rollback the job is retried", expected: { committed: N2, ledgerAdded: N2 }, actual: { firstOutcome, status: f.status, path, committed: n, ledgerAdded: after.ledger - before.ledger, workerRestarts: restarts }, reconcile: await reconcile(T1) });
    if (failedState) {
      // The recovery itself: audited, and a second re-import of a completed file is refused.
      const audits = (await one(`SELECT count(*)::int n FROM audit_log WHERE tenant_id = $1 AND action = 'rta_import.reimport' AND entity_id = $2::uuid`, [T1, up.json?.importId])).n;
      const again = await api(`/api/rta-imports/${up.json?.importId}/reimport`, ck.o1, {});
      const afterAgain = await counts(T1);
      check("failed import recovery: visibly failed with a reason, nothing posted, file kept; the re-import is audited; a second re-import is refused",
        failedState.status === "failed" && failedState.reasonShown && failedState.fileKept && failedState.postedOutcomes === 0 && failedState.ledgerRows === 0
          && audits === 1 && again.status === 409 && JSON.stringify(afterAgain) === JSON.stringify(after),
        `before recovery: ${failedState.status}, reason shown ${failedState.reasonShown}, file kept ${failedState.fileKept}, ${failedState.postedOutcomes} posted outcomes, ${failedState.ledgerRows} ledger rows · re-import audit rows ${audits} · second re-import HTTP ${again.status}`,
        { exercised: "the Exceptions / Imports team's view of the failed import, then the operator re-import and a repeated re-import", expected: { status: "failed", reasonShown: true, fileKept: true, postedOutcomes: 0, ledgerRows: 0, reimportAudits: 1, secondReimport: 409, recordsUnchanged: true }, actual: { ...failedState, reimportAudits: audits, secondReimport: again.status, recordsUnchanged: JSON.stringify(afterAgain) === JSON.stringify(after) } });
    }
  }

  // 8c. Emergency halt and resume: one operator halts; a file arriving during
  //     the halt is parked with nothing written; two operators release; the
  //     parked file then imports by itself, once.
  {
    const before = await counts(T1);
    await C.setPostingHalt({ scope: "global", halted: true, reason: "infra check: emergency halt drill", changedBy: u.op1, actorSource: "cli" });
    const up = await upload(ck.o1, "MFSD201_halted.csv", csvOf(MFSD201_HEADER, [kfinRow("997001", "98000001", PAN.a1)]), "daily_transaction_feed", "kfintech");
    let row: any = null;
    for (let i = 0; i < 90; i++) {
      row = await one(`SELECT status, left(coalesce(remarks, ''), 160) remarks FROM rta_file_imports WHERE id = $1`, [up.json?.importId]);
      if (row.status === "uploaded" && /^Held/.test(row.remarks)) break;
      await sleep(1000);
    }
    const during = await counts(T1);
    const halted997 = (await one(`SELECT count(*)::int n FROM transactions WHERE tenant_id = $1 AND order_id = '997001'`, [T1])).n;
    check("emergency halt: a file arriving during the halt is parked and nothing is written", row?.status === "uploaded" && /^Held/.test(row?.remarks ?? "") && halted997 === 0 && during.transactions === before.transactions && during.ledger === before.ledger, `${row?.status}: ${(row?.remarks ?? "").slice(0, 70)}`,
      { exercised: "global posting halt by ONE operator, then an upload", expected: { importStatus: "uploaded (Held …)", committed: 0 }, actual: { importStatus: row?.status, remark: row?.remarks, committed: halted997 }, dbChange: delta(before, during) });
    await twoPerson({ action: "release", scope: "global", changeRef: "INFRA-3G", reason: "infra check: halt drill over — two operators release" });
    const f = await waitImport(ck.o1, up.json?.importId, 120_000);
    const resumed997 = (await one(`SELECT count(*)::int n FROM transactions WHERE tenant_id = $1 AND order_id = '997001'`, [T1])).n;
    check("resume: after a two-person release the parked file imports by itself, once", f.status === "completed" && resumed997 === 1, `${f.status}, ${resumed997}`,
      { exercised: "two-person release; the worker's held-job re-check picks the parked file up", expected: { committed: 1 }, actual: { status: f.status, committed: resumed997 }, reconcile: await reconcile(T1) });
  }

  // 9. Permission and tenant-isolation failures.
  {
    // An RM holds transactions.execute by default (rbac.ts); marketing does not.
    const mk = await api("/api/rta-imports/upload-url", ck.mk1, { filename: "x.csv" });
    check("a user without the import capability cannot get an upload URL", mk.status === 403, `HTTP ${mk.status}`, { exercised: "marketing role asks for an upload URL", expected: { http: 403 }, actual: { http: mk.status } });
    const t1Import = (await one(`SELECT id FROM rta_file_imports WHERE tenant_id = $1 LIMIT 1`, [T1])).id;
    const cross = await api(`/api/rta-imports/${t1Import}`, ck.o2);
    check("another firm's import is not found", cross.status === 404, `HTTP ${cross.status}`, { exercised: "firm two's owner reads firm one's import", expected: { http: 404 }, actual: { http: cross.status } });
    const wrongKey = await api("/api/rta-imports/upload", ck.o1, { source: "kfintech", kind: "daily_transaction_feed", key: `tenants/${T2}/rta/x.csv`, filename: "x.csv" });
    check("an upload naming another firm's storage key is refused", wrongKey.status === 403, `HTTP ${wrongKey.status}`, { exercised: "firm one registers an object under firm two's prefix", expected: { http: 403 }, actual: { http: wrongKey.status } });
    const op = await api("/api/super-admin/rta-pipeline", ck.o1, { action: "halt", scope: "global", reason: "tenant owner trying to halt everything" });
    // Operator controls need a PLATFORM session (a separate cookie): a firm session gets 401.
    const haltedAfter = (await one(`SELECT posting_halted h FROM rta_posting_controls WHERE scope = 'global'`)).h;
    check("a firm owner cannot use the operator controls", (op.status === 401 || op.status === 403) && haltedAfter === false, `HTTP ${op.status}`, { exercised: "a firm owner's session calls the platform halt", expected: { http: "401|403", globalHalted: false }, actual: { http: op.status, globalHalted: haltedAfter } });
    const res = await api(`/api/rta-staging/economic/${randomUUID()}/resolve`, ck.mk1, { investorId: randomUUID(), note: "not allowed" });
    check("a user without the import capability cannot resolve held transactions", res.status === 403, `HTTP ${res.status}`, { exercised: "marketing role resolves a held transaction", expected: { http: 403 }, actual: { http: res.status } });
  }

  // 10. Mail: trusted registrar mail is routed to its firm and imported; forged / unroutable mail is held.
  {
    const mime = (to: string, from: string, auth: string, name: string, data: Buffer) => [
      `Return-Path: <bounce@${from.split("@")[1]}>`, `Authentication-Results: amazonses.com; ${auth}`,
      `From: Registrar Mailback <${from}>`, `To: ${to}`, `Subject: MFSD201 mailback`, `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@${from.split("@")[1]}>`, `MIME-Version: 1.0`, `Content-Type: multipart/mixed; boundary="b1"`, ``,
      `--b1`, `Content-Type: text/plain`, ``, `Please find the report attached.`, ``,
      `--b1`, `Content-Type: text/csv; name="${name}"`, `Content-Disposition: attachment; filename="${name}"`, `Content-Transfer-Encoding: base64`, ``,
      data.toString("base64").replace(/.{76}/g, "$&\r\n"), `--b1--`, ``].join("\r\n");
    const good = "spf=pass smtp.mailfrom=kfintech.com; dkim=pass header.i=@kfintech.com header.d=kfintech.com; dmarc=pass header.from=kfintech.com";
    const csv = csvOf(MFSD201_HEADER, [kfinRow("996001", "98000001", PAN.a1)]);
    const put = (k: string, body: string) => s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET!, Key: `rta-inbound/${k}`, Body: body }));
    await put("trusted.eml", mime(alias, "mailback@kfintech.com", good, "MFSD201_mail.csv", csv));
    await put("forged.eml", mime(alias, "reports@example.com", "spf=fail; dkim=none; dmarc=fail header.from=example.com", "MFSD201_forged.csv", csvOf(MFSD201_HEADER, [kfinRow("996002", "98000001", PAN.a1)])));
    await put("unroutable.eml", mime("rta-nobody@in.crm.example.test", "mailback@kfintech.com", good, "MFSD201_x.csv", csvOf(MFSD201_HEADER, [kfinRow("996003", "98000001", PAN.a1)])));
    const { pollS3InboundOnce } = await import("@/workers/rta-inbox-poller");
    const p = await pollS3InboundOnce();
    check("mail: the poller read all three stored mails from S3", p.processed === 3, JSON.stringify(p), { exercised: "three .eml objects in the inbound prefix", expected: { processed: 3 }, actual: p });
    let imported = false;
    for (let i = 0; i < 90 && !imported; i++) { imported = !!(await one(`SELECT 1 x FROM transactions WHERE tenant_id = $1 AND order_id = '996001'`, [T1])); if (!imported) await sleep(1000); }
    const mailRow = (await one(`SELECT count(*)::int n, min(investor_id::text) inv FROM transactions WHERE tenant_id = $1 AND order_id = '996001'`, [T1]));
    check("mail: the trusted registrar mail is routed by alias to its firm and imported through the queue", imported && mailRow.n === 1, `${mailRow.n} posted`,
      { exercised: "DKIM/DMARC-aligned registrar mail to firm one's alias", expected: { committed: 1, firm: "one" }, actual: { committed: mailRow.n } });
    const held = await s3.send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET!, Prefix: "rta-inbound-held/" }));
    const heldKeys = (held.Contents ?? []).map((o) => o.Key);
    const forgedPosted = (await one(`SELECT count(*)::int n FROM transactions WHERE order_id IN ('996002', '996003')`)).n;
    check("mail: forged and unroutable mail are held (kept, retried), never imported", heldKeys.length === 2 && forgedPosted === 0, `${heldKeys.length} held`,
      { exercised: "a forged sender and an unknown alias", expected: { held: 2, committed: 0 }, actual: { held: heldKeys.length, committed: forgedPosted } });
  }

  // 11. Privacy: no PAN in logs, staging or import remarks.
  {
    await stopWorker(w1);
    log.end();
    await sleep(500);
    const logs = readFileSync(logPath, "utf8") + (env.NEXT_LOG && existsSync(env.NEXT_LOG) ? readFileSync(env.NEXT_LOG, "utf8") : "");
    const leaked = Object.values(PAN).filter((p) => logs.includes(p));
    check("privacy: no PAN in worker or server logs", leaked.length === 0, `${leaked.length} found, ${logs.length} bytes scanned`, { exercised: "worker and Next logs of the whole run", expected: { pansFound: 0 }, actual: { pansFound: leaked.length, bytesScanned: logs.length } });
    // 1) the PANs this run fed in, anywhere in staging; 2) any PAN-shaped value
    // outside the keyed columns (a base64url HMAC can contain a PAN-shaped run
    // by chance — one did in ~25,000 rows — so hashes and tokens are excluded).
    const pans = Object.values(PAN);
    const exact = await one(`
      SELECT (SELECT count(*)::int FROM rta_staging_rows r WHERE r.tenant_id IN ($1, $2) AND r::text ~ $3)
           + (SELECT count(*)::int FROM rta_staging_economic_txns e WHERE e.tenant_id IN ($1, $2) AND e::text ~ $3) AS n`, [T1, T2, pans.join("|")]);
    const shaped = await one(`
      SELECT count(*)::int n FROM (
        SELECT to_jsonb(r) - 'row_hash' - 'pan_token' - 'guardian_pan_token' - 'economic_key' AS j FROM rta_staging_rows r WHERE r.tenant_id IN ($1, $2)
        UNION ALL
        SELECT to_jsonb(e) - 'identity_key' - 'invariant_hash' - 'lot_signature' FROM rta_staging_economic_txns e WHERE e.tenant_id IN ($1, $2)) x
      WHERE x.j::text ~ '(^|[^A-Za-z0-9_-])[A-Z]{5}[0-9]{4}[A-Z]($|[^A-Za-z0-9_-])'`, [T1, T2]);
    check("privacy: staging holds no PAN (keyed tokens only)", exact.n === 0 && shaped.n === 0, `input PANs found ${exact.n}, PAN-shaped values outside keyed columns ${shaped.n}`, { exercised: "every staging row and economic transaction of both firms", expected: { pans: 0 }, actual: { inputPans: exact.n, panShaped: shaped.n } });
    const rem = await one(`SELECT count(*)::int n FROM rta_file_imports WHERE tenant_id IN ($1, $2) AND (coalesce(remarks, '') || coalesce(errors::text, '')) ~ '[A-Z]{5}[0-9]{4}[A-Z]'`, [T1, T2]);
    check("privacy: import remarks and errors are PAN-masked", rem.n === 0, `${rem.n}`, { exercised: "every import's remarks and errors", expected: { unmasked: 0 }, actual: { unmasked: rem.n } });
  }

  // 12. Final statuses: every import ended in a final state.
  {
    const st = (await admin.query(`SELECT status, count(*)::int n FROM rta_file_imports WHERE tenant_id IN ($1, $2) GROUP BY 1`, [T1, T2])).rows;
    const stuck = st.filter((s: any) => !FINAL.has(s.status)).reduce((a: number, s: any) => a + s.n, 0);
    check("every import reached a final status (none left parsing / queued)", stuck === 0, JSON.stringify(st), { exercised: "every import row of both firms", expected: { notFinal: 0 }, actual: st });
  }

  // 13. Whole-run invariants (B-1 stabilisation): right client, untouched
  //     second firm, a clean ledger.
  {
    const wrongOwner = (await one(`SELECT count(*)::int n FROM transactions t JOIN folios f ON f.id = t.folio_id WHERE t.tenant_id IN ($1, $2) AND t.investor_id IS DISTINCT FROM f.investor_id`, [T1, T2])).n;
    const a1 = (await one(`SELECT count(*)::int n, count(*) FILTER (WHERE i.pan IS DISTINCT FROM $2)::int wrong FROM transactions t JOIN investors i ON i.id = t.investor_id WHERE t.tenant_id = $1 AND t.folio_number = '98000001'`, [T1, PAN.a1]));
    check("no wrong-client posting: every transaction belongs to its folio's owner, and folio 98000001's to PAN holder a1", wrongOwner === 0 && a1.n > 0 && a1.wrong === 0, `${wrongOwner} off-owner, ${a1.wrong} of ${a1.n} on another PAN`,
      { exercised: "every posted transaction of both firms against its folio owner", expected: { offOwner: 0, otherPan: 0, rows: ">0" }, actual: { offOwner: wrongOwner, otherPan: a1.wrong, rows: a1.n } });
    const t2Now = await counts(T2);
    check("no unexpected tenant modification: firm two unchanged by everything firm one did after its own imports", !!t2Baseline && JSON.stringify(t2Now) === JSON.stringify(t2Baseline), JSON.stringify(delta(t2Baseline ?? {}, t2Now)),
      { exercised: "firm two's records from the end of section 4 to the end of the run", expected: t2Baseline, actual: t2Now });
    const r1 = await reconcile(T1), r2 = await reconcile(T2);
    const c1 = await counts(T1), c2 = await counts(T2);
    const twice = (await one(`SELECT count(*)::int n FROM (SELECT tenant_id, amc_code, order_id FROM transactions WHERE tenant_id IN ($1, $2) GROUP BY 1, 2, 3 HAVING count(*) > 1) z`, [T1, T2])).n;
    check("ledger reconciles for both firms: five checks 0, ledger = transactions, no registrar number twice", r1.allZero && r2.allZero && c1.ledger === c1.transactions && c2.ledger === c2.transactions && twice === 0, `firm one ${c1.transactions}/${c1.ledger}, firm two ${c2.transactions}/${c2.ledger}`,
      { exercised: "reconcilePosting on both firms at the end of the run", expected: { allZero: true, ledgerEqualsTransactions: true, registrarNumberTwice: 0 }, actual: { firmOne: c1, firmTwo: c2, registrarNumberTwice: twice }, reconcile: { firmOne: r1, firmTwo: r2 } });
  }

  const reportPath = env.INFRA_REPORT || join(WORK, "infra-report.json");
  writeFileSync(reportPath, JSON.stringify({ at: new Date().toISOString(), firms: { one: T1, two: T2 }, passed: results.filter((r) => r.ok).length, total: results.length, results }, null, 1));
  console.log(`evidence: ${reportPath}`);

  for (const w of workers) await stopWorker(w);
  await admin.end();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed  (firms ${T1} · ${T2})`);
  process.exit(failed ? 1 : 0);
}
// A crashed run must not leave a worker posting into the scratch database
// after the harness has gone (B-1 stabilisation: run 3 left one behind).
const spawnedWorkers: ChildProcess[] = [];
process.on("exit", () => {
  for (const w of spawnedWorkers) if (w.exitCode === null && w.signalCode === null) { try { w.kill("SIGKILL"); } catch { /* already gone */ } }
});
main().catch((e) => { console.error(String(e?.stack ?? e).replace(/[A-Z]{5}[0-9]{4}[A-Z]/g, "<pan>")); process.exit(1); });
