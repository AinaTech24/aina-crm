import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/families/lookup?investorId=…   — the household of one client
 * GET /api/families/lookup?q=…            — households matching a name, code or member
 *
 * For pickers (a policy's family panel). Read-only; members are the ones the
 * viewer may open (lib/families/lookup), so it needs the client-view rule, not
 * the Families page's.
 */
import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireInvestorView } from "@/lib/investors/access";
import { familyOfClient, searchFamilies } from "@/lib/families/lookup";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireInvestorView(session);
    const investorId = req.nextUrl.searchParams.get("investorId") ?? "";
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

    const ctx = { userId: session.userId, branchId: session.branchId, roles: session.roles };
    if (investorId) {
      if (!UUID.test(investorId)) return NextResponse.json({ error: "invalid investorId" }, { status: 400 });
      const family = await withTenant(session.tenantId, (tx) => familyOfClient(tx as any, session, investorId), ctx);
      return NextResponse.json({ family });
    }
    if (q.length < 2) return NextResponse.json({ families: [] });
    const families = await withTenant(session.tenantId, (tx) => searchFamilies(tx as any, session, q.slice(0, 80)), ctx);
    return NextResponse.json({ families });
  } catch (err) {
    return handleApiError(err);
  }
}
