import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/fixed-deposits   — list (?investorId= ?status=live|all|<status> ?within=30 ?issuerType= ?rm= ?q=)
 * POST /api/fixed-deposits   — record a deposit; schedules its maturity follow-up
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { requireInvestorView } from "@/lib/investors/access";
import { FdBody } from "@/lib/fixed-deposits/schema";
import { createFd, listFds, requireEditFds } from "@/lib/fixed-deposits/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireInvestorView(session);
    const p = req.nextUrl.searchParams;
    const within = Number(p.get("within"));
    const out = await withTenant(session.tenantId, (tx) => listFds(tx, session, {
      investorId: p.get("investorId"),
      status: p.get("status"),
      within: Number.isFinite(within) && within > 0 ? within : null,
      issuerType: p.get("issuerType"),
      rmId: p.get("rm"),
      q: p.get("q"),
    }), { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });
    return NextResponse.json(out);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireEditFds(session);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = FdBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: parse.error.issues[0]?.message ?? "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const out = await withTenant(session.tenantId, (tx) => createFd(tx, session, parse.data),
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });
    if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ fixedDeposit: out.fd }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
