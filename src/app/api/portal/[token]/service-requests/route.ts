import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { investors, serviceRequests } from "@/db/schema";
import { resolvePortalAccess } from "@/lib/portal/access";
import { recordAudit } from "@/lib/audit";
import { handleApiError } from "@/lib/api/error-handler";
import { openServiceRequest } from "@/lib/service-requests/open";
import { createNotification } from "@/lib/notifications/create";

export const dynamic = "force-dynamic";

const Body = z.object({
  type: z.enum(["statement_request", "capital_gain_report", "nominee_update", "bank_update", "kyc_update", "other"]),
  subject: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const access = await resolvePortalAccess(token, false);
    if (!access || !access.scopes.includes("service_requests")) {
      return NextResponse.json({ error: "invalid or expired portal link" }, { status: 401 });
    }
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });

    const result = await withTenant(access.tenantId, async (tx) => {
      const [investor] = await tx
        .select({ name: investors.name, rmId: investors.rmId })
        .from(investors)
        .where(eq(investors.id, access.investorId))
        .limit(1);
      if (!investor) return null;

      const [open] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(serviceRequests)
        .where(
          and(
            eq(serviceRequests.investorId, access.investorId),
            inArray(serviceRequests.status, ["open", "in_progress", "waiting_customer", "escalated"])
          )
        );
      if ((open?.count ?? 0) >= 5) return { limited: true as const };

      // One way a ticket starts (lib/service-requests/open.ts): ticket number,
      // the type's SLA clocks, the created event and the client's acknowledgement.
      const sr = await openServiceRequest(tx, {
        tenantId: access.tenantId,
        type: parsed.data.type,
        channel: "form",
        subject: parsed.data.subject,
        description: parsed.data.description ?? null,
        investorId: access.investorId,
        assignedToUserId: investor.rmId ?? null,
        createdBy: { by: "client_portal", note: `Submitted by ${investor.name} through the investor portal.` },
        eventMeta: { source: "investor_portal", investorId: access.investorId, portalAccessId: access.id },
      });
      const { id, ticketNo } = sr;

      if (investor.rmId) {
        await createNotification(tx, {
          tenantId: access.tenantId,
          userId: investor.rmId,
          kind: "service_request.portal",
          title: "New service request from a client's portal",
          body: `${ticketNo} · ${investor.name} · ${parsed.data.subject}`,
          linkUrl: `/dashboard/service-requests/${id}`,
          severity: "info",
        });
      }
      await recordAudit(tx, {
        tenantId: access.tenantId,
        actorType: "system",
        action: "service_request.portal_create",
        entityType: "service_request",
        entityId: id,
        after: { ticketNo, type: parsed.data.type, investorId: access.investorId },
        reason: "Submitted through an expiring investor portal link",
      });
      return { limited: false as const, ticketNo };
    });

    if (!result) return NextResponse.json({ error: "client not found" }, { status: 404 });
    if (result.limited) return NextResponse.json({ error: "Please wait for the firm to resolve an open request before adding another." }, { status: 429 });
    return NextResponse.json({ ticketNo: result.ticketNo }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

