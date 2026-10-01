/**
 * Public proposal approval — POST /api/public/proposals/accept.
 *
 * Body: { tokenId, signatureName, acceptedItems?: number[] }
 *
 * Records SEBI-grade evidence into proposal_approvals, sets the proposal to
 * `accepted` — or `partially_approved` when the client took only some of the
 * recommendations — and moves the journey to Won.
 *
 * Three things this used to get wrong:
 *  - It moved the journey to a stage called `proposal_approved` that was
 *    retired in an earlier redesign. The move failed, the error was swallowed,
 *    and the client's yes never appeared in the journey's history.
 *  - It stored the acceptance text the BROWSER sent, so the "exact agreed
 *    text" in the audit record was whatever the request claimed.
 *  - Accepting was all-or-nothing, so a client who wanted two of three funds
 *    had no honest way to say so.
 *
 * After the commit, a LEAD's onboarding starts by itself: the document-
 * collection link goes out exactly as the "Send Doc Checklist" button sends it
 * (lib/onboarding/send-doc-checklist.ts), unless the firm already runs the
 * workflow recipe that does the same. If the send can't happen, the RM gets a
 * task instead — onboarding is never silently skipped.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { proposals, proposalApprovals, eventsOutbox } from "@/db/schema";
import { claimShareToken, releaseShareToken, finalizeShareToken } from "@/lib/share-tokens";
import { enforce, enforceLinkToken, PUBLIC_LINK_IP_CEILING } from "@/lib/rate-limit";
import {
  PROPOSAL_ACCEPTANCE_TEXT,
  assertOpenForClient,
  loadProposalLink,
  proposalOwnerId,
} from "@/lib/proposals/public-link";
import {
  advanceJourneyForProposal,
  currentStage,
  firstName,
  notifyProposalOwner,
  startOnboarding,
} from "@/lib/proposals/journey";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // Coarse brake only — see PUBLIC_LINK_IP_CEILING.
    const limited = enforce(req, "public.proposal-accept", PUBLIC_LINK_IP_CEILING);
    if (limited) return limited;

    const body = await req.json().catch(() => ({}));
    const tokenId = String(body.tokenId ?? "");
    const perToken = enforceLinkToken("public.proposal-accept", tokenId, 10);
    if (perToken) return perToken;
    // Bound the untrusted input — it lands in proposal_approvals text columns.
    const signatureName = String(body.signatureName ?? "").trim().slice(0, 120);
    if (!tokenId) return NextResponse.json({ error: "missing tokenId" }, { status: 400 });
    if (!signatureName) return NextResponse.json({ error: "Please type your full name to sign." }, { status: 400 });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const ua = req.headers.get("user-agent") ?? "";

    // Step 1: resolve the link (cross-tenant — no session) and check the
    // proposal can still take an answer.
    const link = await loadProposalLink(tokenId, { allowUsed: false });
    assertOpenForClient(link.proposal);

    const products = Array.isArray(link.proposal.products) ? link.proposal.products : [];
    // Which recommendations the client took. Absent (an older cached page) =
    // everything, which is what that page's single checkbox meant.
    const requested: unknown = body.acceptedItems;
    let accepted: number[];
    if (requested === undefined || requested === null) {
      accepted = products.map((_, i) => i);
    } else if (Array.isArray(requested)) {
      accepted = [...new Set(requested.map(Number))]
        .filter((i) => Number.isInteger(i) && i >= 0 && i < products.length)
        .sort((a, b) => a - b);
    } else {
      return NextResponse.json({ error: "invalid acceptedItems" }, { status: 400 });
    }
    if (products.length > 0 && accepted.length === 0) {
      return NextResponse.json(
        { error: "Tick at least one recommendation to accept, or use “Ask for a change”." },
        { status: 400 }
      );
    }
    const partial = products.length > 0 && accepted.length < products.length;

    // Step 1b: atomically CLAIM the single-use token before doing any work, so
    // two concurrent accepts can't both record an approval + double-fire the
    // downstream onboarding. The loser aborts.
    const claimed = await claimShareToken(tokenId);
    if (!claimed) {
      return NextResponse.json({ error: "You have already responded to this proposal." }, { status: 409 });
    }

    const p = link.proposal;
    const tenantId = link.token.tenantId!;
    const acceptedNames = accepted.map((i) => productName(products[i]));

    // Step 2: writes inside the token's tenant scope, so RLS blocks any
    // cross-tenant write even if a future bug leaks a token id. If the work
    // throws after the claim, release the token so the client can retry.
    let out: { approvalId: string; ownerId: string | null; leadId: string | null; stage: string | null };
    try {
      out = await withTenant(tenantId, async (tx) => {
        const approvalId = uuid();
        const now = new Date();

        await tx.insert(proposalApprovals).values({
          id: approvalId,
          tenantId,
          proposalId: p.id,
          // The SERVER's text — what the page showed — never the request's.
          acceptanceText: PROPOSAL_ACCEPTANCE_TEXT,
          signatureName,
          channel: "portal" as any,
          ipAddress: ip,
          userAgent: ua,
          shareTokenId: link.token.id,
          acceptedAt: now,
          meta: {
            acceptedItems: accepted,
            acceptedNames,
            totalItems: products.length,
            partial,
          },
        } as any);

        await tx
          .update(proposals)
          .set({
            status: (partial ? "partially_approved" : "accepted") as any,
            acceptedItems: accepted,
            acceptedAt: now,
            updatedAt: now,
          } as any)
          .where(eq(proposals.id, p.id));

        const leadId = await advanceJourneyForProposal(
          tx,
          p,
          "proposal.accepted",
          `Client ${partial ? `accepted ${accepted.length} of ${products.length} recommendations in` : "accepted"} proposal ${p.proposalNumber} via secure link.`
        );

        // Kept for firms that built workflows on it (including the
        // request-documents recipe), now with what was accepted.
        await tx.insert(eventsOutbox).values({
          tenantId,
          kind: "proposal.accepted",
          entityType: "proposal",
          entityId: p.id,
          after: { approvalId, signature: signatureName, leadId: p.leadId ?? null, acceptedItems: accepted, partial },
          meta: { tokenId, ip, userAgent: ua } as any,
        } as any);

        const ownerId = await proposalOwnerId(tx, p);
        await notifyProposalOwner(tx, p, ownerId, {
          kind: "proposal.accepted",
          title: partial
            ? `${firstName(p.recipientName)} accepted ${accepted.length} of ${products.length} recommendations`
            : `${firstName(p.recipientName)} accepted your proposal`,
          body: `${p.proposalNumber}${partial ? ` · accepted: ${acceptedNames.join(", ")}` : ""}`,
          severity: "success",
        });

        return { approvalId, ownerId, leadId, stage: leadId ? await currentStage(tx, leadId) : null };
      });
    } catch (e) {
      await releaseShareToken(tokenId).catch(() => {});
      throw e;
    }

    // Confirm the claim by storing the result payload (used_at already set).
    await finalizeShareToken({
      id: tokenId,
      result: { approvalId: out.approvalId, signature: signatureName, acceptedItems: accepted },
      ipAddress: ip,
      userAgent: ua,
    });

    // Step 3: a lead's onboarding starts now (design decision 3). Outside the
    // transaction on purpose — it sends email and WhatsApp, and a send must
    // never sit inside a transaction that could still roll back.
    const onboarding = await startOnboarding(tenantId, p, out).catch((e) => {
      console.error("[proposals/accept] onboarding start failed:", e?.message ?? e);
      return "failed" as const;
    });

    return NextResponse.json(
      { approvalId: out.approvalId, status: partial ? "partially_approved" : "accepted", acceptedItems: accepted, onboarding },
      { status: 201 }
    );
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 400;
    return NextResponse.json({ error: err?.message ?? "Something went wrong" }, { status });
  }
}

function productName(item: any): string {
  return String(
    item?.schemeName ?? item?.policyName ?? item?.strategyName ?? item?.fundName ?? item?.productName ?? "Recommendation"
  );
}
