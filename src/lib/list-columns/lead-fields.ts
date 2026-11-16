/**
 * Fields a person can ADD as a column on the Leads list, beyond the ones the
 * table already draws (the nine originals and every lead column of
 * lib/leads/table-columns.ts, custom lead fields included). What is offered
 * here is what the table does not hold on the row: the owner's own details,
 * the converted client, days-since figures, counts of tasks / meetings /
 * proposals / messages, the pipeline value and the campaign's other tags.
 *
 * Each field is an expression over `l` (leads), `u` (the owner), `ob` (the
 * owner's branch), `b` (the lead's branch), `sd` (sub-distributor), `ic` (the
 * client the lead became) — static text, never user input. A key a cookie names
 * that is not here is dropped. Values come back as display text (dates in India
 * time), so the table needs no per-field formatting.
 */
import { sql } from "drizzle-orm";
import { formatINR } from "@/lib/utils";
import type { ExtraFieldDef } from "./types";

type Def = ExtraFieldDef & { expr: string; /** raw number text, shown as rupees */ inr?: boolean };

const IST = (e: string) => `(${e} AT TIME ZONE 'Asia/Kolkata')::date`;
const TODAY = IST("now()");
const TS = (e: string) => `to_char(${e} AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY')`;
const TST = (e: string) => `to_char(${e} AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')`;
const YN = (e: string) => `CASE WHEN ${e} THEN 'Yes' ELSE 'No' END`;
/** Whole days from `e` up to today (India dates); blank when `e` is blank or in the future. */
const DAYS_SINCE = (e: string) =>
  `CASE WHEN ${e} IS NOT NULL AND ${IST(e)} <= ${TODAY} THEN (${TODAY} - ${IST(e)})::text END`;
/** A task is about a lead through either of two links (see CLAUDE.md, "A task reaches a client through TWO links"). */
const LEAD_TASK = `t.tenant_id = l.tenant_id AND t.deleted_at IS NULL AND (t.related_lead_id = l.id OR (t.subject_type = 'lead' AND t.subject_id = l.id))`;

export const LEAD_EXTRA_FIELDS: Def[] = [
  // Follow-up
  { key: "next_fu_time", label: "Next follow-up (with time)", group: "Follow-up", expr: TST("l.next_follow_up_at") },
  {
    key: "fu_overdue_days",
    label: "Follow-up overdue (days)",
    group: "Follow-up",
    expr: `CASE WHEN l.next_follow_up_at IS NOT NULL AND ${IST("l.next_follow_up_at")} < ${TODAY} THEN (${TODAY} - ${IST("l.next_follow_up_at")})::text END`,
  },
  { key: "days_since_contact", label: "Days since last contact", group: "Follow-up", expr: DAYS_SINCE("l.last_contact_at") },
  { key: "last_fu_time", label: "Last follow-up (with time)", group: "Follow-up", expr: TST("l.last_follow_up_at") },
  {
    key: "open_tasks",
    label: "Open tasks",
    group: "Follow-up",
    expr: `(SELECT count(*) FROM tasks t WHERE ${LEAD_TASK} AND t.status IN ('open', 'in_progress', 'blocked'))::text`,
  },
  {
    key: "meetings",
    label: "Meetings (not cancelled)",
    group: "Follow-up",
    expr: `(SELECT count(*) FROM review_meetings m WHERE m.tenant_id = l.tenant_id AND m.lead_id = l.id AND m.status <> 'cancelled')::text`,
  },
  {
    key: "next_meeting",
    label: "Next meeting",
    group: "Follow-up",
    expr: TST(`(SELECT min(m.meeting_date) FROM review_meetings m WHERE m.tenant_id = l.tenant_id AND m.lead_id = l.id AND m.status = 'scheduled' AND m.meeting_date >= now())`),
  },
  {
    key: "messages",
    label: "Messages exchanged",
    group: "Follow-up",
    expr: `(SELECT count(*) FROM communications c WHERE c.tenant_id = l.tenant_id AND c.lead_id = l.id)::text`,
  },
  // Stage & score
  { key: "days_in_stage", label: "Days in stage", group: "Stage & score", expr: DAYS_SINCE("COALESCE(l.stage_changed_at, l.created_at)") },
  { key: "scored_at", label: "Score updated on", group: "Stage & score", expr: TS("l.scored_at") },
  {
    key: "onboarding_route",
    label: "Onboarding route",
    group: "Stage & score",
    expr: "CASE l.onboarding_route WHEN 'exchange' THEN 'Exchange (BSE / NSE / MFU)' WHEN 'physical' THEN 'Physical (RTA / AMC)' ELSE l.onboarding_route END",
  },
  {
    key: "proposals",
    label: "Proposals",
    group: "Stage & score",
    expr: `(SELECT count(*) FROM proposals p WHERE p.tenant_id = l.tenant_id AND p.lead_id = l.id)::text`,
  },
  // Value
  { key: "expected_business", label: "Expected business", group: "Value", expr: "l.expected_business_amount::text", inr: true },
  // Owner
  { key: "owner_email", label: "Owner email", group: "Owner (RM)", expr: "u.email" },
  { key: "owner_phone", label: "Owner mobile", group: "Owner (RM)", expr: "u.phone" },
  { key: "owner_branch", label: "Owner's branch", group: "Owner (RM)", expr: "ob.name" },
  { key: "owner_department", label: "Owner's department", group: "Owner (RM)", expr: "u.department" },
  // Source & campaign
  { key: "utm_term", label: "UTM term", group: "Source & campaign", expr: "l.utm_params->>'term'" },
  { key: "utm_content", label: "UTM content", group: "Source & campaign", expr: "l.utm_params->>'content'" },
  { key: "sub_dist_code", label: "Sub-distributor code", group: "Source & campaign", expr: "sd.code" },
  { key: "sub_dist_mobile", label: "Sub-distributor mobile", group: "Source & campaign", expr: "sd.mobile" },
  // Outcome
  { key: "converted", label: "Converted to a client", group: "Outcome", expr: YN("l.converted_investor_id IS NOT NULL") },
  { key: "client_name", label: "Client (after conversion)", group: "Outcome", expr: "ic.name" },
  { key: "client_status", label: "Client status", group: "Outcome", expr: "ic.status" },
  // Record
  { key: "age_days", label: "Age (days)", group: "Record", expr: DAYS_SINCE("l.created_at") },
  { key: "created_time", label: "Created (with time)", group: "Record", expr: TST("l.created_at") },
  { key: "branch_code", label: "Branch code", group: "Record", expr: "b.code" },
];

const BY_KEY = new Map(LEAD_EXTRA_FIELDS.map((f) => [f.key, f]));

/** Fields offered to this firm (all of them — the lead list does not gate fields by licence). */
export function leadExtraOptions(): ExtraFieldDef[] {
  return LEAD_EXTRA_FIELDS.map(({ key, label, group }) => ({ key, label, group }));
}

/** Values of the chosen fields for these leads: `{ [leadId]: { [fieldKey]: text } }`. */
export async function loadLeadExtra(
  tx: { execute: (q: any) => Promise<{ rows: any[] }> },
  ids: string[],
  keys: string[],
  allowed: Set<string>,
): Promise<Record<string, Record<string, string>>> {
  const fields = keys.filter((k) => allowed.has(k) && BY_KEY.has(k));
  if (!ids.length || !fields.length) return {};
  const cols = fields.map((k, n) => sql`(${sql.raw(BY_KEY.get(k)!.expr)}) AS ${sql.raw(`"c${n}"`)}`);
  const res = await tx.execute(sql`
    SELECT l.id, ${sql.join(cols, sql`, `)}
    FROM leads l
    LEFT JOIN users u ON u.id = l.owner_id
    LEFT JOIN branches ob ON ob.id = u.branch_id
    LEFT JOIN branches b ON b.id = l.branch_id
    LEFT JOIN sub_distributors sd ON sd.id = l.sub_distributor_id
    LEFT JOIN investors ic ON ic.id = l.converted_investor_id
    WHERE l.id IN (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})
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

/** Keys that exist — what a cookie's choice is checked against. */
export function allowedLeadExtraKeys(options: ExtraFieldDef[]): Set<string> {
  return new Set(options.map((o) => o.key));
}
