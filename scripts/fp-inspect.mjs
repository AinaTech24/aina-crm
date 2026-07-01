/**
 * FintechPrimitives REAL-DATA fidelity inspector (READ-ONLY).
 *
 *   node scripts/fp-inspect.mjs
 *
 * Run this AFTER Cybrilla seeds the sandbox (or a real feed lands). It pulls the
 * real folios + transactions from the FP API and reports exactly how the real
 * responses compare to what src/lib/fp/import.ts assumes — WITHOUT writing a
 * single row. Use the "MAPPING RISKS" section to harden the importer before any
 * real upsert.
 *
 * Reads FP_* from .env. Nothing is mutated in FP or in your DB.
 */
import "dotenv/config";

const BASE = (process.env.FP_BASE_URL ?? "https://s.finprim.com").replace(/\/+$/, "");
const TENANT = process.env.FP_TENANT;
const CLIENT_ID = process.env.FP_CLIENT_ID;
const CLIENT_SECRET = process.env.FP_CLIENT_SECRET;

// Kept in sync with mapFpType() in src/lib/fp/import.ts — anything NOT here maps
// to a coarse fallback and should be reviewed.
const KNOWN_TYPES = new Set([
  "purchase", "redemption", "switch_in", "switch_out",
  "transfer_in", "transfer_out", "dividend_payout", "dividend_reinvestment", "bonus",
]);
const OUTFLOW_TYPES = new Set(["redemption", "switch_out", "transfer_out", "dividend_payout"]);

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
async function api(tok, path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${tok}`, "x-tenant-id": TENANT } });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "—");
function presence(rows, fields) {
  const out = {};
  for (const f of fields) out[f] = rows.filter((r) => r[f] !== null && r[f] !== undefined && r[f] !== "").length;
  return out;
}

const tok = await token();
console.log(`✓ auth ok · tenant=${TENANT} · base=${BASE}\n`);

// ── Folios ───────────────────────────────────────────────────────────────────
const fres = await api(tok, "/v2/mf_folios?count=1000");
const folioEnvelope = Array.isArray(fres.json) ? "array" : (fres.json && typeof fres.json === "object" ? Object.keys(fres.json).join(",") : typeof fres.json);
const folios = Array.isArray(fres.json) ? fres.json : (fres.json?.data ?? []);
console.log("══ FOLIOS ══════════════════════════════════════════════");
console.log(`HTTP ${fres.status} · envelope=[${folioEnvelope}] · count=${folios.length}${folios.length >= 1000 ? "  ⚠ HIT 1000 CAP — pagination needed" : ""}`);
if (folios.length) {
  const fp = presence(folios, ["amc", "number", "primary_investor_pan", "primary_investor_name", "holding_pattern"]);
  for (const [k, v] of Object.entries(fp)) console.log(`  ${k.padEnd(24)} present ${v}/${folios.length} (${pct(v, folios.length)})`);
  console.log(`  unique extra keys seen: ${[...new Set(folios.flatMap((f) => Object.keys(f)))].join(", ")}`);
}

// ── Transactions ─────────────────────────────────────────────────────────────
const folioNos = [...new Set(folios.map((f) => f.number).filter(Boolean))];
const today = new Date().toISOString().slice(0, 10);
let txns = [];
let txEnvelope = "n/a";
for (let i = 0; i < folioNos.length; i += 25) {
  const batch = folioNos.slice(i, i + 25).join(",");
  const r = await api(tok, `/transactions?folios=${encodeURIComponent(batch)}&from=2000-01-01&to=${today}`);
  if (i === 0) txEnvelope = Array.isArray(r.json) ? "array" : (r.json && typeof r.json === "object" ? Object.keys(r.json).join(",") : typeof r.json);
  const data = Array.isArray(r.json) ? r.json : (r.json?.data ?? []);
  txns.push(...data);
}
console.log("\n══ TRANSACTIONS ════════════════════════════════════════");
console.log(`envelope=[${txEnvelope}] · count=${txns.length}`);
if (txns.length) {
  const tp = presence(txns, ["folio_number", "isin", "type", "amount", "units", "traded_on", "traded_at", "rta_order_reference", "rta_scheme_name", "rta_product_code"]);
  for (const [k, v] of Object.entries(tp)) {
    const warn = v < txns.length ? `  ⚠ ${txns.length - v} missing` : "";
    console.log(`  ${k.padEnd(22)} present ${v}/${txns.length} (${pct(v, txns.length)})${warn}`);
  }
  // Types
  const byType = {};
  for (const t of txns) byType[t.type] = (byType[t.type] ?? 0) + 1;
  console.log("\n  by type:");
  for (const [t, n] of Object.entries(byType)) console.log(`    ${t.padEnd(22)} ${n}${KNOWN_TYPES.has(t) ? "" : "   ⚠ UNKNOWN → falls back to purchase/inflow"}`);
  // FIFO sources / capital gains
  const outflows = txns.filter((t) => OUTFLOW_TYPES.has(t.type));
  const withSources = outflows.filter((t) => Array.isArray(t.sources) && t.sources.length);
  const withGain = withSources.filter((t) => t.sources.some((s) => s.gain !== null && s.gain !== undefined));
  console.log("\n  capital-gains (outflows):");
  console.log(`    outflows: ${outflows.length} · with sources[]: ${withSources.length} (${pct(withSources.length, outflows.length)}) · with gain field: ${withGain.length}`);
  if (withSources[0]) console.log(`    sample source keys: ${Object.keys(withSources[0].sources[0]).join(", ")}`);
  // Dates + dedup
  const dates = txns.map((t) => t.traded_on).filter(Boolean).sort();
  console.log(`\n  traded_on range: ${dates[0] ?? "?"} → ${dates[dates.length - 1] ?? "?"}`);
  const refs = txns.map((t) => t.rta_order_reference).filter(Boolean);
  const dupRefs = refs.length - new Set(refs).size;
  console.log(`  rta_order_reference: ${refs.length}/${txns.length} present · ${dupRefs} duplicate(s)${dupRefs ? "  ⚠ dedup_key also uses type/date/amount so still unique" : ""}`);
}

// ── Mapping risk summary ─────────────────────────────────────────────────────
console.log("\n══ MAPPING RISKS (review before real upsert) ═══════════");
const risks = [];
if (folios.length >= 1000) risks.push("Folio list hit the 1000 cap — add pagination to listFpMfFolios.");
if (folios.some((f) => !f.primary_investor_pan)) risks.push("Some folios have NO primary_investor_pan → their transactions will be SKIPPED (no investor match).");
const unknown = [...new Set(txns.map((t) => t.type).filter((t) => !KNOWN_TYPES.has(t)))];
if (unknown.length) risks.push(`Unknown transaction types → coarse fallback: ${unknown.join(", ")}`);
if (txns.some((t) => !t.folio_number)) risks.push("Some transactions have no folio_number → skipped.");
if (txns.some((t) => t.traded_at === null || t.traded_at === undefined)) risks.push("Some transactions have null NAV (traded_at).");
const out2 = txns.filter((t) => OUTFLOW_TYPES.has(t.type));
if (out2.length && out2.some((t) => !Array.isArray(t.sources) || !t.sources.length)) risks.push("Some outflows have NO sources[] → capital-gains will be ₹0 for them.");
if (!risks.length) console.log("  none detected — real data matches the importer's assumptions ✓");
else risks.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
console.log("");
process.exit(0);
