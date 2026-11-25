/**
 * What the SIP Rejections list shows for a set of URL filters — ONE definition, used by the page (the rows and the
 * count under the pager) and by `GET /api/sip-rejections/ids` ("Select all N matching"), so the ids selected are exactly
 * the rows the page counts. Rows are `sip_rejections r` joined to `investors i`.
 */
import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { visibleClientSql } from "@/lib/transactions/client-scope";
import { dateRangeCond } from "@/lib/filters/date-range";

/** The most rejections one bulk action takes (the bulk route's own limit). */
export const SIP_REJECTION_BULK_MAX = 1000;

const OPEN = "('pending','client_contacted','bank_issue','mandate_issue')";

/** `WHERE …` for the list: the viewer's scope (a rejection is visible only when its client is) and every URL filter. */
export async function sipRejectionWhere(
  tx: Tx,
  session: SessionUser,
  sp: Record<string, string | undefined>,
): Promise<SQL> {
  const filters: SQL[] = [await visibleClientSql(tx, session, "i")];
  const q = (sp.q ?? "").trim();
  const recoveryFilter = (sp.recovery ?? "").split(",").filter(Boolean);
  const reasonCat = (sp.reason_cat ?? "").trim();

  if (q) {
    filters.push(
      sql`(i.name ILIKE ${`%${q}%`} OR r.scheme_name ILIKE ${`%${q}%`} OR r.amc_name ILIKE ${`%${q}%`} OR r.folio_number ILIKE ${`%${q}%`} OR r.rejection_reason ILIKE ${`%${q}%`})`,
    );
  }
  if (recoveryFilter.length) {
    filters.push(sql`r.recovery_status IN (${sql.join(recoveryFilter.map((v) => sql`${v}`), sql`, `)})`);
  }
  if (reasonCat) filters.push(sql`r.reason_category = ${reasonCat}`);
  if (sp.overdue === "1") {
    filters.push(sql`((now() - r.status_changed_at) > interval '2 days' AND r.recovery_status IN ${sql.raw(OPEN)})`);
  }
  if (sp.mtd === "1") filters.push(sql`r.rejection_date >= date_trunc('month', now())`);
  const dr = dateRangeCond(sp, "rej", "r.rejection_date");
  if (dr) filters.push(dr);

  // Branch / RM — the branch command centre's "open the exact SIP records". Both follow the CLIENT (its branch, its RM),
  // which is how the dashboard counts rejections. Malformed ids are dropped rather than cast.
  const uuids = (v: string | undefined) => (v ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const branchIds = uuids(sp.branch);
  const rmIds = uuids(sp.rm);
  if (branchIds.length) filters.push(sql`i.branch_id IN (${sql.join(branchIds.map((v) => sql`${v}::uuid`), sql`, `)})`);
  if (rmIds.length) filters.push(sql`i.rm_id IN (${sql.join(rmIds.map((v) => sql`${v}::uuid`), sql`, `)})`);

  return sql` WHERE ${sql.join(filters, sql` AND `)}`;
}
