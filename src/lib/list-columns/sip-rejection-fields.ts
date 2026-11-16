/**
 * Fields a person can ADD as a column on the SIP Rejections list, beyond the
 * ones the table draws by default. Each is an expression over `r`
 * (sip_rejections), `i` (the client), `cu` (the client's own RM), `b` (the client's branch) and `s` (the SIP
 * the rejection is for) — static text, never user input. A key a cookie names
 * that is not here is dropped, so nothing outside this list can be asked for.
 *
 * Values come back as display text (dates in India time).
 */
import { sql } from "drizzle-orm";
import { formatINR } from "@/lib/utils";
import type { ExtraFieldDef } from "./types";

/** The columns, in the order the table draws them when the person has not moved any. */
export const SIP_REJ_DEFAULT_COLUMNS = [
  "rejected_on",
  "investor",
  "sip",
  "amount",
  "reason",
  "rm",
  "follow_up",
  "recovery_date",
  "recovery_status",
  "auto_recover",
  "remarks",
];

type Def = ExtraFieldDef & { expr: string; gate?: string; /** raw number text, shown as rupees */ inr?: boolean };

const D = (e: string) => `to_char(${e}, 'DD Mon YYYY')`;
const TS = (e: string) => `to_char(${e} AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY')`;
const YN = (e: string) => `CASE WHEN ${e} THEN 'Yes' ELSE 'No' END`;
const TITLE = (e: string) => `initcap(replace(${e}, '_', ' '))`;

export const SIP_REJECTION_EXTRA_FIELDS: Def[] = [
  // The rejection
  { key: "amc", label: "AMC", group: "Rejection", expr: "r.amc_name" },
  { key: "folio", label: "Folio number", group: "Rejection", expr: "r.folio_number" },
  { key: "reason_category", label: "Reason category", group: "Rejection", expr: TITLE("r.reason_category") },
  { key: "reason_text", label: "Reason (registrar's text)", group: "Rejection", expr: "r.rejection_reason" },
  { key: "logged_on", label: "Logged on", group: "Rejection", expr: TS("r.created_at") },
  { key: "days_since", label: "Days since rejection", group: "Rejection", expr: "(CURRENT_DATE - r.rejection_date)::text" },
  { key: "status_changed", label: "Status last changed", group: "Rejection", expr: TS("r.status_changed_at") },
  { key: "escalated_on", label: "Escalated on", group: "Rejection", expr: TS("r.escalated_at") },
  {
    key: "sla_breached",
    label: "SLA breached (>2d)",
    group: "Rejection",
    expr: YN("((now() - r.status_changed_at) > interval '2 days' AND r.recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue'))"),
  },
  { key: "updated_on", label: "Last updated", group: "Rejection", expr: TS("r.updated_at") },
  // The SIP
  { key: "sip_status", label: "SIP status", group: "The SIP", expr: TITLE("s.status") },
  { key: "sip_amount", label: "SIP instalment", group: "The SIP", expr: "s.amount::text", inr: true },
  { key: "sip_frequency", label: "SIP frequency", group: "The SIP", expr: TITLE("s.frequency") },
  { key: "sip_date", label: "SIP debit date", group: "The SIP", expr: "s.sip_date" },
  { key: "sip_start", label: "SIP start date", group: "The SIP", expr: D("s.start_date") },
  { key: "sip_end", label: "SIP end date", group: "The SIP", expr: D("s.end_date") },
  { key: "sip_next", label: "Next instalment", group: "The SIP", expr: D("s.next_installment_at") },
  { key: "sip_failures", label: "Consecutive failures", group: "The SIP", expr: "s.consecutive_failures" },
  // The client
  { key: "email", label: "Client email", group: "Client", expr: "i.email", gate: "email" },
  { key: "phone", label: "Client mobile", group: "Client", expr: "i.phone", gate: "phone" },
  { key: "city", label: "City", group: "Client", expr: "i.address->>'city'" },
  { key: "state", label: "State", group: "Client", expr: "i.address->>'state'" },
  { key: "client_rm", label: "Client's relationship manager", group: "Client", expr: "cu.name" },
  { key: "branch", label: "Branch", group: "Client", expr: "b.name" },
  { key: "client_status", label: "Client status", group: "Client", expr: TITLE("i.status") },
  { key: "client_type", label: "Client type", group: "Client", expr: TITLE("i.investor_category") },
  { key: "kyc", label: "KYC status", group: "Client", expr: TITLE("i.kyc_status") },
  { key: "mandate", label: "Mandate status", group: "Client", expr: TITLE("i.mandate_status") },
  { key: "bank", label: "Bank", group: "Client", expr: "i.bank_name" },
];

const BY_KEY = new Map(SIP_REJECTION_EXTRA_FIELDS.map((f) => [f.key, f]));

/** Fields offered for this firm: the catalog minus any its licence withholds. */
export function sipRejectionExtraOptions(allowed: (field: string) => boolean): ExtraFieldDef[] {
  return SIP_REJECTION_EXTRA_FIELDS.filter((f) => !f.gate || allowed(f.gate)).map(({ key, label, group }) => ({ key, label, group }));
}

/** Values of the chosen fields for these rejections: `{ [rejectionId]: { [fieldKey]: text } }`. */
export async function loadSipRejectionExtra(
  tx: { execute: (q: any) => Promise<{ rows: any[] }> },
  ids: string[],
  keys: string[],
  allowed: Set<string>,
): Promise<Record<string, Record<string, string>>> {
  const fields = keys.filter((k) => allowed.has(k) && BY_KEY.has(k));
  if (!ids.length || !fields.length) return {};
  const cols = fields.map((k, n) => sql`(${sql.raw(BY_KEY.get(k)!.expr)}) AS ${sql.raw(`"c${n}"`)}`);
  const res = await tx.execute(sql`
    SELECT r.id, ${sql.join(cols, sql`, `)}
    FROM sip_rejections r
    LEFT JOIN investors i ON i.id = r.investor_id
    LEFT JOIN users cu ON cu.id = i.rm_id
    LEFT JOIN branches b ON b.id = i.branch_id
    LEFT JOIN sips s ON s.id = r.sip_id
    WHERE r.id IN (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})
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
export function allowedSipRejectionKeys(options: ExtraFieldDef[]): Set<string> {
  return new Set(options.map((o) => o.key));
}
