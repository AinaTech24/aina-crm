import { handleApiError } from "@/lib/api/error-handler";
/**
 * Run a saved report and return JSON.
 *   GET  /api/reports/saved/[id]/run?limit&offset   — as saved
 *   POST /api/reports/saved/[id]/run                — with the viewer's view:
 *     { filter?: FilterAST   quick filters, ANDed with the saved filter (narrow only)
 *       drill?: [{ field, value }]  the records behind a clicked group / cell
 *       sort?: { field, dir }  limit?, offset? }
 * A drill-down always returns the detailed rows, whatever the report's layout.
 *
 * Both also read the We Care "Filter by" bar's query (?dateField=&from=&to=,
 * India dates — lib/reports/range.ts), ?branch=<branch name> (the subject's
 * branch field, lib/filter/catalog branchField) and ?details=1|0 for a summary.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { savedReports } from "@/db/schema";
import { FilterASTSchema, and as astAnd, type FilterAST } from "@/lib/filter/ast";
import { branchField } from "@/lib/filter/catalog";
import { runDetailed, runMatrix, runSummary, type DrillValue } from "@/lib/reports/run";
import { reportSubjectScope } from "@/lib/reports/scope";
import { canSeeSavedReport } from "@/lib/reports/visibility";
import type { CategoryColumn } from "@/lib/reports/categories";
import { withDateRange } from "@/lib/reports/range";

export const dynamic = "force-dynamic";

const ViewBody = z.object({
  filter: FilterASTSchema.nullable().optional(),
  drill: z.array(z.object({ field: z.string().max(80), value: z.string().max(300) })).max(4).optional(),
  sort: z.object({ field: z.string().max(60), dir: z.enum(["asc", "desc"]) }).nullable().optional(),
  limit: z.number().int().min(1).max(5000).optional(),
  offset: z.number().int().min(0).optional(),
});
type View = z.infer<typeof ViewBody>;
/** The URL-only part of a view: the date-range bar and Show details. */
type UrlView = { dateField: string | null; from: string | null; to: string | null; details: string | null; branch: string | null };
const urlView = (url: URL): UrlView => ({
  dateField: url.searchParams.get("dateField"),
  from: url.searchParams.get("from"),
  to: url.searchParams.get("to"),
  details: url.searchParams.get("details"),
  branch: url.searchParams.get("branch")?.trim().slice(0, 120) || null,
});

async function run(id: string, view: View, uv: UrlView) {
  const session = await requireSession();
  requireCap(session.roles, "reports.manage", session.permissions);
  return withTenant(session.tenantId, async (tx) => {
    const r = (
      await tx
        .select()
        .from(savedReports)
        .where(and(eq(savedReports.id, id), eq(savedReports.tenantId, session.tenantId), isNull(savedReports.deletedAt)))
        .limit(1)
    )[0];
    if (!r || !canSeeSavedReport(session, r)) return null;
    // Opening a report puts it at the top of the viewer's Recently viewed.
    if (!view.drill?.length && !view.offset) {
      const seen = { ...((r.viewedBy as Record<string, string> | null) ?? {}), [session.userId]: new Date().toISOString() };
      await tx.update(savedReports).set({ viewedBy: seen }).where(and(eq(savedReports.id, r.id), eq(savedReports.tenantId, session.tenantId)));
    }
    const scope = await reportSubjectScope(tx, session, r.subject);
    // The quick filter AND the date-range bar — both narrow this run only.
    const dated = withDateRange(r.subject, (view.filter ?? null) as FilterAST | null, { field: uv.dateField, from: uv.from, to: uv.to });
    // The Branch picker narrows this run to one branch, through the subject's branch field.
    const bf = uv.branch ? branchField(r.subject) : null;
    const branchAst = bf ? ({ type: "predicate", field: { kind: "attr", path: bf.key }, op: "eq", value: uv.branch } as FilterAST) : null;
    const extraAst = branchAst ? (dated ? astAnd(dated, branchAst) : astAnd(branchAst)) : dated;
    const base = {
      subject: r.subject,
      ast: r.ast as FilterAST | null,
      extraAst,
      tenantId: session.tenantId,
      scope,
      categories: r.categories as CategoryColumn[] | null,
    };
    if (view.drill?.length) {
      // Detail columns: the report's own (detailed) or its summary detail columns.
      const columns = r.reportType === "summary" ? ((r.summary as { columns?: string[] } | null)?.columns ?? null) : (r.columns as string[] | null);
      return runDetailed(tx, { ...base, drill: view.drill as DrillValue[], columns, sort: view.sort ?? null, limit: view.limit ?? 100, offset: view.offset ?? 0 });
    }
    if (r.reportType === "matrix") return runMatrix(tx, { ...base, matrix: r.matrix as any });
    if (r.reportType === "summary") {
      const summary = uv.details === "1" || uv.details === "0" ? { ...(r.summary as any), showDetailRows: uv.details === "1" } : (r.summary as any);
      return runSummary(tx, { ...base, summary });
    }
    return runDetailed(tx, {
      ...base,
      columns: r.columns as string[] | null,
      sort: view.sort !== undefined ? view.sort : (r.sort as any),
      limit: view.limit ?? 100,
      offset: view.offset ?? 0,
    });
  });
}

/** A quick filter or drill naming a field the catalog lacks is the caller's mistake, not a 500. */
function badField(err: unknown): string | null {
  return err instanceof Error && /unknown field|not a date|unknown date grouping/i.test(err.message) ? err.message : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const url = new URL(req.url);
    const out = await run(
      id,
      {
        limit: Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 1), 5000),
        offset: Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0),
      },
      urlView(url),
    );
    if (!out) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ result: out });
  } catch (err: any) {
    const bad = badField(err);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const parse = ViewBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const out = await run(id, parse.data, urlView(new URL(req.url)));
    if (!out) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ result: out });
  } catch (err: any) {
    const bad = badField(err);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
    return handleApiError(err);
  }
}
