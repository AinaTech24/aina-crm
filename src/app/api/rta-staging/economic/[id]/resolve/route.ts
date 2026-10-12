import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { isUuid, requireRtaImportAccess } from "@/lib/rta/import-access";
import { resolveHeldTransaction } from "@/lib/rta/posting/resolve";

/**
 * POST /api/rta-staging/economic/:id/resolve — a person decides which client a
 * transaction held for OWNERSHIP belongs to (Phase 3F, development only:
 * refused by the posting gate anywhere else). The decision and its reason are
 * recorded on the transaction and in the audit log; nothing is reassigned.
 */
export const dynamic = "force-dynamic";
const Body = z.object({ investorId: z.string().uuid(), note: z.string().trim().min(5).max(500) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute", session.permissions);
    await requireRtaImportAccess(session);
    if (!isUuid(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "choose a client and give a reason (5–500 characters)" }, { status: 400 });
    const body = parsed.data;
    const r = await resolveHeldTransaction(session.tenantId, id, { investorId: body.investorId, note: body.note, userId: session.userId });
    return NextResponse.json(r);
  } catch (err: any) {
    if (err?.name === "PostingGateError") return NextResponse.json({ error: err.message }, { status: 403 });
    if (err?.status === 409 || err?.status === 404) return NextResponse.json({ error: err.message }, { status: err.status });
    return handleApiError(err);
  }
}
