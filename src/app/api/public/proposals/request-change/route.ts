/**
 * POST /api/public/proposals/request-change  { tokenId, note }
 *
 * The client wants something different. Before this, their only options were
 * to accept everything or say nothing — and "nothing" is how most proposals
 * actually end, with the RM never learning why.
 *
 * Uses up the link (the answer to this version is "change it"); the proposal
 * becomes `changes_requested`, the journey stays at Proposal Sent, and the RM
 * gets an urgent task carrying the client's own words. Revising the proposal
 * creates the next version with a fresh link.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { eventsOutbox, proposals } from "@/db/schema";
import { claimShareToken, finalizeShareToken, releaseShareToken } from "@/lib/share-tokens";
import { enforce, enforceLinkToken, PUBLIC_LINK_IP_CEILING } from "@/lib/rate-limit";
import { assertOpenForClient, loadProposalLink, proposalOwnerId } from "@/lib/proposals/public-link";
import { createProposalTask, firstName, notifyProposalOwner } from "@/lib/proposals/journey";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const limited = enforce(req, "public.proposal-change", PUBLIC_LINK_IP_CEILING);
    if (limited) return limited;
    const body = await req.json().catch(() => ({}));
    const tokenId = String(body.tokenId ?? "");
    const perToken = enforceLinkToken("public.proposal-change", tokenId, 10);
    if (perToken) return perToken;
    const note = String(body.note ?? "").trim().slice(0, 2000);
    if (note.length < 3) {
      return NextResponse.json({ error: "Tell us what you'd like changed." }, { status: 400 });
    }

    const link = await loadProposalLink(tokenId, { allowUsed: false });
    assertOpenForClient(link.proposal);

    if (!(await claimShareToken(tokenId))) {
      return NextResponse.json({ error: "You have already responded to this proposal." }, { status: 409 });
    }

    const p = link.proposal;
    const tenantId = link.token.tenantId!;
    try {
      await withTenant(tenantId, async (tx) => {
        const now = new Date();
        await tx
          .update(proposals)
          .set({ status: "changes_requested" as any, changeRequestNote: note, changeRequestedAt: now, updatedAt: now } as any)
          .where(eq(proposals.id, p.id));

        const ownerId = await proposalOwnerId(tx, p);
        await createProposalTask(tx, p, {
          assigneeId: ownerId,
          title: `${firstName(p.recipientName)} asked for changes to ${p.proposalNumber}`,
          description:
            `In the client's words:\n\n“${note}”\n\n` +
            `Revise the proposal (it becomes version ${(p.version ?? 1) + 1} with a fresh link) or call to discuss.`,
          priority: "urgent",
          dueInHours: 24,
          kind: "change_requested",
        });
        await notifyProposalOwner(tx, p, ownerId, {
          kind: "proposal.change_requested",
          title: `${firstName(p.recipientName)} asked for changes to your proposal`,
          body: note.length > 140 ? `${note.slice(0, 137)}…` : note,
          severity: "warning",
        });
        await tx.insert(eventsOutbox).values({
          tenantId,
          kind: "proposal.change_requested",
          entityType: "proposal",
          entityId: p.id,
          after: { note, leadId: p.leadId ?? null, investorId: p.investorId ?? null },
        } as any);
      });
    } catch (e) {
      await releaseShareToken(tokenId).catch(() => {});
      throw e;
    }

    await finalizeShareToken({
      id: tokenId,
      result: { changeRequested: true },
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "",
      userAgent: req.headers.get("user-agent") ?? "",
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 400;
    return NextResponse.json({ error: err?.message ?? "Something went wrong" }, { status });
  }
}
