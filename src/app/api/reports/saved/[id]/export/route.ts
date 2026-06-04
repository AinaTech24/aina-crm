import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/reports/saved/[id]/export — download a saved report as .xlsx.
 * Detailed → a row table; matrix → a cross-tab with a totals column.
 */
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { savedReports } from "@/db/schema";
import { runDetailed, runMatrix } from "@/lib/reports/run";

export const dynamic = "force-dynamic";

function slug(s: string) {
  return (s || "report").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.manage");

    const data = await withTenant(session.tenantId, async (tx) => {
      const r = (await tx.select().from(savedReports).where(and(eq(savedReports.id, id), eq(savedReports.tenantId, session.tenantId))).limit(1))[0];
      if (!r) return null;
      if (r.reportType === "matrix") {
        const m = await runMatrix(tx, { subject: r.subject, ast: r.ast as any, matrix: r.matrix as any, tenantId: session.tenantId });
        return { name: r.name, kind: "matrix" as const, m };
      }
      const d = await runDetailed(tx, {
        subject: r.subject,
        ast: r.ast as any,
        columns: r.columns as string[] | null,
        sort: r.sort as any,
        tenantId: session.tenantId,
        limit: 5000,
      });
      return { name: r.name, kind: "detailed" as const, d };
    });
    if (!data) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });

    let aoa: (string | number)[][];
    if (data.kind === "matrix") {
      aoa = [
        [data.m.groupByLabel, ...data.m.colLabels, "Total"],
        ...data.m.rows.map((row) => [row.key, ...row.cells, row.total]),
      ];
    } else {
      aoa = [
        data.d.columns.map((c) => c.label),
        ...data.d.rows.map((row) => data.d.columns.map((c) => fmt(row[c.key]))),
      ];
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new Response(buf, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${slug(data.name)}.xlsx"`,
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}

function fmt(v: unknown): string | number {
  if (v == null) return "";
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}
