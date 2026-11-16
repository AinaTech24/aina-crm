/**
 * The firm's client fields for Zoho's columns — created as custom fields on the
 * client (Settings → Custom fields), so the client page and the Add / Edit client
 * forms show them. Used by the Contacts import AND by "Add the Zoho fields to the
 * client form" on the Zoho page, so a firm sees every field before importing.
 *
 *  - Every field in CONTACT_CUSTOM_FIELDS is created if missing (firm-only rows).
 *  - Lead Source and Salutation are picklists (contacts.ts PICKLISTS): the list is
 *    what the firm already has, the CRM's values, the values already stored on
 *    clients and the file's values. A text field of the same key from an earlier
 *    run becomes the picklist, and a stored value that now reads as a list entry
 *    ("referral" → "Client Referral") is rewritten to it.
 *  - A field the firm has renamed or reordered keeps its label and position.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { customFieldDefs } from "@/db/schema";
import { CONTACT_CUSTOM_FIELDS, PICKLISTS, picklistOption, picklistOptions } from "./contacts";

export type PicklistResult = { label: string; options: string[]; addedFromFile: string[]; convertedFromText: boolean };

export type FieldsResult = {
  created: string[];
  /** By custom-field key. */
  picklists: Record<string, PicklistResult>;
  /** By custom-field key: Zoho value → the list entry it becomes. */
  placeOn: Record<string, Map<string, string>>;
};

export async function ensureZohoClientFields(
  tx: Tx,
  tenantId: string,
  userId: string,
  /** Picklist values in the file being imported, by custom-field key. */
  fileValues: Record<string, string[]> = {}
): Promise<FieldsResult> {
  const defs = (await tx.execute(sql`
    SELECT id, key, type, options, sort_order FROM custom_field_defs
     WHERE tenant_id = ${tenantId}::uuid AND entity = 'investor'
  `)).rows as Array<{ id: string; key: string; type: string; options: string[] | null; sort_order: number }>;
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const result: FieldsResult = { created: [], picklists: {}, placeOn: {} };

  for (const pl of PICKLISTS) {
    const key = pl.field.key;
    const def = byKey.get(key);
    const stored = ((await tx.execute(sql`
      SELECT DISTINCT custom_fields->>${key} AS v FROM investors
       WHERE tenant_id = ${tenantId}::uuid AND custom_fields ? ${key}
    `)).rows as Array<{ v: string | null }>).map((r) => r.v ?? "").filter(Boolean);
    const file = fileValues[key] ?? [];
    const options = picklistOptions(def?.options ?? [], pl.base, [...stored, ...file], pl.aliases);
    const without = picklistOptions(def?.options ?? [], pl.base, stored, pl.aliases);
    result.picklists[key] = {
      label: pl.field.label,
      options,
      addedFromFile: options.filter((o) => !without.includes(o)),
      convertedFromText: !!def && def.type !== "select",
    };
    const place = new Map<string, string>();
    for (const v of file) place.set(v, picklistOption(v, options, pl.aliases));
    result.placeOn[key] = place;

    if (def && (def.type !== "select" || JSON.stringify(def.options ?? []) !== JSON.stringify(options))) {
      await tx.execute(sql`
        UPDATE custom_field_defs SET type = 'select', options = ${JSON.stringify(options)}::jsonb, updated_at = now()
         WHERE id = ${def.id}::uuid AND tenant_id = ${tenantId}::uuid
      `);
    }
    for (const v of new Set(stored)) {
      const to = picklistOption(v, options, pl.aliases);
      if (to === v) continue;
      await tx.execute(sql`
        UPDATE investors SET custom_fields = jsonb_set(custom_fields, ARRAY[${key}::text], to_jsonb(${to}::text)), updated_at = now()
         WHERE tenant_id = ${tenantId}::uuid AND custom_fields->>${key} = ${v}
      `);
    }
  }

  let sortOrder = defs.reduce((mx, d) => Math.max(mx, Number(d.sort_order) || 0), 0);
  for (const f of CONTACT_CUSTOM_FIELDS) {
    if (byKey.has(f.key)) continue;
    await tx.insert(customFieldDefs).values({
      tenantId,
      entity: "investor",
      key: f.key,
      label: f.label,
      type: f.type,
      options: result.picklists[f.key]?.options ?? null,
      required: false,
      sortOrder: ++sortOrder,
      createdBy: userId,
    });
    result.created.push(f.label);
  }
  return result;
}

/** How many of the Zoho client fields the firm already has. */
export async function zohoClientFieldsPresent(tx: Tx, tenantId: string): Promise<{ present: number; total: number }> {
  const keys = CONTACT_CUSTOM_FIELDS.map((f) => f.key);
  const r = (await tx.execute(sql`
    SELECT count(*)::int AS n FROM custom_field_defs
     WHERE tenant_id = ${tenantId}::uuid AND entity = 'investor'
       AND key = ANY(ARRAY[${sql.join(keys.map((k) => sql`${k}`), sql`, `)}]::text[])
  `)).rows[0] as { n: number } | undefined;
  return { present: Number(r?.n ?? 0), total: keys.length };
}
