/**
 * "Recently deleted" custom reports (Zoho's 30-day bin, 2026-11-19). Deleting
 * a report sets `deleted_at`; it can be restored for this many days, and the
 * nightly ops scan purges it after that (`purgeDeletedReports`).
 */

import { sql } from "drizzle-orm";

export const RECENTLY_DELETED_DAYS = 30;

/** Hard-delete reports that have sat in Recently deleted past the window. System context. */
export async function purgeDeletedReports(tx: { execute: (q: ReturnType<typeof sql>) => Promise<{ rowCount?: number | null }> }): Promise<number> {
  const r = await tx.execute(
    sql`DELETE FROM saved_reports WHERE deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => ${RECENTLY_DELETED_DAYS})`,
  );
  return r.rowCount ?? 0;
}
