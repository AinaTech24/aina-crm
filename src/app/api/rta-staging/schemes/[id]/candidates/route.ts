import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { withTenant } from "@/db/client";
import { assertRtaImportAccess, isUuid } from "@/lib/rta/import-access";
import { schemeCandidates, SchemeMappingError } from "@/lib/rta/scheme-resolution";

/**
 * GET /api/rta-staging/schemes/:id/candidates — AMFI schemes a person may
 * approve for a registrar code (Phase 3I): platform mapping and ISIN matches
 * first (evidence), then schemes of the registrar AMC's established AMC ranked
 * by name for the person to check against a document. Nothing is applied.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute", session.permissions);
    if (!isUuid(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const ctx = { userId: session.userId, branchId: session.branchId, roles: session.roles };
    const out = await withTenant(session.tenantId, async (tx) => {
      await assertRtaImportAccess(tx, session);
      return schemeCandidates(tx, session.tenantId, id);
    }, ctx);
    return NextResponse.json(out);
  } catch (err: any) {
    if (err instanceof SchemeMappingError) return NextResponse.json({ error: err.message }, { status: err.status ?? 409 });
    return handleApiError(err);
  }
}
