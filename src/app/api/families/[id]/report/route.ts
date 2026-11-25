import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/families/[id]/report — the whole family in one PDF: the family's
 * summary and members, then every section across all members with a Member
 * column (profiles, portfolio, SIPs, transactions, FDs, goals, insurance with
 * each policy's details, claims, meetings incl. family reviews, opportunities,
 * activity, tasks, service requests, messages, documents, record gaps).
 * Per-firm flag `clientReportPdf`.
 *
 *   ?sections=profile,portfolio,…   which sections (default: all)
 *   ?copy=client                    the family copy — internal sections are dropped
 *
 * Access follows the family page (loadViewableFamily). Every download writes
 * a DPDP PII-access row on the family.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { loadTenantLicense } from "@/lib/auth/license";
import { auditLog, tenants } from "@/db/schema";
import { buildFamilyReport } from "@/lib/investors/client-report";
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
      return NextResponse.json({ error: "The family report is not switched on for your firm." }, { status: 404 });
    }

    const clientCopy = req.nextUrl.searchParams.get("copy") === "client";
    let sections = parseClientReportSections(req.nextUrl.searchParams.get("sections")).filter((s) => s !== "family");
    if (clientCopy) sections = sections.filter((s) => CLIENT_COPY_SECTIONS.includes(s));

    const built = await withTenant(
      session.tenantId,
      async (tx) => {
        const report = await buildFamilyReport(tx, session, license, id, sections, { clientCopy });
        if (!report) return null;
        const [t] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
        await tx.insert(auditLog).values({
          tenantId: session.tenantId,
          actorUserId: session.userId,
          actorType: "user",
          action: "family.report_pdf",
          entityType: "family",
          entityId: id,
          piiAccessed: report.pii,
          reason: `Family report PDF (${clientCopy ? "family copy" : "complete"}): ${sections.join(", ")}`,
        });
        return { report, tenant: t };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles },
    );
    if (!built) return NextResponse.json({ error: "not found" }, { status: 404 });

    return await reportPdfResponse(req, built.tenant, built.report, {
      title: clientCopy ? "FAMILY REPORT" : "FAMILY REPORT - COMPLETE RECORD",
      filePrefix: "Family_Report",
    });
  } catch (err) {
    return handleApiError(err);
  }
}
