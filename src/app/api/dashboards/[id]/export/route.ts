/**
 * GET /api/dashboards/[id]/export?w=<card>&<dashboard filters> — one card's
 * rows as CSV ("Export CSV" in the card's ⋯ menu). Read-only.
 *
 * Resolved exactly as the page resolves the card (components/dashboards/
 * system/prepare.ts): the viewer's access, the dashboard's filters and the
 * viewer's own card filter — so the file holds what the card showed.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { prepareDashboard, widgetCtx } from "@/components/dashboards/system/prepare";
import { widgetRegistry } from "@/components/dashboards/system/registry";
import { SYSTEM_WIDGETS_BY_KEY } from "@/lib/dashboards/system/catalog";

export const dynamic = "force-dynamic";

const cell = (v: string | number | null | undefined) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
    const instanceId = sp.w ?? "";
    delete sp.w;

    const p = await prepareDashboard(session, id, sp);
    if ("notFound" in p || "centre" in p) return NextResponse.json({ error: "not found" }, { status: 404 });
    const item = p.layout.find((i) => i.id === instanceId);
    const impl = item ? widgetRegistry(`/dashboard/${p.id}`)[item.widgetKey] : undefined;
    if (!item || !impl?.csv) return NextResponse.json({ error: "This card has no export" }, { status: 404 });

    const { ctx: wctx } = widgetCtx(p, item);
    const table = await withTenant(session.tenantId, (tx) => impl.csv!(tx, wctx));
    const title = item.title ?? SYSTEM_WIDGETS_BY_KEY[item.widgetKey]?.title ?? "export";
    const body = [table.columns.map(cell).join(","), ...table.rows.map((r) => r.map(cell).join(","))].join("\n");
    const file = `${p.name}-${title}-${wctx.period.from}-to-${wctx.period.to}`.replace(/[^\w.-]+/g, "_");
    return new NextResponse(`﻿${body}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${file}.csv"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
