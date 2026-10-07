/**
 * The viewer's row scope for a custom (saved) report, over the subject's
 * catalog alias — the same rules as each subject's own list page, so a report
 * can never show a client, lead, task, ticket or meeting its runner could not
 * open there.
 *
 * Only under the data wall (`dataWallApplies`): without it a saved report runs
 * over the firm's rows, as it always did.
 */

import { sql, type SQL } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getCatalog } from "@/lib/filter/catalog";
import { clientScopeNarrows, dataWallApplies, investorScopeSql, isDataScopeRestricted } from "@/lib/investors/access";
import { isBranchScoped, leadScopeSql } from "@/lib/leads/access";
import { taskScopeSql } from "@/lib/tasks/scope";
import { serviceRequestScopeSql } from "@/lib/service-requests/access";
import { meetingScopeSql, meetingSubjectVisibleSql } from "@/lib/review-meetings/scope";
import { claimClientScopeSql } from "@/lib/insurance/register-access";

export async function reportSubjectScope(tx: any, session: SessionUser, subject: string): Promise<SQL> {
  const a = getCatalog(subject).alias;
  if (!(await dataWallApplies(tx, session))) return sql`TRUE`;
  const cap = (c: Parameters<typeof can>[1]) => can(session.roles, c, session.permissions);
  const invAllowed = cap("investor.view.all") || cap("investor.view.assigned");
  // A firm-wide client viewer keeps rows whose client is missing or deleted.
  const clientsFree = invAllowed && !(await clientScopeNarrows(tx, session));
  const clientOf = async (col: string) => {
    if (!invAllowed) return sql`FALSE`;
    if (clientsFree) return sql`TRUE`;
    const scope = await investorScopeSql(tx, session, "rsc_i");
    return sql`EXISTS (SELECT 1 FROM investors rsc_i WHERE rsc_i.id = ${sql.raw(`${a}.${col}`)} AND ${scope})`;
  };
  switch (subject) {
    case "investor":
      return invAllowed ? investorScopeSql(tx, session, a) : sql`FALSE`;
    case "lead":
      return cap("lead.view.all") || cap("lead.view.assigned") ? leadScopeSql(session, a) : sql`FALSE`;
    case "task":
      return cap("task.view.all") || cap("task.view.assigned") ? taskScopeSql(tx, session, a) : sql`FALSE`;
    case "service_request":
      return serviceRequestScopeSql(tx, session, a);
    case "review_meeting":
      // Oversight runners (compliance holds no meeting capability) see every
      // meeting whose client / lead they may see; others own + attended, or
      // manage.all's subject rule.
      return cap("investor.view.all") || cap("compliance.view")
        ? meetingSubjectVisibleSql(tx, session, a)
        : meetingScopeSql(tx, session, a);
    case "transaction":
    case "sip":
    case "insurance":
    case "goal":
      return clientOf("investor_id");
    case "claim":
      // A claim's client link is optional — clientOf would drop every
      // unlinked claim.
      return claimClientScopeSql(tx, session, sql.raw(`${a}.investor_id`), sql.raw(`${a}.rm_id`));
    case "business_entry": {
      // Own entries, entries for a visible client, and — for firm-wide client
      // viewers — entries keyed without a client record.
      const firm = cap("investor.view.all") && !isBranchScoped(session);
      return sql`(${sql.raw(`${a}.rm_id`)} = ${session.userId}::uuid
        OR ${await clientOf("investor_id")}
        OR (${sql.raw(`${a}.investor_id`)} IS NULL AND ${firm ? sql`TRUE` : sql`FALSE`}))`;
    }
    case "user":
      return sql`TRUE`;
    default:
      // A subject this file does not know is refused rather than run firm-wide.
      return sql`FALSE`;
  }
}

/**
 * Firm MIS reports that take a `branch` filter: a branch head locked to their
 * branch (no `dashboard.view.all_branches`) always gets their own branch —
 * the param is ignored, as on the Branch Head Dashboard. null = no lock.
 */
export function reportBranchLock(session: SessionUser): string | null {
  if (isBranchScoped(session) && !can(session.roles, "dashboard.view.all_branches", session.permissions)) {
    return session.branchId ?? null;
  }
  return null;
}

/**
 * A firm MIS report that lists CLIENTS by name can only be scoped by branch.
 * A viewer whose client access is their own book (an owner-customised
 * "assigned only" user, or an RM under the firm's data wall) is refused
 * rather than shown the firm's clients. Branch-locked heads pass (the caller
 * applies `reportBranchLock`).
 */
export async function assertClientReportAccess(tx: any, session: SessionUser): Promise<void> {
  if (reportBranchLock(session)) return;
  if (can(session.roles, "investor.view.all", session.permissions)) return;
  if (!(await isDataScopeRestricted(tx, session.tenantId, session))) return;
  throw Object.assign(new Error("forbidden: this report covers the whole firm's clients"), { status: 403 });
}
