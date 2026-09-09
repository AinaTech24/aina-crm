/**
 * GET /api/support/feedback/pdf
 *   Branded Client Satisfaction & NPS report for the whole firm.
 *   ?download=1 forces a save dialog; otherwise it opens inline.
 *
 * Reads the same rows the dashboard page shows: service requests of type
 * 'feedback' carrying a CSAT rating, newest first.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { serviceRequests, investors, tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { renderFeedbackPdf } from "@/lib/support/feedback-pdf";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Same read gate as the page itself — anyone who can see a client's service
    // requests can see the firm's satisfaction summary.
    requireAny(
      session.roles,
      [
        "investor.view.all",
        "investor.view.assigned",
        "service_request.view.all",
        "service_request.view.assigned",
        "service_request.manage",
      ],
      session.permissions
    );
    const download = req.nextUrl.searchParams.get("download") === "1";

    const built = await withTenant(session.tenantId, async (tx) => {
      const rows = await tx
        .select({
          clientName: investors.name,
          subject: serviceRequests.subject,
          rating: serviceRequests.csatRating,
          comment: serviceRequests.csatComment,
          submittedAt: serviceRequests.csatAt,
        })
        .from(serviceRequests)
        .leftJoin(investors, eq(investors.id, serviceRequests.investorId))
        .where(
          and(
            eq(serviceRequests.tenantId, session.tenantId),
            eq(serviceRequests.type, "feedback"),
            isNotNull(serviceRequests.csatRating)
          )
        )
        .orderBy(desc(serviceRequests.csatAt));

      const [t] = await tx
        .select({
          displayName: tenants.displayName,
          legalName: tenants.legalName,
          arn: tenants.arn,
          website: tenants.website,
          primaryColor: tenants.primaryColor,
        })
        .from(tenants)
        .where(eq(tenants.id, session.tenantId));

      return { rows, tenant: t ?? null };
    });

    const pdf = await renderFeedbackPdf({
      rows: built.rows.map((r) => ({
        // A feedback row from a LEAD has no investor join; fall back to the
        // ticket subject rather than printing a blank name.
        clientName: r.clientName ?? r.subject ?? "Client",
        rating: r.rating != null ? Number(r.rating) : null,
        comment: r.comment ?? null,
        submittedAt: r.submittedAt ?? null,
      })),
      brand: {
        displayName: built.tenant?.displayName,
        legalName: built.tenant?.legalName,
        arn: built.tenant?.arn,
        website: built.tenant?.website,
        primaryColor: built.tenant?.primaryColor,
      },
      generatedAt: new Date().toISOString(),
    });

    return new NextResponse(pdf as any, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="Client_Feedback_NPS_${new Date()
          .toISOString()
          .slice(0, 10)}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
