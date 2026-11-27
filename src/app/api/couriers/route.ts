/**
 * GET  /api/couriers?q=&type=&status=&category=&courier_from=&courier_to=&company=&page=
 * POST /api/couriers — record a courier
 * Couriers (Akshar Invest, 2026-11-27) — 404 for a firm without it.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { handleApiError } from "@/lib/api/error-handler";
import { assertCouriers, COURIER_WRITE_CAPS } from "@/lib/couriers/access";
import { CourierBody, parseCourierFilter } from "@/lib/couriers/entry";
import { createCourier, listCouriers } from "@/lib/couriers/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await assertCouriers(session);
    const filter = parseCourierFilter(Object.fromEntries(req.nextUrl.searchParams));
    const data = await withTenant(session.tenantId, (tx) => listCouriers(tx, session.tenantId, filter),
      { userId: session.userId, branchId: session.branchId, roles: session.roles });
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await assertCouriers(session);
    requireAny(session.roles, COURIER_WRITE_CAPS, session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = CourierBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const courier = await withTenant(session.tenantId, (tx) => createCourier(tx, session, parsed.data),
      { userId: session.userId, branchId: session.branchId, roles: session.roles });
    return NextResponse.json({ courier }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
