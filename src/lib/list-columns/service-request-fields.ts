/**
 * Fields a person can ADD as a column on the Service Requests list, beyond the
 * ones the table draws by default. Same shape as investor-fields.ts: each field
 * is a static expression over `sr` (service_requests), `i` (the client), `u`
 * (the assignee), `eu` (who it was escalated to), `cu` (the client's RM) and `b`
 * (the client's branch) — never user input. A key that is not here is dropped.
 *
 * Fields that describe the CLIENT (`client: true`) are wrapped in the same
 * visibility test the list uses for the client's name, so a ticket that is
 * visible only because it was assigned to the viewer never reveals a client
 * outside their book.
 */
import { sql, type SQL } from "drizzle-orm";
import type { ExtraFieldDef } from "./types";

type Def = ExtraFieldDef & {
  expr: string;
  /** licence field the client's data sits behind (subject "investor") */
  gate?: string;
  /** describes the ticket's client: masked when the client is out of the viewer's book */
  client?: boolean;
};

/** The built-in columns in their default order (matches the page's column list). Kept here, not in the client table, so the server page can read it. */
export const SERVICE_REQUEST_DEFAULT_COLUMNS = [
  "ticket", "client", "type", "subject", "assignee", "due", "status", "raised", "priority", "tat", "attachments", "actions",
];

const TS = (e: string) => `to_char(${e} AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM')`;
const TD = (e: string) => `to_char(${e} AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY')`;

export const SERVICE_REQUEST_EXTRA_FIELDS: Def[] = [
  // The request
  {
    key: "channel", label: "Channel", group: "Request",
    expr: "CASE sr.channel WHEN 'whatsapp' THEN 'WhatsApp' WHEN 'email' THEN 'Email' WHEN 'phone' THEN 'Phone' WHEN 'in_person' THEN 'In person' WHEN 'form' THEN 'Online form' ELSE sr.channel END",
  },
  { key: "description", label: "Description", group: "Request", expr: "sr.description" },
  { key: "remarks", label: "Remarks", group: "Request", expr: "sr.remarks" },
  { key: "requester", label: "Requested by (no client record)", group: "Request", expr: "sr.requester_name" },
  { key: "updated", label: "Last updated", group: "Request", expr: TD("sr.updated_at") },
  // Service levels
  { key: "raised_at", label: "Raised at (time)", group: "Service levels", expr: TS("sr.created_at") },
  { key: "sla_response", label: "Response due", group: "Service levels", expr: TS("sr.sla_response_at") },
  { key: "sla_resolution", label: "Resolution due", group: "Service levels", expr: TS("sr.sla_resolution_at") },
  { key: "responded", label: "First responded on", group: "Service levels", expr: TS("sr.responded_at") },
  { key: "resolved", label: "Resolved on", group: "Service levels", expr: TS("sr.resolved_at") },
  { key: "escalated", label: "Escalated on", group: "Service levels", expr: TS("sr.escalated_at") },
  { key: "escalated_to", label: "Escalated to", group: "Service levels", expr: "eu.name" },
  { key: "breached", label: "Past SLA", group: "Service levels", expr: "CASE WHEN sr.status NOT IN ('resolved','closed') AND sr.sla_resolution_at < now() THEN 'Yes' ELSE 'No' END" },
  // Resolution & feedback
  { key: "resolution", label: "Resolution notes", group: "Resolution", expr: "sr.resolution_notes" },
  { key: "csat", label: "Client rating", group: "Resolution", expr: "sr.csat_rating::text" },
  { key: "csat_comment", label: "Client comment", group: "Resolution", expr: "sr.csat_comment" },
  { key: "csat_at", label: "Rated on", group: "Resolution", expr: TD("sr.csat_at") },
  // Complaint register
  { key: "sebi_category", label: "SEBI category", group: "Complaint", expr: "sr.sebi_category" },
  { key: "sebi_sub", label: "SEBI sub-category", group: "Complaint", expr: "sr.sebi_sub_category" },
  { key: "complaint_source", label: "Complaint received from", group: "Complaint", expr: "sr.complaint_source" },
  { key: "scores_ref", label: "SCORES reference", group: "Complaint", expr: "sr.scores_ref_no" },
  // The client
  { key: "client_pan", label: "Client PAN", group: "Client", expr: "i.pan", gate: "pan", client: true },
  { key: "client_email", label: "Client email", group: "Client", expr: "i.email", gate: "email", client: true },
  { key: "client_phone", label: "Client mobile", group: "Client", expr: "i.phone", gate: "phone", client: true },
  { key: "client_city", label: "Client city", group: "Client", expr: "i.address->>'city'", client: true },
  { key: "client_rm", label: "Client's relationship manager", group: "Client", expr: "cu.name", client: true },
  { key: "client_branch", label: "Client's branch", group: "Client", expr: "b.name", client: true },
];

const BY_KEY = new Map(SERVICE_REQUEST_EXTRA_FIELDS.map((f) => [f.key, f]));

/** Fields offered for this firm: the catalog, minus any its licence withholds, and (when the viewer has no client access at all) minus the client's own data. */
export function serviceRequestExtraOptions(
  allowed: (field: string) => boolean,
  opts: { canSeeClientData?: boolean } = {},
): ExtraFieldDef[] {
  const { canSeeClientData = true } = opts;
  return SERVICE_REQUEST_EXTRA_FIELDS
    .filter((f) => (!f.gate || allowed(f.gate)) && (canSeeClientData || !f.client))
    .map(({ key, label, group }) => ({ key, label, group }));
}

/**
 * Values of the chosen fields for these tickets: `{ [ticketId]: { [fieldKey]: text } }`.
 * `clientVisible` is the page's own `srClientVisibleSql(tx, session, "sr")`.
 */
export async function loadServiceRequestExtra(
  tx: { execute: (q: any) => Promise<{ rows: any[] }> },
  ids: string[],
  keys: string[],
  allowed: Set<string>,
  clientVisible: SQL,
): Promise<Record<string, Record<string, string>>> {
  const fields = keys.filter((k) => allowed.has(k) && BY_KEY.has(k));
  if (!ids.length || !fields.length) return {};
  const cols = fields.map((k, n) => {
    const def = BY_KEY.get(k)!;
    const alias = sql.raw(`"c${n}"`);
    return def.client
      ? sql`(CASE WHEN ${clientVisible} THEN (${sql.raw(def.expr)}) END) AS ${alias}`
      : sql`(${sql.raw(def.expr)}) AS ${alias}`;
  });
  const res = await tx.execute(sql`
    SELECT sr.id, ${sql.join(cols, sql`, `)}
    FROM service_requests sr
    LEFT JOIN investors i ON i.id = sr.investor_id
    LEFT JOIN users cu ON cu.id = i.rm_id
    LEFT JOIN branches b ON b.id = i.branch_id
    LEFT JOIN users eu ON eu.id = sr.escalated_to_user_id
    WHERE sr.id IN (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})
  `);
  const out: Record<string, Record<string, string>> = {};
  for (const r of res.rows as any[]) {
    const o: Record<string, string> = {};
    fields.forEach((k, n) => {
      const v = r[`c${n}`];
      if (v == null || String(v).trim() === "") return;
      o[k] = String(v);
    });
    out[String(r.id)] = o;
  }
  return out;
}

/** Keys that exist for this firm — what a cookie's choice is checked against. */
export function allowedServiceRequestKeys(options: ExtraFieldDef[]): Set<string> {
  return new Set(options.map((o) => o.key));
}
