/**
 * GET /api/public/proposals/pdf?token=<tokenId>[&download=1]
 *
 * The proposal PDF for the CLIENT, gated by their approval link.
 *
 * The approval page's "Read the full proposal" link pointed at
 * /api/proposals/[id]/pdf, which needs a CRM login — so a client clicking it
 * landed on the sign-in screen. A client who received the proposal by WhatsApp
 * (no attachment) could therefore never open the document they were being
 * asked to approve.
 *
 * Same renderProposalPdf() as the RM's download and the email attachment, so
 * all three are the same document. Keeps working after the client has
 * answered, so they can download their copy.
 */

import { NextRequest, NextResponse } from "next/server";
import { enforce, enforceLinkToken, PUBLIC_LINK_IP_CEILING } from "@/lib/rate-limit";
import { loadProposalLink } from "@/lib/proposals/public-link";
import { renderProposalPdf } from "@/lib/proposal/proposal-pdf";
import { loadProposalPdfPeople, proposalBrand } from "@/lib/proposal/pdf-context";
import { withSystem } from "@/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const limited = enforce(req, "public.proposal-pdf", PUBLIC_LINK_IP_CEILING);
    if (limited) return limited;
    const tokenId = req.nextUrl.searchParams.get("token") ?? "";
    const perToken = enforceLinkToken("public.proposal-pdf", tokenId, 60);
    if (perToken) return perToken;
    const download = req.nextUrl.searchParams.get("download") === "1";

    const { proposal: p, tenant: t } = await loadProposalLink(tokenId, { allowUsed: true });
    // The link is token-scoped, like loadProposalLink's own read.
    const people = await withSystem((tx) => loadProposalPdfPeople(tx, p as any));
    const pdf = await renderProposalPdf({ proposal: p as any, brand: proposalBrand(t), ...people });

    const safe = String(p.proposalNumber ?? p.id).replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
    return new NextResponse(pdf as any, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="Proposal_${safe}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 400;
    return NextResponse.json({ error: err?.message ?? "Something went wrong" }, { status });
  }
}
