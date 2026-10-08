/**
 * GET /api/public/feedback/pdf — the client's own feedback, as a PDF.
 *
 *   ?token=<tokenId>    a personal survey link (/f/<token>) — after submitting
 *   ?receipt=<receipt>  a response to the firm's public link (lib/feedback/receipt.ts)
 *   &download=1         save instead of open
 *
 * No session: the token or the signed receipt is the credential, and each
 * names exactly one response, so nothing else can be fetched with it. The PDF
 * carries the person's name, their answers and comment — never a PAN or any
 * other record — because on the public link the "client" matched by email is
 * not proof of who typed it.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { shareTokens } from "@/db/schema";
import { handleApiError } from "@/lib/api/error-handler";
import { enforce, enforceLinkToken, PUBLIC_LINK_IP_CEILING } from "@/lib/rate-limit";
import { renderClientFeedbackPdf } from "@/lib/support/client-feedback-pdf";
import { readFeedbackReceipt } from "@/lib/feedback/receipt";
import { FEEDBACK_QUESTIONS, type FeedbackAnswer } from "@/lib/support/feedback-questions";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    const limited = enforce(req, "public.feedback.pdf", PUBLIC_LINK_IP_CEILING);
    if (limited) return limited;
    const token = req.nextUrl.searchParams.get("token") ?? "";
    const receipt = req.nextUrl.searchParams.get("receipt") ?? "";
    const download = req.nextUrl.searchParams.get("download") === "1";
    const credential = token || receipt;
    if (!credential) return NextResponse.json({ error: "missing token" }, { status: 400 });
    const perLink = enforceLinkToken("public.feedback.pdf", credential, 60);
    if (perLink) return perLink;

    // Which response, in which firm.
    let target: { tenantId: string; serviceRequestId: string } | null = null;
    if (token) {
      if (!UUID.test(token)) return NextResponse.json({ error: "not found" }, { status: 404 });
      // A used token is expected here: the client downloads after submitting.
      const tk = await withSystem(async (tx) => {
        const [t] = await tx.select().from(shareTokens).where(eq(shareTokens.id, token));
        return t && !t.revokedAt && t.kind === "feedback" && t.tenantId ? t : null;
      });
      const srId = String(((tk?.result as Record<string, unknown> | null) ?? {}).serviceRequestId ?? "");
      if (tk && UUID.test(srId)) target = { tenantId: tk.tenantId!, serviceRequestId: srId };
    } else {
      target = readFeedbackReceipt(receipt);
    }
    if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });
    const { tenantId, serviceRequestId } = target;

    const built = await withTenant(tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT sr.ticket_no, sr.csat_rating, sr.csat_comment, sr.csat_responses, sr.csat_at,
               sr.timeline->0->>'by' AS signed_by, i.name AS client_name,
               (SELECT u.name FROM users u WHERE u.id = i.rm_id) AS rm_name
        FROM service_requests sr
        LEFT JOIN investors i ON i.id = sr.investor_id
        WHERE sr.id = ${serviceRequestId}::uuid AND sr.tenant_id = ${tenantId}::uuid AND sr.type = 'feedback'
        LIMIT 1
      `);
      const row = r.rows[0] as any;
      if (!row) return null;
      const t = (await tx.execute(sql`
        SELECT display_name, legal_name, arn, website, primary_color FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
      `)).rows[0] as any;
      return { row, tenant: t };
    });
    if (!built) return NextResponse.json({ error: "not found" }, { status: 404 });
    const { row, tenant } = built;

    // On a personal link the client is known; on the public link only the
    // name they typed is theirs to see.
    const name = (token ? row.client_name : null) ?? row.signed_by ?? "Client";
    // Each question as the firm's questionnaire words it — never the label the
    // browser happened to send with the answer.
    const answers: FeedbackAnswer[] | null = Array.isArray(row.csat_responses)
      ? (row.csat_responses as FeedbackAnswer[]).map((a) => ({
          ...a,
          label: FEEDBACK_QUESTIONS.find((q) => q.key === a.key)?.label ?? a.label,
        }))
      : null;
    const pdf = await renderClientFeedbackPdf({
      client: { name, pan: null, rmName: token ? row.rm_name ?? null : null },
      submissions: [{
        submittedAt: row.csat_at ?? null,
        rating: row.csat_rating != null ? Number(row.csat_rating) : null,
        comment: row.csat_comment ?? null,
        answers,
        ticketNo: row.ticket_no ?? null,
      }],
      brand: {
        displayName: tenant?.display_name,
        legalName: tenant?.legal_name,
        arn: tenant?.arn,
        website: tenant?.website,
        primaryColor: tenant?.primary_color,
      },
      generatedAt: new Date().toISOString(),
    });

    const safe = String(name).replace(/[^a-z0-9]+/gi, "_").slice(0, 40) || "feedback";
    return new NextResponse(pdf as any, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="Feedback_${safe}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
