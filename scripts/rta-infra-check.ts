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
const results: Array<{ name: string; ok: boolean }> = [];
const check = (name: string, ok: boolean, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Synthetic PANs (valid structure, invented): two firms, never a real person.
const PAN = { a1: "ZZZPA1111A", a2: "ZZZPB2222B", a3: "ZZZPC3333C", b1: "ZZZPD4444D" };

const kfinRow = (txn: string, folio: string, pan: string, extra: Record<string, string> = {}) => ({
  "Fund": "117", "Folio Number": folio, "Product Code": "117EQGR", "Fund Description": "Example Equity Fund - Growth", "Transaction Head": "P",
  "Transaction Description": "Systematic Investment", "Transaction Type": "SIN", "Transaction Status": "Y", "Transaction Date": "15/4/2026",
  "Nav": "50.0000", "Price": "50.0000", Units: "20.000", Amount: "1000.00", "Transaction Number": txn, PAN1: pan, ...extra,
});
const m211 = (folio: string, pan: string) => csvOf(MFSD211_HEADER, [{ Fund: "117", Folio: folio, "Product Code": "117EQGR", "PAN Number": pan, "Report Date": "18/5/2026", "Investor Name": "Synthetic Person", "Tax Status": "Individual" }]);
const r9Rows = (folio: string, pan: string) => [{ foliochk: folio, product: "HFC", amc_code: "H", rep_date: serial("2026-05-18"), clos_bal: "20.000", rupee_bal: "1000.00", pan_no: pan, inv_name: "Synthetic Person", tax_status: "Individual" }];

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
  for (const k of ["op1", "op2"] as const) await admin.query(`INSERT INTO user_sessions (tenant_id, user_id, session_id) VALUES ($1, $2, $3)`, [PF, u[k], sess[k]]);
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
  const workers: ChildProcess[] = [];
  const logPath = join(WORK, "workers.log");
  const log = createWriteStream(logPath, { flags: "a" });
  const startWorker = (extraEnv: Record<string, string> = {}) => {
    // node --import tsx: the PID is the worker itself, so a SIGKILL drill kills exactly it.
    const w = spawn(process.execPath, ["--import", "tsx", "src/workers/index.ts"], { env: { ...env, WORKER_GROUPS: "rta", RTA_STAGING_LEASE_MS: "20000", ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
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

  let w1 = startWorker();
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
    check("browser: the upload dialog sends the file through presign → S3 → queue → worker → database", final.status === "completed" && (await one(`SELECT count(*)::int n FROM folios WHERE tenant_id = $1 AND folio_number = '98000001'`, [T1])).n === 1, `HTTP ${resp.status()}, import ${final.status}`);
    await page.waitForTimeout(3000);
    const shown = await page.getByText(/Imported|completed|Complete/i).count();
    check("browser: the dialog shows the outcome", shown > 0, `${shown} outcome elements`);
    check("browser: no uncaught page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
    await b.close();
  }

  // 2. Formats: CSV, XLSX master, XLS feed, password ZIP; a two-file ZIP is refused.
  {
    const csv = await upload(ck.o1, "MFSD201_t1.csv", csvOf(MFSD201_HEADER, [kfinRow("990001", "98000001", PAN.a1), kfinRow("990002", "98000001", PAN.a1), kfinRow("990003", "98000001", PAN.a1)]), "daily_transaction_feed", "kfintech");
    const f1 = await waitImport(ck.o1, csv.json?.importId);
    check("CSV (KFintech MFSD201) posts through the queue", f1.status === "completed" && f1.rows_imported === 3, `${f1.status}, ${f1.rows_imported}`);

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
    const x1 = await upload(ck.o1, "R9_master.xlsx", xlsx, "folio_master_dump", "cams");
    const fx = await waitImport(ck.o1, x1.json?.importId);
    check("XLSX (CAMS R9 master) is read as a workbook and posts", fx.status === "completed", `${fx.status} ${fx.remarks ?? ""}`.slice(0, 160));

    const r2 = xlsOf(R2_HEADER, [{ amc_code: "H", folio_no: "5580001/11", prodcode: "HFC", trxnno: "995001", traddate: serial("2026-05-02"), units: "20.0000", amount: "1000.00", purprice: "50.0000", trxn_type_flag: "Fresh Purchase", trxn_nature: "Fresh Purchase", trxntype: "P1", trxnstat: "Y", pan: PAN.a2, siptrxnno: "" }], ["traddate"]);
    const x2 = await upload(ck.o1, "R2_feed.xls", r2, "daily_transaction_feed", "cams");
    const fx2 = await waitImport(ck.o1, x2.json?.importId);
    check("XLS (CAMS R2 BIFF8) posts", fx2.status === "completed" && fx2.rows_imported === 1, `${fx2.status}, ${fx2.rows_imported}`);

    const inner = join(WORK, "MFSD201_zip.csv"); writeFileSync(inner, csvOf(MFSD201_HEADER, [kfinRow("990010", "98000001", PAN.a1)]));
    const zipPath = join(WORK, "mailback.zip");
    execFileSync("zip", ["-j", "-q", "-P", "Synth#2026", zipPath, inner]);
    const z = await upload(ck.o1, "mailback.zip", readFileSync(zipPath), "daily_transaction_feed", "kfintech", "Synth#2026");
    const fz = await waitImport(ck.o1, z.json?.importId);
    check("password-protected ZIP opens with the supplied password and posts", fz.status === "completed" && fz.rows_imported === 1, `${fz.status}, ${fz.rows_imported}`);

    const inner2 = join(WORK, "second.csv"); writeFileSync(inner2, csvOf(MFSD201_HEADER, [kfinRow("990011", "98000001", PAN.a1)]));
    const zip2 = join(WORK, "two.zip"); execFileSync("zip", ["-j", "-q", zip2, inner, inner2]);
    const beforeZip2 = await txCount(T1);
    const z2 = await upload(ck.o1, "two.zip", readFileSync(zip2), "daily_transaction_feed", "kfintech");
    const fz2 = await waitImport(ck.o1, z2.json?.importId);
    check("a ZIP holding two data files is refused, never half-read", ["failed", "rejected"].includes(fz2.status) && (await txCount(T1)) === beforeZip2, `${fz2.status}: ${(fz2.remarks ?? "").slice(0, 100)}`);
  }

  // 3. Duplicate file and overlapping file.
  {
    const before = await txCount(T1);
    const d = await upload(ck.o1, "MFSD201_t1_again.csv", csvOf(MFSD201_HEADER, [kfinRow("990001", "98000001", PAN.a1), kfinRow("990002", "98000001", PAN.a1), kfinRow("990003", "98000001", PAN.a1)]), "daily_transaction_feed", "kfintech");
    const fd = await waitImport(ck.o1, d.json?.importId);
    check("the same file again adds nothing", fd.status === "completed" && (await txCount(T1)) === before, `${fd.status}, imported ${fd.rows_imported}`);
    const o = await upload(ck.o1, "MFSD201_overlap.csv", csvOf(MFSD201_HEADER, [kfinRow("990003", "98000001", PAN.a1), kfinRow("990004", "98000001", PAN.a1)]), "daily_transaction_feed", "kfintech");
    const fo = await waitImport(ck.o1, o.json?.importId);
    check("an overlapping file posts only what is new", fo.status === "completed" && fo.rows_imported === 1 && (await txCount(T1)) === before + 1, `${fo.status}, imported ${fo.rows_imported}`);
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
    check("two firms in parallel: firm one posts", fa.status === "completed" && fa.rows_imported === 2, `${fa.status}`);
    check("two firms in parallel: firm two holds its transactions (no master yet) — same numbers, no cross-firm effect", fb.status === "failed" && (await txCount(T2)) === 0, `${fb.status}, ${(fb.remarks ?? "").slice(0, 80)}`);
    const m = await upload(ck.o2, "t2_master.csv", m211("98100001", PAN.b1), "folio_master_dump", "kfintech");
    const fm = await waitImport(ck.o2, m.json?.importId);
    check("master after transactions: its arrival posts the held transactions (no re-upload)", fm.status === "completed" && (await txCount(T2)) === 2, `${fm.status}, T2 transactions ${await txCount(T2)}`);
    check("tenant isolation: firm two sees only its own rows", (await one(`SELECT count(*)::int n FROM transactions WHERE tenant_id = $1 AND investor_id IN (SELECT id FROM investors WHERE tenant_id = $2)`, [T2, T1])).n === 0);
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
    check("crash drill: the worker was killed mid-staging", leased && mid.status === "parsing", `leased ${leased}, status ${mid.status}`);
    w1 = startWorker();
    const f = await waitImport(ck.o1, id, 360_000);
    const after = await txCount(T1);
    check("after the crash the queue retries, the lease expires, the batch resumes and completes", f.status === "completed", `${f.status} ${(f.remarks ?? "").slice(0, 80)}`);
    check("after the crash every transaction is posted exactly once", after - before === N && (await ledgerCount(T1)) === after, `+${after - before} of ${N}, ledger ${await ledgerCount(T1)}`);
  }

  // 6. Redis unavailable at enqueue; then recovered.
  {
    const redisPort = new URL(env.REDIS_URL!).port || "6379";
    try { execFileSync("redis-cli", ["-p", redisPort, "shutdown", "nosave"]); } catch { /* exits as it shuts down */ }
    await sleep(1000);
    const r = await upload(ck.o1, "redis_down.csv", csvOf(MFSD201_HEADER, [kfinRow("992001", "98000001", PAN.a1)]), "daily_transaction_feed", "kfintech");
    const row = r.json?.importId ? await one(`SELECT status, remarks FROM rta_file_imports WHERE id = $1`, [r.json.importId]) : null;
    check("Redis down: the upload is refused or recorded as not queued — never a silent loss", r.status >= 500 || row?.status === "failed" || row?.status === "uploaded", `HTTP ${r.status}, row ${row?.status ?? "none"}`);
    spawn("redis-server", ["--port", redisPort, "--daemonize", "yes", "--save", "", "--appendonly", "no"], { stdio: "ignore" });
    await sleep(2500);
    await stopWorker(w1); w1 = startWorker(); await sleep(6000);
    const retry = await upload(ck.o1, "redis_back.csv", csvOf(MFSD201_HEADER, [kfinRow("992001", "98000001", PAN.a1)]), "daily_transaction_feed", "kfintech");
    const fr = await waitImport(ck.o1, retry.json?.importId);
    check("Redis back: the same file imports normally", fr.status === "completed" && fr.rows_imported === 1, `${fr.status}`);
  }

  // 7. S3 unreachable from the worker; the file is kept; recovery by re-import.
  {
    await stopWorker(w1);
    w1 = startWorker({ S3_ENDPOINT: "http://127.0.0.1:9", S3_CONNECT_TIMEOUT_MS: "1000", S3_REQUEST_TIMEOUT_MS: "2000" });
    await sleep(6000);
    const r = await upload(ck.o1, "s3_down.csv", csvOf(MFSD201_HEADER, [kfinRow("993001", "98000001", PAN.a1)]), "daily_transaction_feed", "kfintech");
    const f = await waitImport(ck.o1, r.json?.importId, 180_000);
    check("S3 unreachable: the import fails with a recorded reason (BullMQ retried it), nothing posted", ["failed", "timeout"].includes(f.status) && !(await one(`SELECT 1 x FROM transactions WHERE tenant_id = $1 AND order_id = '993001'`, [T1])), `${f.status}`);
    check("S3 unreachable: the uploaded file is kept for the retry", await objectExists(r.key!));
    await stopWorker(w1); w1 = startWorker(); await sleep(6000);
    const re = await api(`/api/rta-imports/${r.json?.importId}/reimport`, ck.o1, {});
    const f2 = await waitImport(ck.o1, r.json?.importId);
    check("S3 back: re-import of the kept file completes", re.status < 300 && f2.status === "completed", `HTTP ${re.status}, ${f2.status}`);
  }

  // 8. Database unavailable to the worker; BullMQ retries until it returns.
  {
    await stopWorker(w1);
    const r = await upload(ck.o1, "db_down.csv", csvOf(MFSD201_HEADER, [kfinRow("994001", "98000001", PAN.a1)]), "daily_transaction_feed", "kfintech");
    const role = new URL(env.DATABASE_URL!).username;
    await admin.query(`ALTER ROLE ${role} NOLOGIN`);
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1 AND pid <> pg_backend_pid()`, [role]);
    w1 = startWorker();
    await sleep(7000);
    await admin.query(`ALTER ROLE ${role} LOGIN`);
    const f = await waitImport(ck.o1, r.json?.importId, 180_000);
    const n = await one(`SELECT count(*)::int n FROM transactions WHERE tenant_id = $1 AND order_id = '994001'`, [T1]);
    check("database unreachable then back: the job is retried and posts once", f.status === "completed" && n.n === 1, `${f.status}, ${n.n}`);
  }

  // 9. Permission and tenant-isolation failures.
  {
    // An RM holds transactions.execute by default (rbac.ts); marketing does not.
    const mk = await api("/api/rta-imports/upload-url", ck.mk1, { filename: "x.csv" });
    check("a user without the import capability cannot get an upload URL", mk.status === 403, `HTTP ${mk.status}`);
    const t1Import = (await one(`SELECT id FROM rta_file_imports WHERE tenant_id = $1 LIMIT 1`, [T1])).id;
    const cross = await api(`/api/rta-imports/${t1Import}`, ck.o2);
    check("another firm's import is not found", cross.status === 404, `HTTP ${cross.status}`);
    const wrongKey = await api("/api/rta-imports/upload", ck.o1, { source: "kfintech", kind: "daily_transaction_feed", key: `tenants/${T2}/rta/x.csv`, filename: "x.csv" });
    check("an upload naming another firm's storage key is refused", wrongKey.status === 403, `HTTP ${wrongKey.status}`);
    const op = await api("/api/super-admin/rta-pipeline", ck.o1, { action: "halt", scope: "global", reason: "tenant owner trying to halt everything" });
    // Operator controls need a PLATFORM session (a separate cookie): a firm session gets 401.
    check("a firm owner cannot use the operator controls", op.status === 401 || op.status === 403, `HTTP ${op.status}`);
    const res = await api(`/api/rta-staging/economic/${randomUUID()}/resolve`, ck.mk1, { investorId: randomUUID(), note: "not allowed" });
    check("a user without the import capability cannot resolve held transactions", res.status === 403, `HTTP ${res.status}`);
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
    check("mail: the poller read all three stored mails from S3", p.processed === 3, JSON.stringify(p));
    let imported = false;
    for (let i = 0; i < 90 && !imported; i++) { imported = !!(await one(`SELECT 1 x FROM transactions WHERE tenant_id = $1 AND order_id = '996001'`, [T1])); if (!imported) await sleep(1000); }
    check("mail: the trusted registrar mail is routed by alias to its firm and imported through the queue", imported);
    const held = await s3.send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET!, Prefix: "rta-inbound-held/" }));
    const heldKeys = (held.Contents ?? []).map((o) => o.Key);
    check("mail: forged and unroutable mail are held (kept, retried), never imported", heldKeys.length === 2 && !(await one(`SELECT 1 x FROM transactions WHERE order_id IN ('996002', '996003')`)), `${heldKeys.length} held`);
  }

  // 11. Privacy: no PAN in logs, staging or import remarks.
  {
    await stopWorker(w1);
    log.end();
    await sleep(500);
    const logs = readFileSync(logPath, "utf8") + (env.NEXT_LOG && existsSync(env.NEXT_LOG) ? readFileSync(env.NEXT_LOG, "utf8") : "");
    const leaked = Object.values(PAN).filter((p) => logs.includes(p));
    check("privacy: no PAN in worker or server logs", leaked.length === 0, `${leaked.length} found, ${logs.length} bytes scanned`);
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
    check("privacy: staging holds no PAN (keyed tokens only)", exact.n === 0 && shaped.n === 0, `input PANs found ${exact.n}, PAN-shaped values outside keyed columns ${shaped.n}`);
    const rem = await one(`SELECT count(*)::int n FROM rta_file_imports WHERE tenant_id IN ($1, $2) AND (coalesce(remarks, '') || coalesce(errors::text, '')) ~ '[A-Z]{5}[0-9]{4}[A-Z]'`, [T1, T2]);
    check("privacy: import remarks and errors are PAN-masked", rem.n === 0, `${rem.n}`);
  }

  // 12. Final statuses: every import ended in a final state.
  {
    const st = (await admin.query(`SELECT status, count(*)::int n FROM rta_file_imports WHERE tenant_id IN ($1, $2) GROUP BY 1`, [T1, T2])).rows;
    const stuck = st.filter((s: any) => !FINAL.has(s.status)).reduce((a: number, s: any) => a + s.n, 0);
    check("every import reached a final status (none left parsing / queued)", stuck === 0, JSON.stringify(st));
  }

  for (const w of workers) await stopWorker(w);
  await admin.end();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed  (firms ${T1} · ${T2})`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(String(e?.stack ?? e).replace(/[A-Z]{5}[0-9]{4}[A-Z]/g, "<pan>")); process.exit(1); });
