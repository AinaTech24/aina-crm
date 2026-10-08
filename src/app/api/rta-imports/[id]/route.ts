import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertRtaImportAccess, isUuid, maskImportRow, RTA_IMPORT_CAPABILITY } from "@/lib/rta/import-access";

/**
 * GET /api/rta-imports/:id
 *
 * Status of a single RTA import. The upload dialog polls this after enqueuing
 * the parse (the work now runs in the background worker) until the status is
 * terminal (completed | partial | failed | rejected), then renders the outcome.
 *
 * Access: the RTA import capability on an un-narrowed book
 * (lib/rta/import-access) — the same rule as the upload that created the row.
 * PANs in errors / remarks are masked on read. Tenant scope is RLS (withTenant).
 */
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();

    const row = await withTenant(
      session.tenantId,
      async (tx) => {
        await assertRtaImportAccess(tx, session);
        if (!isUuid(id)) return null;
        const r = await tx.execute(sql`
          SELECT id, source, kind, status, period_start, period_end,
                 rows_total, rows_imported, rows_skipped, rows_failed,
                 errors, summary, remarks, file_name, parsed_at, created_at
          FROM rta_file_imports
          WHERE id = ${id}::uuid
          LIMIT 1
        `);
        return (r.rows[0] as Record<string, any> | undefined) ?? null;
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(maskImportRow(row));
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/rta-imports/:id
 *   Default → move the import record to Trash (soft-delete; recoverable).
 *   ?purge=1 → permanently remove the import-history row.
 * Either way the already-imported transactions/folios are untouched — this only
 * affects the upload-history entry.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireCap(session.roles, RTA_IMPORT_CAPABILITY, session.permissions);
    const purge = req.nextUrl.searchParams.get("purge") === "1";

    const ok = await withTenant(
      session.tenantId,
      async (tx) => {
        await assertRtaImportAccess(tx, session);
        if (!isUuid(id)) return false;
        if (purge) {
          const r = await tx.execute(
            sql`DELETE FROM rta_file_imports WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid RETURNING id`
          );
          return (r.rows as any[]).length > 0;
        }
        const r = await tx.execute(
          sql`UPDATE rta_file_imports SET deleted_at = now(), updated_at = now()
              WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL RETURNING id`
        );
        return (r.rows as any[]).length > 0;
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, trashed: !purge });
  } catch (err) {
    return handleApiError(err);
  }
}
