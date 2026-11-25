import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/investors/[id]/client-master/pdf?include=meetings,serviceRequests,tasks,emails,gifts&download=1
 *
 * The client master as one PDF: Client Master (KYC & profile, nominees, referrals, risk
 * profile), portfolio, fixed deposits, cross-sell holdings, review details, the optional
 * sections named in `include` (only those the viewer's role may see), then notes.
 * Same access as the client page; the download is audited because it carries personal data.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { loadClientMaster, OPTIONAL_KEYS, type OptionalKey } from "@/lib/investors/client-master/load";
import { renderClientMasterPdf } from "@/lib/investors/client-master/render";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const { id } = await params;
    const download = req.nextUrl.searchParams.get("download") === "1";
    const include = (req.nextUrl.searchParams.get("include") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is OptionalKey => (OPTIONAL_KEYS as string[]).includes(s));

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const loaded = await loadClientMaster(tx, session, id, include);
        if (!loaded) return null;
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "investor.client_master_downloaded",
          entityType: "investor",
          entityId: id,
          after: { sections: OPTIONAL_KEYS.filter((k) => loaded.optional[k]) },
          piiAccessed: { source: "client_master_pdf", fields: ["pan", "dob", "contact", "address", "bank", "nominees", "risk_profile"] },
        });
        return loaded;
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles },
    );
    if (!data) return NextResponse.json({ error: "client not found" }, { status: 404 });

    const pdf = await renderClientMasterPdf(data);
    const safe = data.client.name.replace(/[^a-z0-9]+/gi, "_").slice(0, 40) || "client";
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="ClientMaster_${safe}_${new Date().toISOString().slice(0, 10)}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err: unknown) {
    return handleApiError(err);
  }
}
