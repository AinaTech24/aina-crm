import { handleApiError } from "@/lib/api/error-handler";
/**
 * Service requests / complaint register.
 *   GET  /api/service-requests
 *   POST /api/service-requests
 *
 * Complaints are routed through the SEBI-format register. SLA clocks are
 * computed from the type: complaints = 30 days max, KYC updates = 7 days, etc.
 */

import { NextRequest, NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { serviceRequests } from "@/db/schema";
import { openServiceRequest } from "@/lib/service-requests/open";
import { serviceRequestScopeSql } from "@/lib/service-requests/access";
import { loadViewableInvestor } from "@/lib/investors/access";

export const dynamic = "force-dynamic";

// SLA clocks, the ticket number, the event and the acknowledgement live in
// lib/service-requests/open.ts — shared with the public complaint form.

const CreateBody = z.object({
  investorId: z.string().uuid().optional(),
  assignedToUserId: z.string().uuid().optional(),
  type: z.enum([
    // Spec-canonical (13)
    "nominee_update",
    "bank_update",
    "mobile_update",
    "email_update",
    "kyc_update",
    "minor_to_major",
    "capital_gain_report",
    "statement_request",
    "redemption_request",
    "switch_request",
    "transmission_case",
    "folio_correction",
    "other",
    // Legacy
    "complaint",
    "redemption_help",
    "switch_help",
    "transaction_query",
  ]),
  channel: z.enum(["whatsapp", "email", "phone", "in_person", "form"]).optional(),
  subject: z.string().min(2).max(300),
  description: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  sebiCategory: z.string().optional(),
  sebiSubCategory: z.string().optional(),
  complaintSource: z.string().optional(),
  scoresRefNo: z.string().max(80).optional(),
  remarks: z.string().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => {
      // Only the tickets this viewer may see (lib/service-requests/access.ts).
      const scope = await serviceRequestScopeSql(tx, session, "service_requests");
      return tx.select().from(serviceRequests).where(sql`${scope}`).orderBy(desc(serviceRequests.createdAt));
    });
    return NextResponse.json({ serviceRequests: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "service_request.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const body = parse.data;

    const { id } = await withTenant(session.tenantId, async (tx) => {
      // A ticket may only be raised for a client the caller can see.
      if (body.investorId && !(await loadViewableInvestor(tx, session, body.investorId))) {
        throw Object.assign(new Error("client not found"), { status: 404 });
      }
      return openServiceRequest(tx, {
        tenantId: session.tenantId,
        type: body.type,
        subject: body.subject,
        description: body.description,
        priority: body.priority,
        channel: body.channel,
        investorId: body.investorId ?? null,
        assignedToUserId: body.assignedToUserId ?? session.userId,
        sebiCategory: body.sebiCategory,
        sebiSubCategory: body.sebiSubCategory,
        complaintSource: body.complaintSource,
        scoresRefNo: body.scoresRefNo,
        remarks: body.remarks,
        createdBy: { by: session.userId, note: `Created by ${session.name}` },
        eventMeta: { userId: session.userId },
      });
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
