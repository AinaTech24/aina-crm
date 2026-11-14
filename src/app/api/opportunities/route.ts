/**
 * GET /api/opportunities — the Opportunities module's rows and headline
 * figures, for the mobile app (the web page reads lib/opportunities/board.ts
 * directly). Same filters as the page's URL — q, stage, product, owner,
 * status (open · won · lost · all), fu (overdue · today · week · none), mine —
 * and the same access: every row follows its client (investorScopeSql).
 *
 *   200 { rows: BoardRow[], kpis: BoardKpis, canWork }
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { requireInvestorView } from "@/lib/investors/access";
import { canWorkOpportunities } from "@/lib/opportunities/access";
import { loadBoardKpis, loadBoardRows, type BoardFilters } from "@/lib/opportunities/board";

export const dynamic = "force-dynamic";

const csv = (v: string | null) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireInvestorView(session);
    const sp = req.nextUrl.searchParams;
    const filters: BoardFilters = {
      q: sp.get("q") ?? undefined,
      stage: csv(sp.get("stage")),
      product: csv(sp.get("product")),
      owner: csv(sp.get("owner")),
      status: sp.get("status") ?? undefined,
      fu: sp.get("fu") ?? undefined,
      mine: sp.get("mine") === "1",
    };
    const { rows, kpis } = await withTenant(session.tenantId, async (tx) => {
      const [rows, kpis] = await Promise.all([loadBoardRows(tx, session, filters), loadBoardKpis(tx, session)]);
      return { rows, kpis };
    }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });
    return NextResponse.json({ rows, kpis, canWork: canWorkOpportunities(session) });
  } catch (err) {
    return handleApiError(err);
  }
}
