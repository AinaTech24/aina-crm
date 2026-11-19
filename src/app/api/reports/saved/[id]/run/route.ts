import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/reports/saved/[id]/run — execute a saved report, return JSON.
 * Supports ?limit & ?offset for detailed reports (paged in the view page).
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { savedReports } from "@/db/schema";
import { runDetailed, runMatrix, runSummary } from "@/lib/reports/run";
import { reportSubjectScope } from "@/lib/reports/scope";
import { withDateRange } from "@/lib/reports/range";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.manage", session.permissions);
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

    const out = await withTenant(session.tenantId, async (tx) => {
      const r = (await tx.select().from(savedReports).where(and(eq(savedReports.id, id), eq(savedReports.tenantId, session.tenantId))).limit(1))[0];
      if (!r) return null;
      const ast = withDateRange(r.subject, (r.ast as any) ?? null, { field: url.searchParams.get("dateField"), from: url.searchParams.get("from"), to: url.searchParams.get("to") });
      const details = url.searchParams.get("details");
      if (r.reportType === "matrix") {
        return runMatrix(tx, { subject: r.subject, ast: ast as any, matrix: r.matrix as any, tenantId: session.tenantId, scope: await reportSubjectScope(tx, session, r.subject) });
      }
      if (r.reportType === "summary") {
        const summary = details === "1" || details === "0" ? { ...(r.summary as any), showDetailRows: details === "1" } : (r.summary as any);
        return runSummary(tx, { subject: r.subject, ast: ast as any, summary, tenantId: session.tenantId, scope: await reportSubjectScope(tx, session, r.subject) });
      }
      return runDetailed(tx, {
        scope: await reportSubjectScope(tx, session, r.subject),
        subject: r.subject,
        ast: ast as any,
        columns: r.columns as string[] | null,
        sort: r.sort as any,
        tenantId: session.tenantId,
        limit,
        offset,
      });
    });
    if (!out) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ result: out });
  } catch (err: any) {
    return handleApiError(err);
  }
}
