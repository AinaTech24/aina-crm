/**
 * POST /api/public/proposals/viewed  { tokenId }
 *
 * The client opened their proposal. Opening the link used to record nothing,
 * so "Viewed" appeared only if the RM set it by hand and nobody knew whether a
 * silent client had even looked.
 *
 * Called by the approval page from the BROWSER after it renders, never from
 * the server render. A WhatsApp or email link preview fetches the page too;
 * those crawlers don't run scripts, so a preview no longer counts as the
 * client opening it.
 *
 * The first open moves sent → viewed and tells the RM. Later opens only
 * count. Opening after the client has answered still counts, and changes
 * nothing else.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { proposals } from "@/db/schema";
import { enforce, enforceLinkToken, PUBLIC_LINK_IP_CEILING } from "@/lib/rate-limit";
import { loadProposalLink, proposalOwnerId } from "@/lib/proposals/public-link";
import { firstName, notifyProposalOwner } from "@/lib/proposals/journey";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const limited = enforce(req, "public.proposal-viewed", PUBLIC_LINK_IP_CEILING);
    if (limited) return limited;
    const body = await req.json().catch(() => ({}));
    const tokenId = String(body.tokenId ?? "");
    const perToken = enforceLinkToken("public.proposal-viewed", tokenId, 60);
    if (perToken) return perToken;

    const link = await loadProposalLink(tokenId, { allowUsed: true });
    const p = link.proposal;

    const first = await withTenant(link.token.tenantId!, async (tx) => {
      const now = new Date();
      const firstOpen = !p.viewedAt;
      await tx
        .update(proposals)
        .set({
          viewCount: sql`${proposals.viewCount} + 1`,
          lastViewedAt: now,
          ...(firstOpen ? { viewedAt: now } : {}),
          // Only an unanswered proposal becomes "viewed"; an accepted one
          // stays accepted however often the client re-reads it.
          ...(p.status === "sent" ? { status: "viewed" as any } : {}),
          updatedAt: now,
        } as any)
        .where(eq(proposals.id, p.id));

      if (firstOpen) {
        await notifyProposalOwner(tx, p, await proposalOwnerId(tx, p), {
          kind: "proposal.viewed",
          title: `${firstName(p.recipientName)} opened your proposal`,
          body: `${p.proposalNumber} — a good moment to call.`,
        });
      }
      return firstOpen;
    });

    return NextResponse.json({ ok: true, first });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 400;
    return NextResponse.json({ error: err?.message ?? "Something went wrong" }, { status });
  }
}
