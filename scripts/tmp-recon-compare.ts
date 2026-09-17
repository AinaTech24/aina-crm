/**
 * READ-ONLY: reconcile the registrar AUM statements against the CRM folio
 * register so the dashboard gap is attributed to causes rather than guessed at.
 *
 * IMPORTANT: file rows are aggregated by (folio, scheme) FIRST. A holding split
 * across two of the firm's ARNs appears as two rows in the mailback files (one
 * per broker code) but as a single leg in the CRM, so comparing row-to-leg
 * counts the CRM side twice and invents a discrepancy that is not there.
 *
 * Reads flattened file rows from RECON_IN. Writes nothing.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";

const T = "27cac3b0-0407-4592-bb04-22af15b04f2b";
const IN = process.env.RECON_IN ?? "/app/scripts/recon-files.json";
const q = async (s: any) => (await withSystem(async (tx) => (await tx.execute(s)).rows as any[]));
const cr = (n: number) => "Rs " + (n / 1e7).toFixed(2) + " Cr";
const pad = (s: any, n: number) => String(s ?? "").padEnd(n);
const nFolio = (s: any) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, "");
const nCode = (s: any) => String(s ?? "").trim().toUpperCase();
const nName = (s: any) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

type FileRow = { rta: string; arn: string; folio: string; schemeCode: string; schemeName: string; value: number; units: number };

const main = async () => {
  const fileRows: FileRow[] = JSON.parse(readFileSync(IN, "utf8"));

  // ── File side, AGGREGATED across ARNs ───────────────────────────────────
  type Agg = { rta: string; folio: string; code: string; name: string; value: number; arns: Set<string> };
  const fileAgg = new Map<string, Agg>();
  for (const r of fileRows) {
    const k = nFolio(r.folio) + "|" + nCode(r.schemeCode);
    let a = fileAgg.get(k);
    if (!a) { a = { rta: r.rta, folio: nFolio(r.folio), code: nCode(r.schemeCode), name: r.schemeName, value: 0, arns: new Set() }; fileAgg.set(k, a); }
    a.value += r.value;
    a.arns.add(r.arn);
  }
  console.log("file rows " + fileRows.length + "  ->  " + fileAgg.size + " distinct (folio, scheme) holdings");

  // ── CRM side, one entry per (folio, scheme) ─────────────────────────────
  const crmLegs = await q(sql`
    SELECT f.folio_number, f.rta,
           leg->>'schemeCode' AS scheme_code,
           leg->>'schemeName' AS scheme_name,
           COALESCE(NULLIF(leg->>'value','')::numeric, 0) AS value
      FROM folios f
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(f.schemes,'[]'::jsonb)) leg ON true
     WHERE f.tenant_id = ${T}::uuid`);

  const crmByLeg = new Map<string, number>();
  const crmByName = new Map<string, number>();
  const crmFolios = new Set<string>();
  let crmTotal = 0;
  for (const r of crmLegs) {
    const fo = nFolio(r.folio_number);
    crmFolios.add(fo);
    const v = Number(r.value) || 0;
    crmTotal += v;
    if (r.scheme_code) { const k = fo + "|" + nCode(r.scheme_code); crmByLeg.set(k, (crmByLeg.get(k) ?? 0) + v); }
    if (r.scheme_name) { const k = fo + "|" + nName(r.scheme_name); crmByName.set(k, (crmByName.get(k) ?? 0) + v); }
  }
  console.log("crm legs  " + crmLegs.length + "  totalling " + cr(crmTotal));

  // ── Compare holding by holding ──────────────────────────────────────────
  type B = { n: number; fileV: number; crmV: number };
  const mk = (): B => ({ n: 0, fileV: 0, crmV: 0 });
  const b = {
    folio_absent: mk(), scheme_absent: mk(), equal: mk(),
    crm_lower: mk(), crm_higher: mk(), zero_in_file: mk(),
  };
  const worst: Array<{ rta: string; folio: string; code: string; name: string; f: number; c: number; arns: number }> = [];
  const matchedCrmKeys = new Set<string>();

  for (const a of fileAgg.values()) {
    const kCode = a.folio + "|" + a.code;
    const kName = a.folio + "|" + nName(a.name);
    const hit = crmByLeg.has(kCode) ? kCode : (crmByName.has(kName) ? kName : null);
    const crmV = hit ? (crmByLeg.get(hit) ?? crmByName.get(hit)!) : undefined;
    if (hit) matchedCrmKeys.add(hit);
    const push = (x: B) => { x.n++; x.fileV += a.value; x.crmV += crmV ?? 0; };

    if (a.value === 0) { push(b.zero_in_file); continue; }
    if (!crmFolios.has(a.folio)) { push(b.folio_absent); continue; }
    if (crmV === undefined) { push(b.scheme_absent); continue; }
    const d = a.value - crmV;
    if (Math.abs(d) <= 1) push(b.equal);
    else {
      push(d > 0 ? b.crm_lower : b.crm_higher);
      worst.push({ rta: a.rta, folio: a.folio, code: a.code, name: a.name, f: a.value, c: crmV, arns: a.arns.size });
    }
  }

  console.log("\n=== EVERY HOLDING IN THE FILES, vs WHAT THE CRM HAS ===");
  console.log("  " + pad("bucket", 18) + pad("holdings", 11) + pad("file value", 16) + "crm value");
  let ft = 0;
  for (const [k, x] of Object.entries(b)) { ft += x.fileV; console.log("  " + pad(k, 18) + pad(x.n, 11) + pad(cr(x.fileV), 16) + cr(x.crmV)); }
  console.log("  " + pad("TOTAL", 18) + pad(fileAgg.size, 11) + cr(ft));

  const missing = b.folio_absent.fileV + b.scheme_absent.fileV;
  const under = b.crm_lower.fileV - b.crm_lower.crmV;
  const over = b.crm_higher.crmV - b.crm_higher.fileV;
  console.log("\n=== THE GAP, ATTRIBUTED ===");
  console.log("  not in the CRM at all          : " + pad(cr(missing), 14) + "(" + b.folio_absent.n + " folios + " + b.scheme_absent.n + " schemes)");
  console.log("  CRM values it LOWER than file  : " + pad(cr(under), 14) + "(" + b.crm_lower.n + " holdings)");
  console.log("  CRM values it HIGHER than file : " + pad(cr(over), 14) + "(" + b.crm_higher.n + " holdings)");
  console.log("  ------------------------------------------------");
  console.log("  net CRM shortfall vs files     : " + cr(missing + under - over));

  console.log("\n=== PER REGISTRAR ===");
  for (const rta of ["cams", "kfintech"]) {
    let miss = 0, lo = 0, hi = 0, fv = 0;
    for (const a of fileAgg.values()) {
      if (a.rta !== rta || a.value === 0) continue;
      fv += a.value;
      const crmV = crmByLeg.get(a.folio + "|" + a.code) ?? crmByName.get(a.folio + "|" + nName(a.name));
      if (crmV === undefined) { miss += a.value; continue; }
      if (a.value > crmV) lo += a.value - crmV; else hi += crmV - a.value;
    }
    console.log("  " + pad(rta, 10) + "file " + pad(cr(fv), 15) + "missing " + pad(cr(miss), 14) +
      "under " + pad(cr(lo), 14) + "over " + cr(hi));
  }

  console.log("\n=== 12 BIGGEST SINGLE DISCREPANCIES ===");
  worst.sort((x, y) => Math.abs(y.f - y.c) - Math.abs(x.f - x.c));
  for (const w of worst.slice(0, 12))
    console.log("  " + pad(w.rta, 9) + pad(w.folio, 15) + pad(w.code, 8) + "arns=" + w.arns +
      "  file " + pad(Math.round(w.f), 11) + "crm " + pad(Math.round(w.c), 11) + w.name.slice(0, 34));

  console.log("\n=== WHAT THE CRM HOLDS THAT THESE FILES DO NOT ===");
  let onlyV = 0, onlyN = 0;
  for (const [k, v] of crmByLeg) if (!matchedCrmKeys.has(k)) { onlyV += v; onlyN++; }
  console.log("  crm legs unmatched by any file row: " + onlyN + "   " + cr(onlyV));
  console.log("  (these files cover only 3 ARNs at one date — some of this is legitimate)");
};

main().then(() => process.exit(0)).catch((e) => {
  const c: any = (e as any)?.cause ?? e;
  console.error("FAILED:", c?.message ?? e, String(e?.stack ?? "").slice(0, 500));
  process.exit(1);
});
