/**
 * Fields a person can ADD as a column on the SIP Book list, beyond the ones the
 * table draws by default. Same shape as investor-fields.ts: each field is an
 * expression over fixed aliases — `s` (sips), `i` (the client), `ir` (the
 * client's RM), `b` (the client's branch), `fam` (the client's family), `m`
 * (the SIP's mandate), `fo` (its folio) — static text, never user input. A key
 * a cookie names that is not here is dropped.
 *
 * Values come back as display text (dates in India time, rupees formatted in
 * TypeScript, booleans Yes / No), so the table needs no per-field formatting.
 * SIPs have no custom fields of their own, so there is no `cf:` here.
 */
import { sql } from "drizzle-orm";
import { formatINR } from "@/lib/utils";
import { SIP_PER_MONTH } from "@/lib/metrics/sip";
import type { ExtraFieldDef } from "./types";

type Def = ExtraFieldDef & { expr: string; gate?: string; /** raw number text, shown as rupees */ inr?: boolean };

const D = (e: string) => `to_char(${e}, 'DD Mon YYYY')`;
const TS = (e: string) => `to_char(${e} AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY')`;
const YN = (e: string) => `CASE WHEN ${e} THEN 'Yes' ELSE 'No' END`;

/** Monthly-equivalent rupees, from the same table the SIP book total uses. */
const MONTHLY = `(s.amount::numeric * CASE s.frequency ${Object.entries(SIP_PER_MONTH)
  .filter(([k]) => k !== "monthly")
  .map(([k, [n, d]]) => `WHEN '${k}' THEN ${n}.0 / ${d}`)
  .join(" ")} ELSE 1 END)`;

export const SIP_EXTRA_FIELDS: Def[] = [
  // Client
  { key: "pan", label: "PAN", group: "Client", expr: "i.pan", gate: "pan" },
  { key: "email", label: "Email", group: "Client", expr: "i.email", gate: "email" },
  { key: "phone", label: "Mobile", group: "Client", expr: "i.phone", gate: "phone" },
  { key: "city", label: "City", group: "Client", expr: "i.address->>'city'" },
  { key: "state", label: "State", group: "Client", expr: "i.address->>'state'" },
  { key: "client_status", label: "Client status", group: "Client", expr: "i.status" },
  { key: "client_type", label: "Client type", group: "Client", expr: "i.investor_category" },
  { key: "client_rm", label: "Client's RM", group: "Client", expr: "ir.name" },
  { key: "branch", label: "Branch", group: "Client", expr: "b.name" },
  { key: "family", label: "Family", group: "Client", expr: "fam.family_name" },
  { key: "client_aum", label: "Client AUM", group: "Client", expr: "i.aum::text", inr: true },
  // The SIP
  { key: "amc", label: "AMC", group: "SIP", expr: "s.amc_name" },
  { key: "amc_code", label: "AMC code", group: "SIP", expr: "s.amc_code" },
  { key: "scheme_code", label: "Scheme code", group: "SIP", expr: "s.scheme_code" },
  { key: "sip_day", label: "SIP day", group: "SIP", expr: "s.sip_date" },
  { key: "monthly", label: "Monthly equivalent", group: "SIP", expr: `round(${MONTHLY}, 2)::text`, inr: true },
  { key: "failures", label: "Consecutive failures", group: "SIP", expr: "s.consecutive_failures" },
  { key: "stored_next", label: "Next instalment on record", group: "SIP", expr: D("s.next_installment_at") },
  { key: "created", label: "Added on", group: "SIP", expr: TS("s.created_at") },
  { key: "updated", label: "Last updated", group: "SIP", expr: TS("s.updated_at") },
  // Mandate
  { key: "mandate_ref", label: "Mandate reference", group: "Mandate", expr: "m.mandate_ref_no" },
  { key: "mandate_status", label: "Mandate status", group: "Mandate", expr: "m.status" },
  { key: "mandate_bank", label: "Mandate bank account", group: "Mandate", expr: "m.bank_account_masked" },
  { key: "mandate_ifsc", label: "Mandate IFSC", group: "Mandate", expr: "m.ifsc" },
  { key: "mandate_limit", label: "Mandate limit", group: "Mandate", expr: "m.amount_limit::text", inr: true },
  { key: "mandate_registered", label: "Mandate registered", group: "Mandate", expr: D("m.registered_at") },
  { key: "mandate_expires", label: "Mandate expires", group: "Mandate", expr: D("m.expires_at") },
  // Folio
  { key: "folio_rta", label: "Registrar", group: "Folio", expr: "fo.rta" },
  { key: "folio_opened", label: "Folio opened", group: "Folio", expr: D("fo.opened_at") },
  { key: "folio_closed", label: "Folio closed", group: "Folio", expr: YN("fo.closed_at IS NOT NULL") },
];

const BY_KEY = new Map(SIP_EXTRA_FIELDS.map((f) => [f.key, f]));

/** Fields offered for this firm: the catalog minus any its licence withholds. */
export function sipExtraOptions(allowed: (field: string) => boolean): ExtraFieldDef[] {
  return SIP_EXTRA_FIELDS.filter((f) => !f.gate || allowed(f.gate)).map(({ key, label, group }) => ({ key, label, group }));
}

/** Values of the chosen fields for these SIPs: `{ [sipId]: { [fieldKey]: text } }`. */
export async function loadSipExtra(
  tx: { execute: (q: any) => Promise<{ rows: any[] }> },
  ids: string[],
  keys: string[],
  allowed: Set<string>,
): Promise<Record<string, Record<string, string>>> {
  const fields = keys.filter((k) => allowed.has(k) && BY_KEY.has(k));
  if (!ids.length || !fields.length) return {};
  const cols = fields.map((k, n) => sql`(${sql.raw(BY_KEY.get(k)!.expr)}) AS ${sql.raw(`"c${n}"`)}`);
  const res = await tx.execute(sql`
    SELECT s.id, ${sql.join(cols, sql`, `)}
    FROM sips s
    LEFT JOIN investors i ON i.id = s.investor_id
    LEFT JOIN users ir ON ir.id = i.rm_id
    LEFT JOIN branches b ON b.id = i.branch_id
    LEFT JOIN families fam ON fam.id = i.family_id
    LEFT JOIN mandates m ON m.id = s.mandate_id
    LEFT JOIN folios fo ON fo.id = s.folio_id
    WHERE s.id IN (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})
  `);
  const out: Record<string, Record<string, string>> = {};
  for (const r of res.rows as any[]) {
    const o: Record<string, string> = {};
    fields.forEach((k, n) => {
      const v = r[`c${n}`];
      if (v == null || String(v).trim() === "") return;
      o[k] = BY_KEY.get(k)?.inr ? formatINR(Number(v)) : String(v);
    });
    out[String(r.id)] = o;
  }
  return out;
}

/** Keys that exist for this firm — what a cookie's choice is checked against. */
export function allowedSipExtraKeys(options: ExtraFieldDef[]): Set<string> {
  return new Set(options.map((o) => o.key));
}
