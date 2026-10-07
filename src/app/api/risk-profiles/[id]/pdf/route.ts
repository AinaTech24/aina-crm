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
import { requireAny, can } from "@/lib/auth/rbac";
import { renderRiskProfilePdf } from "@/lib/risk-profile/risk-profile-pdf";
import { loadActiveTemplate } from "@/lib/risk-profile/template";
import { loadSignatureImage } from "@/lib/risk-profile/signature-image";
import { riskSubjectScopeSql } from "@/lib/risk-profile/access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "investor.view.all", session.permissions);
    const { id } = await params;
    const download = req.nextUrl.searchParams.get("download") === "1";

    const built = await withTenant(session.tenantId, async (tx) => {
      // Tenant-scoped AND, for non-managers, owner-scoped — otherwise an RM could
      // pull any client's full risk PDF (name, PAN, every answer) by guessing the
      // profile id. The subject can be an investor (i.rm_id) OR a lead (the
      // response stores a lead id in investor_id polymorphically) — allow the
      // owning RM of either. Anything else yields no row (→ 404).
      const ownerScope = canViewAll
        ? sql`TRUE`
        : sql`(i.rm_id = ${session.userId}::uuid OR EXISTS (
            SELECT 1 FROM leads l WHERE l.id = r.investor_id AND l.owner_id = ${session.userId}::uuid
          ))`;
      const r = await tx.execute(sql`
        SELECT
          r.final_category, r.total_score, r.responses, r.profile_date, r.age,
          r.signed_at, r.signed_by_name, r.next_review_at, r.verification_method, r.document_url, r.created_at,
          r.verified_email, r.email_verified_at, r.client_ip, r.otp_transaction_id,
          i.name AS investor_name, i.pan AS investor_pan,
          i.address AS investor_address, i.email AS investor_email, i.phone AS investor_phone,
          i.id AS investor_id, u.name AS rm_name
        FROM risk_profile_responses r
        LEFT JOIN investors i ON i.id = r.investor_id
        LEFT JOIN users u ON u.id = i.rm_id
        WHERE r.id = ${id}::uuid AND r.tenant_id = ${session.tenantId}::uuid
          AND ${ownerScope}
          AND ${await riskSubjectScopeSql(tx, session, sql.raw("r.investor_id"))}
        LIMIT 1
      `);
      const row = r.rows[0] as any;
      if (!row) return null;

      const t = (
        await tx.execute(sql`
          SELECT display_name, legal_name, arn, principal_euin, gst_number,
                 primary_color, secondary_color, logo_url, phone, email, website, address
          FROM tenants WHERE id = ${session.tenantId}::uuid LIMIT 1
        `)
      ).rows[0] as any;

      // Template max score gives the number a scale ("24 / 40" on the PDF).
      // The client's goals become the chips under the gauge. Best-effort: a
      // client with none simply gets no goals section.
      let goalNames: string[] = [];
      if (row.investor_id) {
        try {
          const g = await tx.execute(sql`
            SELECT name FROM goals
            WHERE tenant_id = ${session.tenantId}::uuid AND investor_id = ${row.investor_id}::uuid
            ORDER BY created_at ASC LIMIT 8
          `);
          goalNames = (g.rows as Array<{ name?: string }>).map((x) => String(x.name ?? "").trim()).filter(Boolean);
        } catch {
          goalNames = [];
        }
      }

      const tpl = await loadActiveTemplate(tx, session.tenantId).catch(() => null);
      const maxScore = tpl
        ? tpl.questions.reduce((s, q) => s + Math.max(...q.options.map((o) => o.score)), 0)
        : null;

      const pdf = await renderRiskProfilePdf({
        profile: {
          category: row.final_category ?? null,
          totalScore: row.total_score != null ? Number(row.total_score) : null,
          maxScore,
          profileDate: row.profile_date ?? null,
          signedAt: row.signed_at ? new Date(row.signed_at).toISOString() : null,
          recordedAt: row.created_at ? new Date(row.created_at).toISOString() : null,
          signedByName: row.signed_by_name ?? null,
          nextReviewAt: row.next_review_at ?? null,
          age: row.age != null ? Number(row.age) : null,
          verificationMethod: row.verification_method ?? null,
          verification: {
            email: row.verified_email ?? null,
            verifiedAt: row.email_verified_at ? new Date(row.email_verified_at).toISOString() : null,
            ip: row.client_ip ?? null,
            reference: row.otp_transaction_id ?? null,
          },
          signatureImage: await loadSignatureImage(row.document_url),
          investmentGoals: goalNames,
          responses: Array.isArray(row.responses) ? row.responses : [],
          // The template drives the band ladder, the asset-allocation section and
          // the "every option, chosen one highlighted" questionnaire.
          bands: tpl?.bands ?? null,
          questions: tpl?.questions ?? null,
          templateDescription: tpl?.description ?? null,
        },
        investor: {
          name: row.investor_name ?? "Client",
          pan: row.investor_pan ?? null,
          address: row.investor_address ?? null,
          email: row.investor_email ?? null,
          phone: row.investor_phone ?? null,
        },
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
          address: t?.address ?? null,
        },
        generatedAt: new Date().toISOString(),
        refId: id,
        adviserName: row.rm_name ?? session.name ?? null,
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
        "content-disposition": `${disposition}; filename="RiskProfile_${safe}_${new Date().toISOString().slice(0, 10)}.pdf"`,
        // Inline previews re-open instantly within the window (the statement is
        // generated server-side and rarely changes); downloads stay uncached.
        "cache-control": download ? "no-store" : "private, max-age=120, must-revalidate",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
