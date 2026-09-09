import { assertInvestorAccess } from "@/lib/investors/access";
/**
 * GET /api/investors/[id]/feedback/pdf
 *   Branded Client Feedback Report for ONE client — every submission with each
 *   question's score, and the movement against their previous response.
 *   ?download=1 forces a save dialog.
 *
 * Owner-scoped like the rest of a client's record: a manager sees any client,
 * an RM only their own. Anything else yields no row and a 404, rather than
 * letting a guessed id expose another client's feedback.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { renderClientFeedbackPdf } from "@/lib/support/client-feedback-pdf";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    await assertInvestorAccess(session, id);
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "investor.view.all", session.permissions);
    const download = req.nextUrl.searchParams.get("download") === "1";

    const built = await withTenant(session.tenantId, async (tx) => {
      const ownerScope = canViewAll ? sql`TRUE` : sql`i.rm_id = ${session.userId}::uuid`;

      const invRes = await tx.execute(sql`
        SELECT i.name, i.pan, u.name AS rm_name
        FROM investors i
        LEFT JOIN users u ON u.id = i.rm_id
        WHERE i.id = ${id}::uuid AND i.tenant_id = ${session.tenantId}::uuid AND ${ownerScope}
        LIMIT 1
      `);
      const inv = invRes.rows[0] as { name?: string; pan?: string; rm_name?: string } | undefined;
      if (!inv) return null;

      const subs = await tx.execute(sql`
        SELECT ticket_no, csat_rating, csat_comment, csat_responses, csat_at
        FROM service_requests
        WHERE tenant_id = ${session.tenantId}::uuid
          AND investor_id = ${id}::uuid
          AND type = 'feedback'
          AND csat_at IS NOT NULL
        ORDER BY csat_at DESC
      `);

      const t = (
        await tx.execute(sql`
          SELECT display_name, legal_name, arn, website, primary_color
          FROM tenants WHERE id = ${session.tenantId}::uuid LIMIT 1
        `)
      ).rows[0] as any;

      return { inv, rows: subs.rows as any[], tenant: t };
    });

    if (!built) return NextResponse.json({ error: "not found" }, { status: 404 });

    const pdf = await renderClientFeedbackPdf({
      client: {
        name: built.inv.name ?? "Client",
        pan: built.inv.pan ?? null,
        rmName: built.inv.rm_name ?? null,
      },
      submissions: built.rows.map((r) => ({
        submittedAt: r.csat_at ?? null,
        rating: r.csat_rating != null ? Number(r.csat_rating) : null,
        comment: r.csat_comment ?? null,
        // Rows predating the questionnaire have no per-question answers; the
        // renderer falls back to the single recommend score for those.
        answers: Array.isArray(r.csat_responses) ? r.csat_responses : null,
        ticketNo: r.ticket_no ?? null,
      })),
      brand: {
        displayName: built.tenant?.display_name,
        legalName: built.tenant?.legal_name,
        arn: built.tenant?.arn,
        website: built.tenant?.website,
        primaryColor: built.tenant?.primary_color,
      },
      generatedAt: new Date().toISOString(),
    });

    const safe = String(built.inv.name ?? "client").replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
    return new NextResponse(pdf as any, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="Feedback_${safe}_${new Date()
          .toISOString()
          .slice(0, 10)}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
