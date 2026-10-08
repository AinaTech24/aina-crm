import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { assertRtaImportAccess, maskImportRow } from "@/lib/rta/import-access";

/**
 * GET /api/rta-imports
 *
 * Returns the tenant's live (not trashed) RTA file imports, newest first.
 * Used by the dashboard tiles + the audit table.
 *
 * Access: the RTA import capability on an un-narrowed book
 * (lib/rta/import-access). Row errors are capped at the first 100 per import
 * (`errors_count` carries the full count) and every error / remark has its PANs
 * masked on read.
 */
export const dynamic = "force-dynamic";

const LIST_ERRORS_CAP = 100;

export async function GET(_req: NextRequest) {
  try {
    const session = await requireSession();

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        await assertRtaImportAccess(tx, session);
        const rows = await tx.execute(sql`
          SELECT
            rfi.id, rfi.source, rfi.kind, rfi.period_start, rfi.period_end,
            rfi.file_name, rfi.file_size_bytes, rfi.status, rfi.parsed_at,
            rfi.rows_total, rfi.rows_imported, rfi.rows_skipped, rfi.rows_failed,
            CASE WHEN jsonb_typeof(rfi.errors) = 'array'
                 THEN jsonb_path_query_array(rfi.errors, ${`$[0 to ${LIST_ERRORS_CAP - 1}]`}::jsonpath)
                 ELSE NULL END AS errors,
            CASE WHEN jsonb_typeof(rfi.errors) = 'array' THEN jsonb_array_length(rfi.errors) ELSE 0 END AS errors_count,
            rfi.remarks, rfi.created_at, rfi.uploaded_by,
            u.name AS uploaded_by_name
          FROM rta_file_imports rfi
          LEFT JOIN users u ON u.id = rfi.uploaded_by
          WHERE rfi.deleted_at IS NULL
          ORDER BY rfi.created_at DESC
          LIMIT 100
        `);

        /** Per-kind latest import — drives the "last uploaded" tiles. */
        const latest = await tx.execute(sql`
          SELECT DISTINCT ON (kind)
            kind, source, period_end, status, parsed_at, rows_imported, created_at
          FROM rta_file_imports
          WHERE status IN ('completed', 'partial') AND deleted_at IS NULL
          ORDER BY kind, period_end DESC, created_at DESC
        `);

        return { rows: (rows.rows as any[]).map(maskImportRow), latest: latest.rows };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
