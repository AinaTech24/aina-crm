import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/investors/[id]/client-report — the consolidated client report PDF
 * (profile, family, portfolio, SIPs, transactions, FDs, goals, insurance,
 * claims, meetings, opportunities, activity, tasks, service requests,
 * messages, documents, record gaps). Per-firm flag `clientReportPdf`.
 *
 *   ?sections=profile,portfolio,…   which sections (default: all)
 *   ?copy=client                    the client copy — internal sections are dropped
 *
 * Access follows the client page: the client must be in the viewer's book,
 * and each printed field obeys the licence's field gates. Every download
 * writes a DPDP PII-access row.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { loadTenantLicense } from "@/lib/auth/license";
import { auditLog, tenants } from "@/db/schema";
import { buildClientReport } from "@/lib/investors/client-report";
import { reportPdfResponse } from "@/lib/investors/report-response";
import {
  CLIENT_COPY_SECTIONS,
  CLIENT_REPORT_FLAG,
  parseClientReportSections,
} from "@/lib/investors/client-report-sections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const session = await requireSession();
    if (!can(session.roles, "investor.view.all", session.permissions) && !can(session.roles, "investor.view.assigned", session.permissions)) {
      return NextResponse.json({ error: "You cannot view clients." }, { status: 403 });
    }
    const license = await loadTenantLicense(session.tenantId, session.roles);
    if (license.featureFlags?.[CLIENT_REPORT_FLAG] !== true) {
      return NextResponse.json({ error: "The client report is not switched on for your firm." }, { status: 404 });
    }

    const clientCopy = req.nextUrl.searchParams.get("copy") === "client";
    let sections = parseClientReportSections(req.nextUrl.searchParams.get("sections"));
    if (clientCopy) sections = sections.filter((s) => CLIENT_COPY_SECTIONS.includes(s));

    const built = await withTenant(
      session.tenantId,
      async (tx) => {
        const report = await buildClientReport(tx, session, license, id, sections, { clientCopy });
        if (!report) return null;
        const [t] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
        await tx.insert(auditLog).values({
          tenantId: session.tenantId,
          actorUserId: session.userId,
          actorType: "user",
          action: "investor.report_pdf",
          entityType: "investor",
          entityId: id,
          piiAccessed: report.pii,
          reason: `Client report PDF (${clientCopy ? "client copy" : "complete"}): ${sections.join(", ")}`,
        });
        return { report, tenant: t };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles },
    );
    if (!built) return NextResponse.json({ error: "not found" }, { status: 404 });

    return await reportPdfResponse(req, built.tenant, built.report, {
      title: clientCopy ? "CLIENT REPORT" : "CLIENT REPORT - COMPLETE RECORD",
      filePrefix: "Client_Report",
    });
  } catch (err) {
    return handleApiError(err);
  }
}
