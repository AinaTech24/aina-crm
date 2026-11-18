/**
 * Map the scheme names Zoho business arrived with to the firm's Scheme Master
 * (We Care Freedom Wealth, 2026-11-18). Only lines of entries the Zoho import
 * made ("Zoho MFT…" in the entry's notes), on mutual-fund entries, that have no
 * scheme code yet.
 *
 *  - previewSchemeMapping: every distinct name (scheme and switch/STP "from"
 *    scheme) with how many lines carry it and the matcher's answer
 *    (scheme-match.ts): exact family match, a close suggestion for a person to
 *    accept, or none.
 *  - applySchemeMapping: for each name → Scheme Master code a person confirmed,
 *    the lines get the code, the master's name, AMC and category and the asset
 *    class that category means; the Zoho name stays in the line's notes. Each
 *    touched entry's asset mix and liquid net are recomputed from its lines.
 *    Only codes in the firm's own Scheme Master are accepted.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { classifyAssetClass } from "@/lib/business/asset-class";
import { computeTotals, normalizeLine, type LineInputT } from "@/lib/business/entry-input";
import { buildSchemeIndex, matchScheme, type MasterScheme } from "./scheme-match";
import type { ImportActor } from "./run-contacts";

const ZOHO_LINES = sql`
  FROM business_entry_lines l JOIN business_entries e ON e.id = l.entry_id AND e.tenant_id = l.tenant_id
`;

export type SchemeRow = {
  name: string;
  lines: number;
  confidence: "exact" | "close" | "none";
  score: number;
  scheme: { code: string; name: string; amc: string | null; category: string | null; plan: string | null } | null;
  nearest?: string;
};

export type SchemePreview = { masterCount: number; rows: SchemeRow[] };

async function loadMaster(tx: Tx, tenantId: string): Promise<MasterScheme[]> {
  return (await tx.execute(sql`
    SELECT s.scheme_code, s.scheme_name, COALESCE(a.name, s.amc_code) AS amc_code, s.category, s.plan, s.option, s.is_closed
      FROM scheme_master s
      LEFT JOIN amc_master a ON a.tenant_id = s.tenant_id AND a.code = s.amc_code
     WHERE s.tenant_id = ${tenantId}::uuid AND s.is_active = true
  `)).rows as MasterScheme[];
}

export async function previewSchemeMapping(tx: Tx, tenantId: string): Promise<SchemePreview> {
  const names = (await tx.execute(sql`
    SELECT name, SUM(n)::int AS lines FROM (
      SELECT l.scheme_name AS name, COUNT(*) AS n ${ZOHO_LINES}
       WHERE l.tenant_id = ${tenantId}::uuid AND e.product_type = 'mutual_fund' AND e.notes LIKE 'Zoho MFT%'
         AND l.scheme_code IS NULL AND l.scheme_name <> 'Scheme not recorded'
       GROUP BY 1
      UNION ALL
      SELECT l.from_scheme_name, COUNT(*) ${ZOHO_LINES}
       WHERE l.tenant_id = ${tenantId}::uuid AND e.product_type = 'mutual_fund' AND e.notes LIKE 'Zoho MFT%'
         AND l.from_scheme_code IS NULL AND l.from_scheme_name IS NOT NULL
       GROUP BY 1
    ) x GROUP BY name ORDER BY 2 DESC
  `)).rows as Array<{ name: string; lines: number }>;
  const master = await loadMaster(tx, tenantId);
  const idx = buildSchemeIndex(master);
  return {
    masterCount: master.length,
    rows: names.map((n) => {
      const m = matchScheme(n.name, idx);
      return {
        name: n.name,
        lines: Number(n.lines),
        confidence: m.confidence,
        score: m.score,
        scheme: m.scheme
          ? { code: m.scheme.scheme_code, name: m.scheme.scheme_name, amc: m.scheme.amc_code, category: m.scheme.category, plan: m.scheme.plan }
          : null,
        nearest: m.nearest,
      };
    }),
  };
}

export type SchemeApplyResult = { names: number; lines: number; fromLines: number; entries: number; rejected: string[] };

export async function applySchemeMapping(tx: Tx, actor: ImportActor, mappings: Array<{ name: string; schemeCode: string }>): Promise<SchemeApplyResult> {
  const master = new Map((await loadMaster(tx, actor.tenantId)).map((m) => [m.scheme_code, m]));
  const result: SchemeApplyResult = { names: 0, lines: 0, fromLines: 0, entries: 0, rejected: [] };
  const touched = new Set<string>();

  for (const { name, schemeCode } of mappings) {
    const m = master.get(schemeCode);
    if (!m) {
      result.rejected.push(name);
      continue;
    }
    const assetClass = classifyAssetClass(m.category, m.scheme_name);
    const r1 = (await tx.execute(sql`
      UPDATE business_entry_lines AS l
         SET scheme_code = ${m.scheme_code}, scheme_name = ${m.scheme_name}, amc_name = ${m.amc_code}, asset_category = ${m.category},
             asset_class = ${assetClass},
             notes = CASE WHEN COALESCE(l.notes, '') LIKE 'Zoho: %' THEN l.notes
                          ELSE CONCAT_WS(' · ', ${`Zoho: ${name}`}::text, NULLIF(l.notes, '')) END,
             updated_at = now()
        FROM business_entries e
       WHERE e.id = l.entry_id AND e.tenant_id = l.tenant_id AND l.tenant_id = ${actor.tenantId}::uuid
         AND e.product_type = 'mutual_fund' AND e.notes LIKE 'Zoho MFT%'
         AND l.scheme_code IS NULL AND l.scheme_name = ${name}
      RETURNING l.entry_id
    `)).rows as Array<{ entry_id: string }>;
    const r2 = (await tx.execute(sql`
      UPDATE business_entry_lines AS l
         SET from_scheme_code = ${m.scheme_code}, from_scheme_name = ${m.scheme_name}, from_asset_class = ${assetClass}, updated_at = now()
        FROM business_entries e
       WHERE e.id = l.entry_id AND e.tenant_id = l.tenant_id AND l.tenant_id = ${actor.tenantId}::uuid
         AND e.product_type = 'mutual_fund' AND e.notes LIKE 'Zoho MFT%'
         AND l.from_scheme_code IS NULL AND l.from_scheme_name = ${name}
      RETURNING l.entry_id
    `)).rows as Array<{ entry_id: string }>;
    if (r1.length || r2.length) result.names++;
    result.lines += r1.length;
    result.fromLines += r2.length;
    for (const r of [...r1, ...r2]) touched.add(r.entry_id);
  }

  // Each touched entry's asset mix and liquid net, from its lines as they are now.
  const ids = [...touched];
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    const lines = (await tx.execute(sql`
      SELECT entry_id, scheme_name, txn_type, amount, asset_class, from_scheme_name, from_asset_class
        FROM business_entry_lines
       WHERE tenant_id = ${actor.tenantId}::uuid AND entry_id = ANY(ARRAY[${sql.join(part.map((id) => sql`${id}`), sql`, `)}]::uuid[])
    `)).rows as Array<{ entry_id: string; scheme_name: string; txn_type: string; amount: string; asset_class: string; from_scheme_name: string | null; from_asset_class: string | null }>;
    const byEntry = new Map<string, LineInputT[]>();
    for (const l of lines) {
      if (!byEntry.has(l.entry_id)) byEntry.set(l.entry_id, []);
      byEntry.get(l.entry_id)!.push({
        schemeName: l.scheme_name,
        txnType: l.txn_type as LineInputT["txnType"],
        amount: Number(l.amount) || 0,
        assetClass: l.asset_class as LineInputT["assetClass"],
        fromSchemeName: l.from_scheme_name,
        fromAssetClass: (l.from_asset_class as LineInputT["fromAssetClass"]) ?? null,
      });
    }
    for (const [entryId, ls] of byEntry) {
      const t = computeTotals(ls.map(normalizeLine));
      await tx.execute(sql`
        UPDATE business_entries SET asset_breakup = ${JSON.stringify(t.assetBreakup)}::jsonb, liquid_net = ${String(t.liquidNet)}, updated_at = now()
         WHERE id = ${entryId}::uuid AND tenant_id = ${actor.tenantId}::uuid
      `);
    }
  }
  result.entries = touched.size;

  await recordAudit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "business_entry.scheme_mapping",
    entityType: "business_entry",
    entityId: null,
    meta: { source: "zoho_mf_transactions", names: result.names, lines: result.lines, fromLines: result.fromLines, entries: result.entries, rejected: result.rejected.length },
  });
  return result;
}
