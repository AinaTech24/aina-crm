import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { isUuid, requireRtaImportAccess } from "@/lib/rta/import-access";
import { loadBatchReport } from "@/lib/rta/staging";

/**
 * GET /api/rta-staging/batches/:id
 *
 * READ-ONLY reconciliation report of one staging (shadow) batch: its stages,
 * row accounting, checks (pass / fail / UNVERIFIED), exceptions by reason and
 * the proposed economic transactions by class and action. It carries no PAN,
 * name or contact detail — staging never stores them.
 *
 * Access: the RTA import rule (lib/rta/import-access). Another firm's batch id
 * is simply not found (RLS).
 */
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    await requireRtaImportAccess(session);
    if (!isUuid(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const report = await loadBatchReport(session.tenantId, id);
    if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(report);
  } catch (err) {
    return handleApiError(err);
  }
}
