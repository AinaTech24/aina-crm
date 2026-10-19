/**
 * POST /api/investors/[id]/kyc-check — fetch this client's KYC status from the
 * KRA now (NSE MF Invest, by PAN) and update it. Same rights as editing the
 * client: investor.edit.all, or investor.edit.assigned on the viewer's own
 * client (a branch-scoped head: their branch).
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { handleApiError } from "@/lib/api/error-handler";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { withTenant } from "@/db/client";
import { investors } from "@/db/schema/investors";
import { investorScopeCondition } from "@/lib/investors/access";
import { checkInvestorKyc } from "@/lib/kyc/refresh";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned"], session.permissions);
    const editsAll = can(session.roles, "investor.edit.all", session.permissions);

    const row = await withTenant(session.tenantId, async (tx) => {
      const scope = await investorScopeCondition(tx, session);
      const [r] = await tx
        .select({ id: investors.id, rmId: investors.rmId, branchId: investors.branchId })
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId), scope))
        .limit(1);
      return r ?? null;
    });
    if (!row) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    if (!editsAll) {
      const branchScoped = !session.roles.includes("owner") && session.roles.includes("branch_head") && !!session.branchId;
      const mine = branchScoped ? row.branchId === session.branchId : row.rmId === session.userId;
      if (!mine) return NextResponse.json({ error: "You can check KYC only for your own clients." }, { status: 403 });
    }

    const r = await checkInvestorKyc(session.tenantId, id, session.userId);
    if (!r.ok) {
      const error =
        r.error === "not_connected"
          ? "The firm has not connected NSE MF Invest yet (Settings → Integrations)."
          : "This client has no valid PAN on record.";
      return NextResponse.json({ error }, { status: 400 });
    }
    return NextResponse.json(r.result);
  } catch (e) {
    return handleApiError(e);
  }
}
