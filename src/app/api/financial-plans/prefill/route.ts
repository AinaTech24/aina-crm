/**
 * GET /api/financial-plans/prefill?investorId=…
 *
 * What the CRM already holds for a client — mutual funds by asset class,
 * fixed deposits, insurance in force, goals, age, family and risk profile —
 * in the Financial Health Check's own shape (lib/financial-plans/from-crm.ts),
 * so a new health check starts filled instead of retyped. Read-only.
 *
 * Same gate as a plan: `financial_plan.view` plus the client's data scope
 * (loadViewableInvestor), so an RM only ever prefills from their own book.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { loadViewableInvestor } from "@/lib/investors/access";
import { planFromCrm } from "@/lib/financial-plans/from-crm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "financial_plan.view", session.permissions);
    const investorId = req.nextUrl.searchParams.get("investorId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(investorId)) return NextResponse.json({ error: "investorId required" }, { status: 400 });

    const prefill = await withTenant(
      session.tenantId,
      async (tx) => {
        const inv = await loadViewableInvestor(tx, session, investorId);
        if (!inv) return null;
        return planFromCrm(tx, session.tenantId, investorId);
      },
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles },
    );
    if (!prefill) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ prefill });
  } catch (err) {
    return handleApiError(err);
  }
}
