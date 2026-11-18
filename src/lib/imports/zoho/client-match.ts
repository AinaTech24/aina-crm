/**
 * Which CRM client a Zoho contact is — shared by the family sheet and the
 * Meetings import (We Care Freedom Wealth, 2026-11-17/18).
 *
 *  - By Zoho Record ID first (custom field cf_zoho_record_id).
 *  - Else by EXACT name (any case, spacing or dots), only when exactly one live
 *    client in the CRM has that name and exactly one Zoho contact in the file
 *    does. A repeated name is reported with its reason, never guessed.
 *  - A client found by name gets the Zoho Record ID (stampZohoIds), so the next
 *    run matches it exactly.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { customFieldDefs } from "@/db/schema";
import { ZOHO_ID_FIELD } from "./contacts";
import { nameKey } from "./values";

export type CrmClient = { id: string; name: string; family_id: string | null; rm_id: string | null; zoho_id: string | null };

export type ClientMatcher = {
  /** The client for a Zoho contact id (its file name used for the name fallback), or undefined. */
  resolve: (zohoId: string) => CrmClient | undefined;
  /** Why a contact was not matched. */
  why: (zohoId: string) => string;
  matchedById: () => number;
  matchedByName: () => number;
  /** Clients found by name, to be given their Zoho Record ID. */
  stamps: () => Array<{ id: string; zoho: string }>;
};

/** Load the firm's live clients and build the matcher. `fileNames`: Zoho contact id → name as in the file. */
export async function loadClientMatcher(tx: Tx, tenantId: string, fileNames: Map<string, string>): Promise<ClientMatcher> {
  const clients = (await tx.execute(sql`
    SELECT id, name, family_id, rm_id, custom_fields->>${ZOHO_ID_FIELD.key} AS zoho_id
      FROM investors
     WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL
  `)).rows as CrmClient[];
  return buildClientMatcher(clients, fileNames);
}

/** Pure part — tested in tests/zoho-import.test.ts. */
export function buildClientMatcher(clients: CrmClient[], fileNames: Map<string, string>): ClientMatcher {
  const byZohoId = new Map(clients.filter((c) => c.zoho_id).map((c) => [c.zoho_id as string, c]));
  const crmNames = new Map<string, CrmClient | null>();
  for (const c of clients) {
    const k = nameKey(c.name);
    if (k) crmNames.set(k, crmNames.has(k) ? null : c);
  }
  // How many different Zoho contacts carry each name in the file.
  const fileNameIds = new Map<string, Set<string>>();
  for (const [zid, n] of fileNames) {
    const k = nameKey(n);
    if (!k) continue;
    if (!fileNameIds.has(k)) fileNameIds.set(k, new Set());
    fileNameIds.get(k)!.add(zid);
  }

  const resolved = new Map<string, CrmClient | undefined>();
  const reasons = new Map<string, string>();
  const stampList: Array<{ id: string; zoho: string }> = [];
  const stamped = new Set<string>();
  let byId = 0;
  let byName = 0;

  const resolve = (zoho: string): CrmClient | undefined => {
    if (resolved.has(zoho)) return resolved.get(zoho);
    let c = byZohoId.get(zoho);
    if (c) byId++;
    else {
      const k = nameKey(fileNames.get(zoho) ?? "");
      const hit = k ? crmNames.get(k) : undefined;
      if (!k) reasons.set(zoho, "no name on the row");
      else if (hit === undefined) reasons.set(zoho, "no client with this name in the CRM");
      else if (hit === null) reasons.set(zoho, "several clients in the CRM have this name");
      else if ((fileNameIds.get(k)?.size ?? 0) > 1) reasons.set(zoho, "several Zoho contacts in the file have this name");
      else if (hit.zoho_id && hit.zoho_id !== zoho) reasons.set(zoho, "the client with this name has a different Zoho Record ID");
      else if (stamped.has(hit.id)) reasons.set(zoho, "this client was already matched to another Zoho contact");
      else {
        c = hit;
        byName++;
        stamped.add(hit.id);
        stampList.push({ id: hit.id, zoho });
      }
    }
    resolved.set(zoho, c);
    return c;
  };

  return {
    resolve,
    why: (z) => reasons.get(z) ?? "not in the CRM",
    matchedById: () => byId,
    matchedByName: () => byName,
    stamps: () => stampList,
  };
}

/** Give clients found by name their Zoho Record ID (creating the field if the firm has none). */
export async function stampZohoIds(tx: Tx, tenantId: string, userId: string, stamps: Array<{ id: string; zoho: string }>): Promise<void> {
  if (!stamps.length) return;
  const has = (await tx.execute(sql`
    SELECT 1 FROM custom_field_defs WHERE tenant_id = ${tenantId}::uuid AND entity = 'investor' AND key = ${ZOHO_ID_FIELD.key}
  `)).rows.length;
  if (!has) {
    const next = (await tx.execute(sql`
      SELECT COALESCE(MAX(sort_order), 0)::int + 1 AS n FROM custom_field_defs WHERE tenant_id = ${tenantId}::uuid AND entity = 'investor'
    `)).rows[0] as { n: number };
    await tx.insert(customFieldDefs).values({
      tenantId,
      entity: "investor",
      key: ZOHO_ID_FIELD.key,
      label: ZOHO_ID_FIELD.label,
      type: "text",
      options: null,
      required: false,
      sortOrder: Number(next.n),
      createdBy: userId,
    });
  }
  for (let i = 0; i < stamps.length; i += 500) {
    const part = stamps.slice(i, i + 500);
    await tx.execute(sql`
      UPDATE investors AS inv
         SET custom_fields = COALESCE(inv.custom_fields, '{}'::jsonb) || jsonb_build_object(${ZOHO_ID_FIELD.key}::text, v.zoho),
             updated_at = now()
        FROM (VALUES ${sql.join(part.map((p) => sql`(${p.id}::uuid, ${p.zoho}::text)`), sql`, `)}) AS v(id, zoho)
       WHERE inv.id = v.id AND inv.tenant_id = ${tenantId}::uuid
         AND NOT (COALESCE(inv.custom_fields, '{}'::jsonb) ? ${ZOHO_ID_FIELD.key})
    `);
  }
}
