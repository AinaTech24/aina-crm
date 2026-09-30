import { sql } from "drizzle-orm";
import { withTenant, type Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/jwt";
import { mobileFirmAccess, mobileOwnerScope, mobileTaskScope } from "./access";
import { loadViewableInvestor } from "@/lib/investors/access";
import { loadViewableLead } from "@/lib/leads/access";

/** Guard parent records for ALL detail and child routes, including comments/time. */
export async function assertMobileRecordPath(s: SessionUser, pathname: string) {
  if (!s.mobile) return;
  try { pathname = decodeURIComponent(pathname); }
  catch { throw Object.assign(new Error("Invalid record path"), { status: 400 }); }
  const match = /^\/api\/(tasks|review-meetings)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i.exec(pathname);
  if (!match) return;
  const table = match[1] === "tasks" ? "tasks" : "review_meetings";
  const visible = await withTenant(s.tenantId, async tx => (await tx.execute(sql`SELECT id FROM ${sql.raw(table)}
    WHERE tenant_id = ${s.tenantId}::uuid AND id = ${match[2]}::uuid
    AND ${table === "tasks" ? mobileTaskScope(s) : mobileOwnerScope(s, "review_meetings.rm_id")} LIMIT 1`)).rows[0]);
  if (!visible) throw Object.assign(new Error("Record not found"), { status: 404 });
}

export async function assertMobileAssignee(tx: Tx, s: SessionUser, id: string) {
  if (!s.mobile) return;
  const allowed = mobileFirmAccess(s) ? sql`TRUE` : sql`(id = ${s.userId}::uuid OR ${s.branchId ? sql`branch_id = ${s.branchId}::uuid` : sql`FALSE`})`;
  const found = (await tx.execute(sql`SELECT id FROM users WHERE tenant_id = ${s.tenantId}::uuid
    AND id = ${id}::uuid AND status = 'active' AND ${allowed}`)).rows[0];
  if (!found) throw Object.assign(new Error("Choose an active assignee within your scope"), { status: 403 });
}

export async function assertMobileSubjects(tx: Tx, s: SessionUser, body: {
  relatedInvestorId?: string; relatedLeadId?: string; subjectType?: string; subjectId?: string | null;
}) {
  if (!s.mobile) return;
  const investorIds = new Set([body.relatedInvestorId, body.subjectType === "investor" ? body.subjectId : null].filter(Boolean));
  const leadIds = new Set([body.relatedLeadId, body.subjectType === "lead" ? body.subjectId : null].filter(Boolean));
  for (const id of investorIds) if (!await loadViewableInvestor(tx, s, id!)) throw Object.assign(new Error("Client not found"), { status: 404 });
  for (const id of leadIds) if (!await loadViewableLead(tx, s, id!)) throw Object.assign(new Error("Lead not found"), { status: 404 });
}
