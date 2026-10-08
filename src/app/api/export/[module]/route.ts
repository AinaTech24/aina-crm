import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/export/[module] — the fields this person may export from the module.
 * POST /api/export/[module] — { fields, format: "xlsx" | "csv", params } → the file.
 *   `params` is the list page's query string, so the file has the list's filters.
 *
 * Permission: "Export data" (clients: "Bulk export clients") plus the module's
 * own view permission — see lib/export/run.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { clientMetaFromHeaders } from "@/lib/audit";
import { EXPORT_MODULES } from "@/lib/export/registry";
import { canExportModule, exportableColumns, ExportError, runExport } from "@/lib/export/run";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ module: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { module } = await params;
    const session = await requireSession();
    const mod = EXPORT_MODULES[module];
    if (!mod) return NextResponse.json({ error: "Unknown module" }, { status: 404 });
    if (!canExportModule(session, mod)) return NextResponse.json({ error: "You don't have permission to export this." }, { status: 403 });
    const cols = await exportableColumns(session, mod);
    return NextResponse.json({
      label: mod.label,
      columns: cols.map((c) => ({ key: c.key, label: c.label, group: c.group ?? "Fields", default: !!c.default })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const Body = z.object({
  fields: z.array(z.string().max(80)).min(1).max(200),
  format: z.enum(["xlsx", "csv"]).default("xlsx"),
  params: z.string().max(4000).default(""),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { module } = await params;
    const session = await requireSession();
    const mod = EXPORT_MODULES[module];
    if (!mod) return NextResponse.json({ error: "Unknown module" }, { status: 404 });
    // The precise gate is canExportModule (inside runExport); this names the
    // capability for the route guard.
    requireCap(session.roles, mod.exportCapability ?? "data.export", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "Choose at least one field to export." }, { status: 400 });
    const { fields, format } = parse.data;
    const qs = new URLSearchParams(parse.data.params.replace(/^\?/, ""));
    const file = await runExport(session, mod, fields, format, qs, clientMetaFromHeaders(req.headers));
    return new NextResponse(new Uint8Array(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "X-Export-Rows": String(file.rows),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ExportError) return NextResponse.json({ error: err.message }, { status: err.status });
    return handleApiError(err);
  }
}
