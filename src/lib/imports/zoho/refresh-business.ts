/**
 * Refresh Business Entries the Zoho MF Transaction import made earlier
 * (We Care Freedom Wealth, 2026-11-21). Zoho records change after they are
 * imported — a redemption is keyed the day it is placed and its amount typed
 * in once the registrar has paid out — and the plain import skips every MFT it
 * already holds, so those edits never reached the CRM (November: 28 MFTs,
 * ₹69 L of redemptions short).
 *
 * For an MFT already in the CRM, the file's version wins:
 *  - Unchanged (same date, notes, platform, owner, client and the same lines
 *    with the same amounts) → left alone.
 *  - Changed → the entry keeps its id and status; its date, notes, platform,
 *    RM (when the Zoho owner is a user) and client (when the Zoho client is
 *    found) follow Zoho, and its lines are rebuilt from the file. A line keeps
 *    the Scheme Master link the scheme-mapping step gave it (matched by the
 *    Zoho scheme name it records), so a refresh never undoes that work. The
 *    RTA outcome of rebuilt lines is decided again (rta-match).
 *  - Edited by a person in the CRM (a business_entry.update audit row) or
 *    cancelled → left as is, and listed, so a refresh never overwrites a
 *    correction made in the CRM.
 */

import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { businessEntryLines } from "@/db/schema";
import { computeTotals, normalizeLine, type LineInputT } from "@/lib/business/entry-input";
import type { PlannedEntry, PlannedLine } from "./business";

export type ExistingZohoEntry = {
  id: string;
  status: string;
  business_date: string;
  notes: string | null;
  platform: string | null;
  investor_id: string | null;
  client_name: string;
  rm_id: string | null;
};

export type RefreshItem = {
  planned: PlannedEntry;
  existing: ExistingZohoEntry;
  /** The CRM client the Zoho client resolves to, if found. */
  client: { id: string } | null;
  /** The user the Zoho owner is, if one matches. */
  ownerId: string | null;
};

export type RefreshResult = {
  refreshed: number;
  unchanged: number;
  keptAsIs: Array<{ mft: string; reason: string }>;
};

type OldLine = {
  id: string;
  entry_id: string;
  scheme_code: string | null;
  scheme_name: string;
  amc_name: string | null;
  asset_category: string | null;
  asset_class: string;
  txn_type: string;
  type_label: string | null;
  source_type: string | null;
  source_kind: string | null;
  amount: string;
  notes: string | null;
  folio_no: string | null;
  from_scheme_code: string | null;
  from_scheme_name: string | null;
  from_asset_class: string | null;
};

const idsJson = (ids: string[]) => JSON.stringify(ids);
const ZOHO_NAME = /^Zoho: ([^·]*?)(?: · |$)/;

/** The Zoho scheme name a line came with (the mapping step keeps it in the notes as "Zoho: …"). */
export function zohoSchemeName(l: { scheme_name: string; notes: string | null }): string {
  const m = (l.notes ?? "").match(ZOHO_NAME);
  return (m ? m[1] : l.scheme_name).trim();
}

/** A line's notes without the mapping step's "Zoho: …" prefix. */
export function zohoLineNotes(notes: string | null): string {
  return (notes ?? "").replace(ZOHO_NAME, "").trim();
}

const money = (v: unknown) => (Number(v) || 0).toFixed(2);

export function oldFingerprint(lines: OldLine[]): string {
  return JSON.stringify(
    lines.map((l) => [zohoSchemeName(l), l.txn_type, l.type_label ?? "", money(l.amount), l.source_type ?? "", l.source_kind ?? "", zohoLineNotes(l.notes)])
  );
}

export function plannedFingerprint(lines: PlannedLine[]): string {
  return JSON.stringify(
    lines.map((l) => [l.schemeName.trim(), l.txnType, l.typeLabel ?? "", money(l.amount), l.sourceType ?? "", l.sourceKind ?? "", (l.notes ?? "").trim()])
  );
}

export async function refreshZohoEntries(tx: Tx, tenantId: string, items: RefreshItem[]): Promise<RefreshResult> {
  const result: RefreshResult = { refreshed: 0, unchanged: 0, keptAsIs: [] };
  if (!items.length) return result;
  const keep = (mft: string, reason: string) => {
    if (result.keptAsIs.length < 500) result.keptAsIs.push({ mft, reason });
  };

  const ids = items.map((i) => i.existing.id);
  const edited = new Set(
    ((await tx.execute(sql`
      SELECT DISTINCT entity_id::text AS id FROM audit_log
       WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'business_entry' AND action = 'business_entry.update'
         AND entity_id IN (SELECT jsonb_array_elements_text(${idsJson(ids)}::jsonb)::uuid)
    `)).rows as Array<{ id: string }>).map((r) => r.id)
  );
  const linesByEntry = new Map<string, OldLine[]>();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = (await tx.execute(sql`
      SELECT id, entry_id, scheme_code, scheme_name, amc_name, asset_category, asset_class, txn_type, type_label,
             source_type, source_kind, amount, notes, folio_no, from_scheme_code, from_scheme_name, from_asset_class
        FROM business_entry_lines
       WHERE tenant_id = ${tenantId}::uuid
         AND entry_id IN (SELECT jsonb_array_elements_text(${idsJson(ids.slice(i, i + 500))}::jsonb)::uuid)
       ORDER BY entry_id, sort_order
    `)).rows as OldLine[];
    for (const r of rows) {
      const list = linesByEntry.get(r.entry_id) ?? [];
      list.push(r);
      linesByEntry.set(r.entry_id, list);
    }
  }

  for (const { planned: e, existing: ex, client, ownerId } of items) {
    if (ex.status === "cancelled") {
      keep(e.mft, "Cancelled in the CRM");
      continue;
    }
    if (edited.has(ex.id)) {
      keep(e.mft, "Edited in the CRM since the import");
      continue;
    }
    const old = linesByEntry.get(ex.id) ?? [];
    const investorId = client?.id ?? ex.investor_id;
    const rmId = ownerId ?? ex.rm_id;
    const same =
      ex.business_date === e.businessDate &&
      (ex.notes ?? "") === e.notes &&
      (ex.platform ?? null) === (e.platform ?? null) &&
      investorId === ex.investor_id &&
      rmId === ex.rm_id &&
      oldFingerprint(old) === plannedFingerprint(e.lines);
    if (same) {
      result.unchanged++;
      continue;
    }

    // Rebuild the lines, keeping each one's Scheme Master link.
    const used = new Set<string>();
    const pick = (l: PlannedLine) => {
      const name = l.schemeName.trim();
      const cands = old.filter((o) => !used.has(o.id) && zohoSchemeName(o) === name);
      const hit = cands.find((o) => o.txn_type === l.txnType) ?? cands[0];
      if (hit) used.add(hit.id);
      return hit;
    };
    const inputs: Array<{ input: LineInputT; plan: PlannedLine; prev: OldLine | undefined }> = e.lines.map((l) => {
      const prev = pick(l);
      const mapped = prev?.scheme_code ? prev : undefined;
      const fromMapped = prev?.from_scheme_code && l.fromSchemeName ? prev : undefined;
      return {
        plan: l,
        prev,
        input: {
          schemeCode: mapped?.scheme_code ?? null,
          schemeName: mapped ? mapped.scheme_name : l.schemeName,
          amcName: mapped?.amc_name ?? null,
          assetCategory: mapped?.asset_category ?? null,
          assetClass: (mapped?.asset_class as LineInputT["assetClass"]) ?? l.assetClass,
          txnType: l.txnType,
          typeLabel: l.typeLabel,
          amount: l.amount,
          frequency: l.frequency,
          sipDate: l.sipDate,
          fromSchemeCode: fromMapped?.from_scheme_code ?? null,
          fromSchemeName: fromMapped ? fromMapped.from_scheme_name : l.fromSchemeName,
          fromAssetClass: (fromMapped?.from_asset_class as LineInputT["fromAssetClass"]) ?? l.fromAssetClass,
          notes: mapped ? [`Zoho: ${l.schemeName.trim()}`, l.notes].filter(Boolean).join(" · ") : l.notes,
        },
      };
    });
    const lines = inputs.map((x) => normalizeLine(x.input));
    const totals = computeTotals(lines);

    try {
      await tx.transaction(async (sp) => {
        await sp.execute(sql`DELETE FROM business_entry_lines WHERE tenant_id = ${tenantId}::uuid AND entry_id = ${ex.id}::uuid`);
        if (lines.length) {
          await sp.insert(businessEntryLines).values(
            lines.map((l, i) => ({
              id: uuid(),
              tenantId,
              entryId: ex.id,
              schemeCode: l.schemeCode ?? null,
              schemeName: l.schemeName,
              amcName: l.amcName ?? null,
              assetCategory: l.assetCategory ?? null,
              assetClass: l.assetClass,
              txnType: l.txnType,
              typeLabel: l.typeLabel || null,
              sourceType: inputs[i].plan.sourceType ?? null,
              sourceKind: inputs[i].plan.sourceKind ?? null,
              amount: String(l.amount),
              frequency: l.frequency ?? null,
              sipDate: l.txnType === "sip" ? l.sipDate ?? null : null,
              fromSchemeCode: l.fromSchemeCode ?? null,
              fromSchemeName: l.fromSchemeName ?? null,
              fromAssetClass: l.fromAssetClass ?? null,
              folioNo: inputs[i].prev?.folio_no ?? null,
              notes: l.notes ?? null,
              sortOrder: i,
              ...(inputs[i].plan.rtaNotApplicable ? { rtaStatus: "not_applicable" as const, rtaNote: inputs[i].plan.rtaNotApplicable } : {}),
            }))
          );
        }
        await sp.execute(sql`
          UPDATE business_entries
             SET business_date = ${e.businessDate}::date, notes = ${e.notes}, platform = ${e.platform},
                 investor_id = ${investorId}::uuid,
                 client_name = ${(e.clientName || ex.client_name).slice(0, 200)},
                 rm_id = ${rmId}::uuid,
                 total_amount = ${String(totals.total)}, asset_breakup = ${JSON.stringify(totals.assetBreakup)}::jsonb,
                 liquid_net = ${String(totals.liquidNet)}, updated_at = now()
           WHERE tenant_id = ${tenantId}::uuid AND id = ${ex.id}::uuid
        `);
      });
      result.refreshed++;
    } catch (err) {
      keep(e.mft, `Could not be refreshed: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
    }
  }
  return result;
}
