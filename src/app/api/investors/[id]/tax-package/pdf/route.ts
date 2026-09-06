import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/investors/[id]/tax-package/pdf?fy=2025&download=1
 *   One client's tax package for a financial year: realised capital gains
 *   (FIFO working), IDCW received, and the unrealised position at the latest
 *   NAV — on the firm's letterhead. Streams application/pdf; ?download=1
 *   forces a save dialog, default is inline preview.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { fifoRealizedGains } from "@/lib/tax/realized-gains";
import { loadFirmTxGroups, loadLatestNav, loadDividendDetail, notionalLotsFor, parseFy, fyLabel } from "@/lib/tax/firm-gains";
import { renderTaxPackagePdf } from "@/lib/tax/tax-package-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const { id } = await params;
    const fy = parseFy(req.nextUrl.searchParams.get("fy") ?? undefined);
    const download = req.nextUrl.searchParams.get("download") === "1";

    const built = await withTenant(session.tenantId, async (tx) => {
      const inv = (await tx.execute(sql`
        SELECT id, name, pan FROM investors
         WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL
         LIMIT 1
      `)).rows[0] as { id: string; name: string; pan: string | null } | undefined;
      if (!inv) return null;

      // Brand columns only — never `select *` on tenants from a route (schema drift on
      // one optional column must not break every tax PDF).
      const brand = (await tx.execute(sql`
        SELECT display_name, legal_name, arn, primary_color, secondary_color
          FROM tenants WHERE id = ${session.tenantId}::uuid LIMIT 1
      `)).rows[0] as any;

      const [groups, nav, dividends] = await Promise.all([
        loadFirmTxGroups(tx, { tenantId: session.tenantId, investorId: id }),
        loadLatestNav(tx),
        loadDividendDetail(tx, { tenantId: session.tenantId, investorId: id, fy }),
      ]);
      const group = groups.get(id) ?? { investorId: id, name: inv.name, pan: inv.pan, rmId: null, rows: [], cats: new Map() };
      const realised = fifoRealizedGains(group.rows, fy);
      const { lots } = notionalLotsFor(group, nav, fy);

      const pdf = await renderTaxPackagePdf({
        investor: { name: inv.name ?? "Client", pan: inv.pan ?? null },
        brand: {
          displayName: brand?.display_name ?? null,
          legalName: brand?.legal_name ?? null,
          arn: brand?.arn ?? null,
          primaryColor: brand?.primary_color ?? null,
          secondaryColor: brand?.secondary_color ?? null,
        },
        fy,
        realised,
        dividends,
        notional: { lots, asOf: new Date().toISOString().slice(0, 10) },
        generatedAt: new Date().toISOString(),
      });
      return { pdf, name: inv.name ?? "client" };
    });

    if (!built) return NextResponse.json({ error: "not found" }, { status: 404 });

    const safe = built.name.replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
    const disposition = download ? "attachment" : "inline";
    return new NextResponse(built.pdf as any, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${disposition}; filename="TaxPackage_${safe}_${fyLabel(fy).replace(/\s/g, "")}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
