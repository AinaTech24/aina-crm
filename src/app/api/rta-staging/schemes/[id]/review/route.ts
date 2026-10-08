import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { withTenant } from "@/db/client";
import { assertRtaImportAccess, isUuid } from "@/lib/rta/import-access";
import { deferSchemeCode, rejectSchemeCandidate, SchemeMappingError } from "@/lib/rta/scheme-resolution";

/**
 * POST /api/rta-staging/schemes/:id/review — the other two review decisions
 * on a registrar code (Phase 3I): reject a proposed AMFI scheme (never
 * proposed again for the code) or defer the decision (the code stays
 * unresolved, its transactions stay held, the note says what is awaited).
 * Both audited. Approving is /confirm.
 */
export const dynamic = "force-dynamic";
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reject_candidate"), amfiSchemeCode: z.string().trim().min(1).max(20), note: z.string().trim().min(10).max(500) }),
  z.object({ action: z.literal("defer"), note: z.string().trim().min(10).max(500) }),
  z.object({ action: z.literal("undefer"), note: z.string().trim().max(500).default("") }),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute", session.permissions);
    if (!isUuid(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "say why (10–500 characters)" }, { status: 400 });
    const b = parsed.data;
    const ctx = { userId: session.userId, branchId: session.branchId, roles: session.roles };
    await withTenant(session.tenantId, async (tx) => {
      await assertRtaImportAccess(tx, session);
      if (b.action === "reject_candidate") await rejectSchemeCandidate(tx, session.tenantId, id, { amfiSchemeCode: b.amfiSchemeCode, note: b.note, by: session.userId });
      else await deferSchemeCode(tx, session.tenantId, id, { defer: b.action === "defer", note: b.note, by: session.userId });
    }, ctx);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err instanceof SchemeMappingError) return NextResponse.json({ error: err.message }, { status: err.status ?? 409 });
    return handleApiError(err);
  }
}
