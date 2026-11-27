/**
 * GET    /api/visitors/[id] — one visit
 * PATCH  /api/visitors/[id] — edit it
 * DELETE /api/visitors/[id] — remove it from the register
 * Visitor Register (Akshar Invest, 2026-11-26) — 404 for a firm without it.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { handleApiError } from "@/lib/api/error-handler";
import { assertVisitorRegister, VISITOR_WRITE_CAPS } from "@/lib/visitors/access";
import { VisitorPatchBody } from "@/lib/visitors/entry";
import { deleteVisitor, getVisitor, updateVisitor } from "@/lib/visitors/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await requireSession();
    await assertVisitorRegister(session);
    const { id } = await params;
    const visitor = await withTenant(session.tenantId, (tx) => getVisitor(tx, session.tenantId, id),
      { userId: session.userId, branchId: session.branchId, roles: session.roles });
    if (!visitor) return NextResponse.json({ error: "Visitor entry not found" }, { status: 404 });
    return NextResponse.json({ visitor });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const session = await requireSession();
    await assertVisitorRegister(session);
    requireAny(session.roles, VISITOR_WRITE_CAPS, session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;
    const parsed = VisitorPatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const visitor = await withTenant(session.tenantId, (tx) => updateVisitor(tx, session, id, parsed.data),
      { userId: session.userId, branchId: session.branchId, roles: session.roles });
    return NextResponse.json({ visitor });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await requireSession();
    await assertVisitorRegister(session);
    requireAny(session.roles, VISITOR_WRITE_CAPS, session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;
    await withTenant(session.tenantId, (tx) => deleteVisitor(tx, session, id),
      { userId: session.userId, branchId: session.branchId, roles: session.roles });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
