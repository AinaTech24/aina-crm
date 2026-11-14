import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/goals/[id]/pdf — the DETAILED goal-plan PDF (renderGoalPdf), the
 * same document "Email the plan" attaches, as a download. The web prints its
 * goal page instead (/dashboard/goals/[id]/print); the mobile app has no
 * print view, so it saves / shares this file. `?download=1` for attachment.
 *
 * A goal is visible only when its client is (loadViewableGoal — 404
 * otherwise), the same rule as GET /api/goals/[id].
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { tenants } from "@/db/schema";
import { renderGoalPdf } from "@/lib/goal-planning/goal-pdf";
import { loadViewableGoal } from "@/lib/goal-planning/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const download = req.nextUrl.searchParams.get("download") === "1";

    const built = await withTenant(session.tenantId, async (tx) => {
      const loaded = await loadViewableGoal(tx, session, id);
      if (!loaded) return null;
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
      const pdf = await renderGoalPdf({
        goal: loaded.goal as any,
        refId: loaded.goal.id,
        investor: { name: loaded.investor?.name },
        brand: {
          displayName: (t as any)?.displayName, legalName: (t as any)?.legalName,
          arn: (t as any)?.arn, euin: (t as any)?.euin,
          primaryColor: (t as any)?.primaryColor, secondaryColor: (t as any)?.secondaryColor,
          logoUrl: (t as any)?.logoUrl,
        },
      });
      return { pdf, name: loaded.goal.name ?? "Goal" };
    });

    if (!built) return NextResponse.json({ error: "not found" }, { status: 404 });
    const safe = String(built.name).replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40);
    return new NextResponse(built.pdf as any, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="Goal-Plan-${safe}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
