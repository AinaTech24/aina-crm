import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { withTenant } from "@/db/client";
import { assertRtaImportAccess } from "@/lib/rta/import-access";
import { loadSchemeCodes, type SchemeStatus } from "@/lib/rta/scheme-resolution";

/**
 * GET /api/rta-staging/schemes[?status=] — the firm's registrar scheme codes
 * and how each resolves to the CRM Scheme Master (Phase 3H), with the number
 * of transactions held on each. Same access as the import batches.
 */
export const dynamic = "force-dynamic";
const STATUSES = new Set(["resolved_isin", "confirmed", "unresolved", "conflict"]);

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const status = req.nextUrl.searchParams.get("status") ?? "";
    const data = await withTenant(session.tenantId, async (tx) => {
      await assertRtaImportAccess(tx, session);
      return loadSchemeCodes(tx, session.tenantId, { status: STATUSES.has(status) ? (status as SchemeStatus) : undefined });
    }, { userId: session.userId, branchId: session.branchId, roles: session.roles });
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
