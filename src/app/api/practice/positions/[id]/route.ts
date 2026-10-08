import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH  /api/practice/positions/[id] — edit the contract { title?, purpose?, results?, approvals?, sort? }
 * DELETE /api/practice/positions/[id] — remove the position; its holders go with it and
 *        any process it owned is left without an owner (owner_position_id SET NULL).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { practicePositions } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { PositionPatchBody } from "@/lib/practice/positions";
import { gateManage, tenantOpts } from "../_gate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    gateManage(session);
    await assertActiveLicense(session.tenantId, session.roles);
    if (!UUID.test(id)) return NextResponse.json({ error: "Position not found" }, { status: 404 });
    const parse = PositionPatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: parse.error.issues[0]?.message ?? "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const b = parse.data;
    const patch: Partial<typeof practicePositions.$inferInsert> = { updatedAt: new Date() };
    if (b.title !== undefined) patch.title = b.title;
    if (b.purpose !== undefined) patch.purpose = b.purpose || null;
    if (b.results !== undefined) patch.results = b.results;
    if (b.approvals !== undefined) patch.approvals = b.approvals;
    if (b.sort !== undefined) patch.sort = b.sort;
    const [position] = await withTenant(session.tenantId, (tx) =>
      tx.update(practicePositions).set(patch)
        .where(and(eq(practicePositions.id, id), eq(practicePositions.tenantId, session.tenantId)))
        .returning(),
    tenantOpts(session));
    if (!position) return NextResponse.json({ error: "Position not found" }, { status: 404 });
    return NextResponse.json({ position });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    gateManage(session);
    await assertActiveLicense(session.tenantId, session.roles);
    if (!UUID.test(id)) return NextResponse.json({ error: "Position not found" }, { status: 404 });
    const gone = await withTenant(session.tenantId, (tx) =>
      tx.delete(practicePositions)
        .where(and(eq(practicePositions.id, id), eq(practicePositions.tenantId, session.tenantId)))
        .returning({ id: practicePositions.id }),
    tenantOpts(session));
    if (!gone.length) return NextResponse.json({ error: "Position not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
