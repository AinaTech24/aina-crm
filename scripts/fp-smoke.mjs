/**
 * FintechPrimitives sandbox smoke test.
 *
 *   node scripts/fp-smoke.mjs              # auth + list folios (read-only)
 *   node scripts/fp-smoke.mjs <file>       # also: upload + transaction_processing
 *
 * Validates the exact endpoints the FP client (src/lib/fp/client.ts) targets,
 * against the live sandbox, without booting the app. Reads FP_* from .env.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const BASE = (process.env.FP_BASE_URL ?? "https://s.finprim.com").replace(/\/+$/, "");
const TENANT = process.env.FP_TENANT;
const CLIENT_ID = process.env.FP_CLIENT_ID;
const CLIENT_SECRET = process.env.FP_CLIENT_SECRET;

if (!TENANT || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing FP_TENANT / FP_CLIENT_ID / FP_CLIENT_SECRET in .env");
  process.exit(1);
}

async function token() {
  const res = await fetch(`${BASE}/v2/auth/${TENANT}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`auth ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

async function api(tok, method, path, { body, headers } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tok}`, "x-tenant-id": TENANT, ...headers },
    body,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

const tok = await token();
console.log(`✓ auth ok (${tok.length} char token)`);

const folios = await api(tok, "GET", "/v2/mf_folios?count=1000");
const folioList = Array.isArray(folios.json) ? folios.json : folios.json?.data ?? [];
console.log(`✓ GET /v2/mf_folios → HTTP ${folios.status}, ${folioList.length} folio(s)`);

const ops = await api(tok, "GET", "/file_operations");
console.log(`✓ GET /file_operations → HTTP ${ops.status}, ${ops.json?.data?.length ?? 0} op(s)`);

const filePath = process.argv[2];
if (!filePath) {
  console.log("\n(no file argument — skipping upload. Pass a reverse-feed file to test transaction_processing.)");
  process.exit(0);
}

const bytes = readFileSync(filePath);
// FP rejects text/plain — send feed files as text/csv (matches the FP client).
const ext = basename(filePath).toLowerCase().split(".").pop();
const ctype = ext === "xls" ? "application/vnd.ms-excel"
  : ext === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  : "text/csv";
const form = new FormData();
form.append("file", new Blob([bytes], { type: ctype }), basename(filePath));
const up = await api(tok, "POST", "/files", { body: form });
console.log(`\n✓ POST /files → HTTP ${up.status}`, up.json);
const fileId = up.json?.id;
if (!fileId) process.exit(1);

const op = await api(tok, "POST", "/file_operations", {
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "transaction_processing", file: fileId }),
});
console.log(`✓ POST /file_operations → HTTP ${op.status}`, op.json);
const opId = op.json?.id;
if (!opId) process.exit(1);

for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const got = await api(tok, "GET", `/file_operations/${opId}`);
  const st = got.json?.status;
  console.log(`  poll ${i + 1}: status=${st} processed=${got.json?.processed} failed=${got.json?.failed}`);
  if (st === "processed" || st === "failed") break;
}

const folios2 = await api(tok, "GET", "/v2/mf_folios?count=1000");
const list2 = Array.isArray(folios2.json) ? folios2.json : folios2.json?.data ?? [];
console.log(`\n✓ folios after processing: ${list2.length}`);
if (list2.length) {
  const nums = list2.map((f) => f.number).filter(Boolean).slice(0, 25).join(",");
  const today = new Date().toISOString().slice(0, 10);
  const txns = await api(tok, "GET", `/transactions?folios=${encodeURIComponent(nums)}&from=2000-01-01&to=${today}`);
  const txList = Array.isArray(txns.json) ? txns.json : txns.json?.data ?? [];
  console.log(`✓ GET /transactions → HTTP ${txns.status}, ${txList.length} txn(s)`);
  if (txList[0]) console.log("  sample:", JSON.stringify(txList[0], null, 2).slice(0, 800));
}
