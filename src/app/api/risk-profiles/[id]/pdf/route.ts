import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/risk-profiles/[id]/pdf
 *   Branded Risk Profiling statement (PDF) for a completed risk_profile_responses
 *   row. Session-gated (the MFD/RM). ?download=1 forces a save dialog.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { renderRiskProfilePdf } from "@/lib/risk-profile/risk-profile-pdf";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const { id } = await params;
    const download = req.nextUrl.searchParams.get("download") === "1";

    const built = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT
          r.final_category, r.total_score, r.responses, r.profile_date, r.age,
          r.signed_at, r.signed_by_name, r.next_review_at, r.verification_method,
          i.name AS investor_name, i.pan AS investor_pan
        FROM risk_profile_responses r
        LEFT JOIN investors i ON i.id = r.investor_id
        WHERE r.id = ${id}::uuid AND r.tenant_id = ${session.tenantId}::uuid
        LIMIT 1
      `);
      const row = r.rows[0] as any;
      if (!row) return null;

      const t = (
        await tx.execute(sql`
          SELECT display_name, legal_name, arn, principal_euin, gst_number,
                 primary_color, secondary_color, logo_url, phone, email, website
          FROM tenants WHERE id = ${session.tenantId}::uuid LIMIT 1
        `)
      ).rows[0] as any;

      const pdf = await renderRiskProfilePdf({
        profile: {
          category: row.final_category ?? null,
          totalScore: row.total_score != null ? Number(row.total_score) : null,
          profileDate: row.profile_date ?? null,
          signedAt: row.signed_at ? new Date(row.signed_at).toISOString() : null,
          signedByName: row.signed_by_name ?? null,
          nextReviewAt: row.next_review_at ?? null,
          age: row.age != null ? Number(row.age) : null,
          verificationMethod: row.verification_method ?? null,
          responses: Array.isArray(row.responses) ? row.responses : [],
        },
        investor: { name: row.investor_name ?? "Client", pan: row.investor_pan ?? null },
        brand: {
          displayName: t?.display_name,
          legalName: t?.legal_name,
          arn: t?.arn,
          euin: t?.principal_euin,
          gstNumber: t?.gst_number,
          primaryColor: t?.primary_color,
          secondaryColor: t?.secondary_color,
          logoUrl: t?.logo_url,
          phone: t?.phone,
          email: t?.email,
          website: t?.website,
        },
        generatedAt: new Date().toISOString(),
      });
      return { pdf, name: row.investor_name ?? "client" };
    });

    if (!built) return NextResponse.json({ error: "not found" }, { status: 404 });

    const safe = String(built.name).replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
    const disposition = download ? "attachment" : "inline";
    return new NextResponse(built.pdf as any, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${disposition}; filename="risk_profile_${safe}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
