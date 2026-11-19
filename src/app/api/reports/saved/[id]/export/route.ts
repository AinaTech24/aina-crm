import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/reports/saved/[id]/export — download a saved report.
 *   ?format=xlsx (default) | csv
 *   ?filter=<FilterAST JSON> — the viewer's quick filters, so the file is the
 *   view on screen (ANDed with the saved filter; it can only narrow)
 * Detailed → a row table; matrix → a cross-tab with a totals column;
 * summary → a grouped table with sub-totals + a grand-total row.
 */
import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { savedReports } from "@/db/schema";
import { FilterASTSchema, type FilterAST } from "@/lib/filter/ast";
import { reportSubjectScope } from "@/lib/reports/scope";
import { canSeeSavedReport } from "@/lib/reports/visibility";
import { aoaToCsv, aoaToXlsx, fileSlug, reportAoa } from "@/lib/reports/workbook";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.manage", session.permissions);
    const url = new URL(req.url);
    const format = (url.searchParams.get("format") ?? "xlsx").toLowerCase() === "csv" ? "csv" : "xlsx";
    let extraAst: FilterAST | null = null;
    const rawFilter = url.searchParams.get("filter");
    if (rawFilter) {
      const parsed = FilterASTSchema.safeParse(JSON.parse(rawFilter));
      if (!parsed.success) return new Response(JSON.stringify({ error: "invalid filter" }), { status: 400 });
      extraAst = parsed.data as FilterAST;
    }

    const data = await withTenant(session.tenantId, async (tx) => {
      const r = (
        await tx
          .select()
          .from(savedReports)
          .where(and(eq(savedReports.id, id), eq(savedReports.tenantId, session.tenantId), isNull(savedReports.deletedAt)))
          .limit(1)
      )[0];
      if (!r || !canSeeSavedReport(session, r)) return null;
      const aoa = await reportAoa(tx, r, { tenantId: session.tenantId, scope: await reportSubjectScope(tx, session, r.subject), extraAst });
      return { name: r.name, aoa };
    });
    if (!data) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });

    if (format === "csv") {
      return new Response(aoaToCsv(data.aoa), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${fileSlug(data.name)}.csv"`,
        },
      });
    }
    return new Response(new Uint8Array(aoaToXlsx(data.aoa)), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${fileSlug(data.name)}.xlsx"`,
      },
    });
  } catch (err: any) {
    if (err instanceof SyntaxError) return new Response(JSON.stringify({ error: "invalid filter" }), { status: 400 });
    return handleApiError(err);
  }
}
