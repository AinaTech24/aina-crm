/**
 * GET  /api/visitors?q=&from=&to=&page= — the register, newest visit first
 * POST /api/visitors                    — record a visit
 * Visitor Register (Akshar Invest, 2026-11-26) — 404 for a firm without it.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { handleApiError } from "@/lib/api/error-handler";
import { assertVisitorRegister, VISITOR_WRITE_CAPS } from "@/lib/visitors/access";
import { parseVisitorFilter, VisitorCreateBody } from "@/lib/visitors/entry";
import { createVisitor, listVisitors } from "@/lib/visitors/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await assertVisitorRegister(session);
    const filter = parseVisitorFilter(Object.fromEntries(req.nextUrl.searchParams));
    const data = await withTenant(session.tenantId, (tx) => listVisitors(tx, session.tenantId, filter),
      { userId: session.userId, branchId: session.branchId, roles: session.roles });
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await assertVisitorRegister(session);
    requireAny(session.roles, VISITOR_WRITE_CAPS, session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = VisitorCreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const visitor = await withTenant(session.tenantId, (tx) => createVisitor(tx, session, parsed.data),
      { userId: session.userId, branchId: session.branchId, roles: session.roles });
    return NextResponse.json({ visitor }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
