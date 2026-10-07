/**
 * Who may see which meeting.
 *
 *   - Their own meetings (`rm_id` = me) and the ones they attend
 *     (`attendees` kind user) — always.
 *   - With `review_meeting.manage.all`, also every other meeting whose client /
 *     lead they may see (`investorScopeSql` / `leadScopeSql`). A meeting with a
 *     client outside their book is not theirs to open, even with the "all"
 *     capability: an owner who limited someone to their own clients means it
 *     for meetings too.
 *   - Without it (an RM), only their own and attended ones — unchanged.
 *
 * Callers still add their own mobile owner scope on top where they had one.
 *
 * The client / lead part applies only under the data wall (`dataWallApplies`):
 * without it `manage.all` sees every meeting, as it always did.
 */

import { sql, type SQL } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { clientScopeNarrows, dataWallApplies, investorScopeSql } from "@/lib/investors/access";
import { leadScopeSql } from "@/lib/leads/access";
import { attendeeIs } from "./attendees";

export function canManageAllMeetings(session: SessionUser) {
  return can(session.roles, "review_meeting.manage.all", session.permissions);
}

/** TRUE when the meeting's client and lead (whichever it has) are visible to the viewer. */
export async function meetingSubjectVisibleSql(tx: any, session: SessionUser, alias = "m"): Promise<SQL> {
  if (!(await dataWallApplies(tx, session))) return sql`TRUE`;
  const cap = (c: Parameters<typeof can>[1]) => can(session.roles, c, session.permissions);
  const invAllowed = cap("investor.view.all") || cap("investor.view.assigned");
  const invScope = invAllowed ? await investorScopeSql(tx, session, "ms_i") : sql`FALSE`;
  const leadScope = cap("lead.view.all") || cap("lead.view.assigned")
    ? leadScopeSql(session, "ms_l") : sql`FALSE`;
  const col = (c: string) => sql.raw(`${alias}.${c}`);
  // A firm-wide client viewer keeps meetings whose client was since deleted.
  const inv = invAllowed && !(await clientScopeNarrows(tx, session))
    ? sql`TRUE`
    : sql`(${col("investor_id")} IS NULL OR EXISTS (SELECT 1 FROM investors ms_i WHERE ms_i.id = ${col("investor_id")} AND ${invScope}))`;
  return sql`(
    ${inv}
    AND (${col("lead_id")} IS NULL OR EXISTS (SELECT 1 FROM leads ms_l WHERE ms_l.id = ${col("lead_id")} AND ${leadScope}))
  )`;
}

/** Row filter for `review_meetings <alias>`. */
export async function meetingScopeSql(tx: any, session: SessionUser, alias = "m"): Promise<SQL> {
  const mine = sql`(${sql.raw(`${alias}.rm_id`)} = ${session.userId}::uuid OR ${attendeeIs("user", session.userId, sql.raw(`${alias}.attendees`))})`;
  if (!canManageAllMeetings(session)) return mine;
  return sql`(${mine} OR ${await meetingSubjectVisibleSql(tx, session, alias)})`;
}

/** Can this session see the one meeting? (by-id routes / pages: 404 when false) */
export async function canSeeMeeting(tx: any, session: SessionUser, id: string): Promise<boolean> {
  const scope = await meetingScopeSql(tx, session, "m");
  const r = await tx.execute(sql`
    SELECT 1 FROM review_meetings m
     WHERE m.id = ${id}::uuid AND m.tenant_id = ${session.tenantId}::uuid AND ${scope}
     LIMIT 1
  `);
  return r.rows.length > 0;
}

/**
 * The Schedule-Meeting form's subject pickers: clients, leads and families the
 * viewer may see — never the firm's whole book. `only` fetches one preselected
 * client or lead (still through the same scope).
 */
export async function loadMeetingSubjects(
  tx: any,
  session: SessionUser,
  opts: { familyId?: string | null; only?: { investorId?: string; leadId?: string } } = {},
) {
  const cap = (c: Parameters<typeof can>[1]) => can(session.roles, c, session.permissions);
  const invAllowed = cap("investor.view.all") || cap("investor.view.assigned");
  const leadAllowed = cap("lead.view.all") || cap("lead.view.assigned");
  const invScope = invAllowed ? await investorScopeSql(tx, session, "investors") : sql`FALSE`;
  const famScope = invAllowed ? await investorScopeSql(tx, session, "i") : sql`FALSE`;
  const leadScope = leadAllowed ? leadScopeSql(session, "leads") : sql`FALSE`;

  if (opts.only?.leadId) {
    const r = await tx.execute(sql`SELECT id, name, phone, stage FROM leads WHERE id = ${opts.only.leadId}::uuid AND tenant_id = ${session.tenantId}::uuid AND ${leadScope} LIMIT 1`);
    return { investors: [] as any[], leads: r.rows as any[], families: [] as any[] };
  }
  if (opts.only?.investorId) {
    const r = await tx.execute(sql`SELECT id, name, pan, segment_tag, last_review_at, next_review_at FROM investors WHERE id = ${opts.only.investorId}::uuid AND tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL AND ${invScope} LIMIT 1`);
    return { investors: r.rows as any[], leads: [] as any[], families: [] as any[] };
  }

  const familyId = opts.familyId ?? null;
  const [invRes, leadRes, famRes] = await Promise.all([
    tx.execute(sql`
      SELECT id, name, pan, segment_tag, last_review_at, next_review_at
      FROM investors
      WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL AND ${invScope}
      ORDER BY (next_review_at IS NULL) DESC, next_review_at ASC NULLS FIRST, name
      LIMIT 300
    `),
    tx.execute(sql`
      SELECT id, name, phone, stage
      FROM leads
      WHERE tenant_id = ${session.tenantId}::uuid AND converted_investor_id IS NULL AND stage NOT IN ('lost', 'cold', 'not_interested')
        AND ${leadScope}
      ORDER BY updated_at DESC
      LIMIT 300
    `),
    // Families that have a primary investor — a family meeting attaches to the
    // primary investor + the familyId (family_review path).
    tx.execute(sql`
      SELECT f.id, COALESCE(f.family_name, f.head_name) AS family_name, f.primary_investor_id, i.name AS primary_name
      FROM families f
      JOIN investors i ON i.id = f.primary_investor_id
      WHERE f.tenant_id = ${session.tenantId}::uuid AND f.primary_investor_id IS NOT NULL AND ${famScope}
      ORDER BY (f.id = ${familyId}::uuid) DESC NULLS LAST, f.family_name
      LIMIT 300
    `),
  ]);
  return { investors: invRes.rows as any[], leads: leadRes.rows as any[], families: famRes.rows as any[] };
}
