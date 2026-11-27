/**
 * GET    /api/couriers/[id] — one courier
 * PATCH  /api/couriers/[id] — edit it
 * DELETE /api/couriers/[id] — remove it from the list
 * Couriers (Akshar Invest, 2026-11-27) — 404 for a firm without it.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { handleApiError } from "@/lib/api/error-handler";
import { assertCouriers, COURIER_WRITE_CAPS } from "@/lib/couriers/access";
import { CourierPatchBody } from "@/lib/couriers/entry";
import { deleteCourier, getCourier, updateCourier } from "@/lib/couriers/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await requireSession();
    await assertCouriers(session);
    const { id } = await params;
    const courier = await withTenant(session.tenantId, (tx) => getCourier(tx, session.tenantId, id),
      { userId: session.userId, branchId: session.branchId, roles: session.roles });
    if (!courier) return NextResponse.json({ error: "Courier not found" }, { status: 404 });
    return NextResponse.json({ courier });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const session = await requireSession();
    await assertCouriers(session);
    requireAny(session.roles, COURIER_WRITE_CAPS, session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;
    const parsed = CourierPatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const courier = await withTenant(session.tenantId, (tx) => updateCourier(tx, session, id, parsed.data),
      { userId: session.userId, branchId: session.branchId, roles: session.roles });
    return NextResponse.json({ courier });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await requireSession();
    await assertCouriers(session);
    requireAny(session.roles, COURIER_WRITE_CAPS, session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;
    await withTenant(session.tenantId, (tx) => deleteCourier(tx, session, id),
      { userId: session.userId, branchId: session.branchId, roles: session.roles });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
