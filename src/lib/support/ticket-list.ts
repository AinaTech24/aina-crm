/**
 * The platform Support tickets list (super-admin). Its status / category /
 * priority filters come straight from the URL, so every value is a BOUND
 * parameter — never spliced into the SQL text. (Until 2026-10-09 they were
 * quote-stripped and concatenated into a sql.raw string.)
 */
import { sql, type SQL } from "drizzle-orm";

export interface SupportTicketFilter {
  status?: string | string[];
  category?: string | string[];
  priority?: string | string[];
}

/** A URL param as one string: a repeated param (?status=a&status=b) uses the first; blank means no filter. */
function one(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s !== "" ? s : null;
}

/** WHERE clause for the list (empty when nothing is filtered). Values are parameters. */
export function supportTicketWhere(f: SupportTicketFilter): SQL {
  const conds: SQL[] = [];
  const status = one(f.status);
  const category = one(f.category);
  const priority = one(f.priority);
  if (status !== null) conds.push(sql`st.status = ${status}`);
  if (category !== null) conds.push(sql`st.category = ${category}`);
  if (priority !== null) conds.push(sql`st.priority = ${priority}`);
  return conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
}

/** The list query: newest first within priority, at most 200 rows. */
export function supportTicketListQuery(f: SupportTicketFilter): SQL {
  return sql`
    SELECT st.id, st.tenant_id, st.subject, st.description, st.category, st.priority,
           st.status, st.created_at, st.resolved_at,
           t.legal_name, t.arn,
           u.name AS raised_by_name
    FROM support_tickets st
    LEFT JOIN tenants t ON t.id = st.tenant_id
    LEFT JOIN users u ON u.id = st.raised_by_user_id
    ${supportTicketWhere(f)}
    ORDER BY
      CASE st.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      st.created_at DESC
    LIMIT 200
  `;
}
