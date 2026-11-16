/**
 * Fields a person can ADD as a column on the Proposals list, beyond the ones
 * the table draws by default. The list is code (one place), each field an
 * expression over `p` (proposals), `u` (who prepared it), `b` (the branch),
 * `i` (the client), `l` (the lead), `f` (the family), `rm` (the client's RM or
 * the lead's owner), `pp` (the proposal this one revises) and `ov` (who
 * overrode the suitability warning) — static text, never user input. A key a
 * cookie names that is not here is dropped, so nothing outside this list can
 * be asked for.
 *
 * Values come back as display text (dates in India time).
 */
import { sql } from "drizzle-orm";
import { formatINR } from "@/lib/utils";
import type { ExtraFieldDef } from "./types";

type Def = ExtraFieldDef & { expr: string; gate?: string; /** raw number text, shown as rupees */ inr?: boolean };

const TS = (e: string) => `to_char(${e} AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY')`;
const TSX = (e: string) => `to_char(${e} AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM')`;
const YN = (e: string) => `CASE WHEN ${e} THEN 'Yes' ELSE 'No' END`;

export const PROPOSAL_EXTRA_FIELDS: Def[] = [
  // Recipient
  { key: "recipient_kind", label: "Recipient is a", group: "Recipient", expr: "CASE p.recipient_type WHEN 'lead' THEN 'Lead' WHEN 'investor' THEN 'Client' WHEN 'family' THEN 'Family' ELSE p.recipient_type END" },
  { key: "email", label: "Email", group: "Recipient", expr: "p.recipient_email", gate: "email" },
  { key: "phone", label: "Mobile", group: "Recipient", expr: "p.recipient_phone", gate: "phone" },
  { key: "pan", label: "PAN", group: "Recipient", expr: "COALESCE(i.pan, l.pan)", gate: "pan" },
  { key: "family", label: "Family", group: "Recipient", expr: "f.family_name" },
  { key: "rm", label: "Relationship manager / lead owner", group: "Recipient", expr: "rm.name" },
  { key: "branch", label: "Branch", group: "Recipient", expr: "b.name" },
  // Proposal
  { key: "risk", label: "Risk rating", group: "Proposal", expr: "initcap(p.risk_rating)" },
  { key: "summary", label: "Summary", group: "Proposal", expr: "NULLIF(p.summary, '')" },
  { key: "products", label: "Products in it", group: "Proposal", expr: "CASE WHEN jsonb_typeof(p.products) = 'array' THEN jsonb_array_length(p.products)::text END" },
  { key: "version", label: "Version", group: "Proposal", expr: "p.version::text" },
  { key: "revises", label: "Revises proposal", group: "Proposal", expr: "pp.proposal_number" },
  { key: "suitability", label: "Suitability note", group: "Proposal", expr: "NULLIF(p.suitability_note, '')" },
  { key: "suitability_override", label: "Suitability override reason", group: "Proposal", expr: "NULLIF(p.suitability_override_reason, '')" },
  { key: "suitability_override_by", label: "Suitability overridden by", group: "Proposal", expr: "ov.name" },
  // Dates
  { key: "valid_date", label: "Valid till (date)", group: "Dates", expr: TS("p.valid_until") },
  { key: "prepared_on", label: "Prepared on", group: "Dates", expr: TS("p.prepared_at") },
  { key: "updated", label: "Last updated", group: "Dates", expr: TS("p.updated_at") },
  { key: "sent", label: "Sent on", group: "Dates", expr: TSX("p.sent_at") },
  { key: "viewed", label: "First viewed", group: "Dates", expr: TSX("p.viewed_at") },
  { key: "last_viewed", label: "Last viewed", group: "Dates", expr: TSX("p.last_viewed_at") },
  { key: "views", label: "Times viewed", group: "Dates", expr: "p.view_count::text" },
  { key: "accepted", label: "Accepted on", group: "Dates", expr: TSX("p.accepted_at") },
  { key: "rejected", label: "Rejected on", group: "Dates", expr: TSX("p.rejected_at") },
  { key: "rejection_reason", label: "Rejection reason", group: "Dates", expr: "NULLIF(p.rejection_reason, '')" },
  { key: "change_requested", label: "Changes requested on", group: "Dates", expr: TSX("p.change_requested_at") },
  { key: "change_note", label: "Client's change request", group: "Dates", expr: "NULLIF(p.change_request_note, '')" },
  // Outcome
  { key: "executed", label: "Executed on", group: "Outcome", expr: TS("p.executed_at") },
  { key: "executed_amount", label: "Executed amount", group: "Outcome", expr: "p.executed_amount::text", inr: true },
  { key: "expired_flag", label: "Marked expired", group: "Outcome", expr: YN("COALESCE(p.is_expired, false)") },
];

const BY_KEY = new Map(PROPOSAL_EXTRA_FIELDS.map((f) => [f.key, f]));

/** Fields offered for this firm: the catalog, minus any its licence withholds. */
export function proposalExtraOptions(allowed: (field: string) => boolean): ExtraFieldDef[] {
  return PROPOSAL_EXTRA_FIELDS.filter((f) => !f.gate || allowed(f.gate)).map(({ key, label, group }) => ({ key, label, group }));
}

/** Values of the chosen fields for these proposals: `{ [proposalId]: { [fieldKey]: text } }`. */
export async function loadProposalExtra(
  tx: { execute: (q: any) => Promise<{ rows: any[] }> },
  ids: string[],
  keys: string[],
  allowed: Set<string>,
): Promise<Record<string, Record<string, string>>> {
  const fields = keys.filter((k) => allowed.has(k) && BY_KEY.has(k));
  if (!ids.length || !fields.length) return {};
  const cols = fields.map((k, n) => sql`(${sql.raw(BY_KEY.get(k)!.expr)}) AS ${sql.raw(`"c${n}"`)}`);
  const res = await tx.execute(sql`
    SELECT p.id, ${sql.join(cols, sql`, `)}
    FROM proposals p
    LEFT JOIN investors i ON i.id = p.investor_id
    LEFT JOIN leads l ON l.id = p.lead_id
    LEFT JOIN families f ON f.id = p.family_id
    LEFT JOIN users rm ON rm.id = COALESCE(i.rm_id, l.owner_id, f.rm_id)
    LEFT JOIN branches b ON b.id = p.branch_id
    LEFT JOIN proposals pp ON pp.id = p.parent_proposal_id
    LEFT JOIN users ov ON ov.id = p.suitability_override_by_user_id
    WHERE p.id IN (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})
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
export function allowedProposalExtraKeys(options: ExtraFieldDef[]): Set<string> {
  return new Set(options.map((o) => o.key));
}
