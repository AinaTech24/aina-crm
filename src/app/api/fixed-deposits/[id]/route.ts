import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET    /api/fixed-deposits/[id] — one deposit
 * PATCH  /api/fixed-deposits/[id] — edit / change status; re-syncs the maturity follow-up
 * DELETE /api/fixed-deposits/[id] — soft delete; cancels the maturity follow-up
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { requireInvestorView } from "@/lib/investors/access";
import { FdPatchBody } from "@/lib/fixed-deposits/schema";
import { deleteFd, loadViewableFd, requireEditFds, updateFd } from "@/lib/fixed-deposits/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireInvestorView(session);
    const fd = await withTenant(session.tenantId, (tx) => loadViewableFd(tx, session, id),
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });
    if (!fd) return NextResponse.json({ error: "Fixed deposit not found" }, { status: 404 });
    return NextResponse.json({ fixedDeposit: fd });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireEditFds(session);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = FdPatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: parse.error.issues[0]?.message ?? "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const out = await withTenant(session.tenantId, (tx) => updateFd(tx, session, id, parse.data),
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });
    if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ fixedDeposit: out.fd });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireEditFds(session);
    await assertActiveLicense(session.tenantId, session.roles);
    const out = await withTenant(session.tenantId, (tx) => deleteFd(tx, session, id),
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });
    if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
