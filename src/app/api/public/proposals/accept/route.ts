/**
 * Public proposal approval — POST /api/public/proposals/accept.
 *
 * Records SEBI-grade evidence into proposal_approvals + flips the proposal
 * status to 'accepted'. Pushes an outbox event so a workflow can fire the
 * "send KYC docs collection form" comm or whatever the firm has configured.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { shareTokens, proposals, proposalApprovals, eventsOutbox, leads } from "@/db/schema";
import { markShareTokenUsed } from "@/lib/share-tokens";
import { transitionTo } from "@/lib/blueprints/engine";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tokenId = String(body.tokenId ?? "");
    const signatureName = String(body.signatureName ?? "").trim();
    const acceptanceText = String(body.acceptanceText ?? "").trim();
    if (!tokenId) return NextResponse.json({ error: "missing tokenId" }, { status: 400 });
    if (!signatureName) return NextResponse.json({ error: "Signature required" }, { status: 400 });
    if (!acceptanceText) return NextResponse.json({ error: "Missing acceptance text" }, { status: 400 });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const ua = req.headers.get("user-agent") ?? "";

    const out = await withSystem(async (tx) => {
      const [tk] = await tx.select().from(shareTokens).where(eq(shareTokens.id, tokenId));
      if (!tk) throw new Error("Invalid token");
      if (tk.revokedAt) throw new Error("This link was revoked");
      if (tk.usedAt) throw new Error("This link has already been used");
      if (new Date(tk.expiresAt as any) < new Date()) throw new Error("This link has expired");
      if (tk.kind !== "proposal_approval") throw new Error("Not a proposal-approval token");

      const [proposal] = await tx.select().from(proposals).where(eq(proposals.id, tk.subjectId));
      if (!proposal) throw new Error("Proposal not found");

      const approvalId = uuid();
      const now = new Date();

      await tx.insert(proposalApprovals).values({
        id: approvalId,
        tenantId: tk.tenantId,
        proposalId: tk.subjectId,
        acceptanceText,
        signatureName,
        channel: "portal" as any,
        ipAddress: ip,
        userAgent: ua,
        shareTokenId: tk.id,
        acceptedAt: now,
      } as any);

      await tx
        .update(proposals)
        .set({
          status: "accepted" as any,
          acceptedAt: now,
          updatedAt: now,
        } as any)
        .where(eq(proposals.id, tk.subjectId));

      // If the proposal was for a lead, advance that lead's stage too
      if ((proposal as any).leadId) {
        await tx
          .update(leads)
          .set({
            stage: "proposal_approved" as any,
            stageChangedAt: now,
            updatedAt: now,
          } as any)
          .where(eq(leads.id, (proposal as any).leadId));
        // Advance blueprint instance
        try {
          await transitionTo(tx, tk.tenantId!, (proposal as any).leadId, "proposal_approved", {
            systemBypass: true,
            remarks: `Client approved proposal ${(proposal as any).proposalNumber} via secure link.`,
          });
        } catch (e) {
          console.error("[proposals/accept] blueprint advance failed:", e);
        }
      }

      await tx.insert(eventsOutbox).values({
        tenantId: tk.tenantId,
        kind: "proposal.accepted",
        entityType: "proposal",
        entityId: tk.subjectId,
        after: { approvalId, signature: signatureName, leadId: (proposal as any).leadId ?? null },
        meta: { tokenId, ip, userAgent: ua } as any,
      } as any);

      await markShareTokenUsed({
        id: tokenId,
        result: { approvalId, signature: signatureName },
        ipAddress: ip,
        userAgent: ua,
      });

      return { approvalId };
    });

    return NextResponse.json(out, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: 400 });
  }
}
