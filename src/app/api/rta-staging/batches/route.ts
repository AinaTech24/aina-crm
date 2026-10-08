import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { assertRtaImportAccess } from "@/lib/rta/import-access";

/**
 * GET /api/rta-staging/batches
 *
 * READ-ONLY list of the RTA staging (shadow) batches of the caller's firm:
 * file, report, state, row and transaction counts. Phase 3B — nothing here
 * posts or changes anything; there is no write method on this resource.
 *
 * Access: the RTA import rule (lib/rta/import-access — `transactions.execute`
 * on an unwalled book), the same as the import history the batches belong to.
 * Tenant scope is RLS (withTenant) on every staging table.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(
      session.tenantId,
      async (tx) => {
        await assertRtaImportAccess(tx, session);
        return (await tx.execute(sql`
          SELECT id, import_id, mode, rta, report_code, record_kind, file_name, state, attempt, row_count, counts,
                 same_file_as_batch_id, rerun_of_batch_id, period_start, period_end, as_of_date, error, created_at, completed_at
            FROM rta_staging_batches
           ORDER BY created_at DESC
           LIMIT 200
        `)).rows;
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
    return NextResponse.json({ batches: rows });
  } catch (err) {
    return handleApiError(err);
  }
}
