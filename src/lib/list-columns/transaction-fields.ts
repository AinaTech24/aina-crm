/**
 * Fields a person can ADD as a column on the MF Transactions list, beyond the
 * ones the table draws by default. The list is code (one place), each field an
 * expression over `t` (transactions), `i` (the client), `u` (the client's RM),
 * `b` (the client's branch), `f` (the client's family), `fo` (the folio) —
 * static text, never user input. A key a cookie names that is not here is
 * dropped, so nothing outside this list can be asked for.
 *
 * Values come back as display text (dates in India time, money as rupees), so
 * the table needs no per-field formatting. Transactions carry no custom fields.
 */
import { sql } from "drizzle-orm";
import { formatINR } from "@/lib/utils";
import type { ExtraFieldDef } from "./types";

type Def = ExtraFieldDef & { expr: string; gate?: string; /** raw number text, shown as rupees */ inr?: boolean };

const D = (e: string) => `to_char(${e}, 'DD Mon YYYY')`;
const TS = (e: string) => `to_char(${e} AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY')`;

export const TRANSACTION_EXTRA_FIELDS: Def[] = [
  // The transaction
  { key: "order_no", label: "Order number", group: "Transaction", expr: "t.order_id" },
  { key: "direction", label: "Direction", group: "Transaction", expr: "CASE t.direction WHEN 'inflow' THEN 'Inflow' WHEN 'outflow' THEN 'Outflow' ELSE t.direction END" },
  { key: "settlement", label: "Settlement date", group: "Transaction", expr: D("t.settlement_date") },
  { key: "exchange", label: "Exchange", group: "Transaction", expr: "t.exchange" },
  { key: "reason_code", label: "Reason code", group: "Transaction", expr: "t.reason_code" },
  { key: "reason", label: "Reason", group: "Transaction", expr: "t.reason_description" },
  { key: "euin", label: "EUIN", group: "Transaction", expr: "t.executed_euin" },
  { key: "entered", label: "Entered on", group: "Transaction", expr: TS("t.created_at") },
  { key: "updated", label: "Last updated", group: "Transaction", expr: TS("t.updated_at") },
  // The scheme
  { key: "amc_code", label: "AMC code", group: "Scheme", expr: "t.amc_code" },
  { key: "scheme_code", label: "Scheme code", group: "Scheme", expr: "t.scheme_code" },
  // The folio
  { key: "rta", label: "Registrar (RTA)", group: "Folio", expr: "fo.rta" },
  { key: "folio_opened", label: "Folio opened on", group: "Folio", expr: D("fo.opened_at") },
  { key: "folio_aum", label: "Folio value", group: "Folio", expr: "fo.aum::text", inr: true },
  // The client
  { key: "pan", label: "PAN", group: "Client", expr: "i.pan", gate: "pan" },
  { key: "email", label: "Client email", group: "Client", expr: "i.email", gate: "email" },
  { key: "phone", label: "Client mobile", group: "Client", expr: "i.phone", gate: "phone" },
  { key: "city", label: "Client city", group: "Client", expr: "i.address->>'city'" },
  { key: "state", label: "Client state", group: "Client", expr: "i.address->>'state'" },
  { key: "client_rm", label: "Client's relationship manager", group: "Client", expr: "u.name" },
  { key: "branch", label: "Client's branch", group: "Client", expr: "b.name" },
  { key: "family", label: "Family", group: "Client", expr: "f.family_name" },
  { key: "client_type", label: "Client type", group: "Client", expr: "i.investor_category" },
  { key: "client_status", label: "Client status", group: "Client", expr: "i.status" },
];

const BY_KEY = new Map(TRANSACTION_EXTRA_FIELDS.map((f) => [f.key, f]));

/** Fields offered for this firm: the catalog, minus any its licence withholds. */
export function transactionExtraOptions(allowed: (field: string) => boolean): ExtraFieldDef[] {
  return TRANSACTION_EXTRA_FIELDS.filter((f) => !f.gate || allowed(f.gate)).map(({ key, label, group }) => ({ key, label, group }));
}

/** Values of the chosen fields for these transactions: `{ [transactionId]: { [fieldKey]: text } }`. */
export async function loadTransactionExtra(
  tx: { execute: (q: any) => Promise<{ rows: any[] }> },
  ids: string[],
  keys: string[],
  allowed: Set<string>,
): Promise<Record<string, Record<string, string>>> {
  const fields = keys.filter((k) => allowed.has(k) && BY_KEY.has(k));
  if (!ids.length || !fields.length) return {};
  const cols = fields.map((k, n) => sql`(${sql.raw(BY_KEY.get(k)!.expr)}) AS ${sql.raw(`"c${n}"`)}`);
  const res = await tx.execute(sql`
    SELECT t.id, ${sql.join(cols, sql`, `)}
    FROM transactions t
    LEFT JOIN investors i ON i.id = t.investor_id
    LEFT JOIN users u ON u.id = i.rm_id
    LEFT JOIN branches b ON b.id = i.branch_id
    LEFT JOIN families f ON f.id = i.family_id
    LEFT JOIN folios fo ON fo.id = t.folio_id
    WHERE t.id IN (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})
  `);
  const out: Record<string, Record<string, string>> = {};
  for (const r of res.rows as Array<Record<string, unknown>>) {
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
export function allowedTransactionExtraKeys(options: ExtraFieldDef[]): Set<string> {
  return new Set(options.map((o) => o.key));
}
