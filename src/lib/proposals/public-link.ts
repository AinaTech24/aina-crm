/**
 * The client's side of a proposal: /p/<token> and the /api/public/proposals/*
 * routes behind it.
 *
 * Every one of those routes starts the same way — resolve a proposal-approval
 * token across tenants (there is no session), refuse anything revoked, expired
 * or of the wrong kind, and load the proposal and its firm. That lives here so
 * the four routes cannot disagree about what a valid link is.
 */

import { eq } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { leads, investors, proposals, shareTokens, tenants } from "@/db/schema";
import type { Proposal } from "@/db/schema/proposals";

export { PROPOSAL_ACCEPTANCE_TEXT } from "./acceptance";

/** Statuses in which the client can still answer the proposal. */
export const OPEN_FOR_CLIENT = ["sent", "viewed"] as const;

const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

export type ProposalLink = {
  token: typeof shareTokens.$inferSelect;
  proposal: Proposal;
  tenant: typeof tenants.$inferSelect | null;
};

/**
 * Resolve a proposal-approval link.
 *
 * `allowUsed` — viewing and downloading keep working after the client has
 * answered (they come back for their copy); answering does not.
 */
export async function loadProposalLink(tokenId: string, opts: { allowUsed: boolean }): Promise<ProposalLink> {
  if (!tokenId) throw fail("missing token", 400);
  return withSystem(async (tx) => {
    const [t] = await tx.select().from(shareTokens).where(eq(shareTokens.id, tokenId)).limit(1);
    if (!t || t.kind !== "proposal_approval") throw fail("This link is not valid.", 404);
    if (t.revokedAt) throw fail("This link was withdrawn — your relationship manager has sent an updated proposal.", 410);
    if (new Date(t.expiresAt as any) < new Date()) throw fail("This link has expired.", 410);
    if (!opts.allowUsed && t.usedAt) throw fail("You have already responded to this proposal.", 409);

    const [proposal] = await tx.select().from(proposals).where(eq(proposals.id, t.subjectId!)).limit(1);
    if (!proposal) throw fail("Proposal not found.", 404);
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, t.tenantId!)).limit(1);
    return { token: t, proposal: proposal as Proposal, tenant: tenant ?? null };
  });
}

/**
 * Refuse an answer the proposal can no longer take, with a reason the client
 * can act on. A superseded version points at the newer one by implication —
 * the RM has sent it.
 */
export function assertOpenForClient(p: Proposal): void {
  if (p.status === "superseded") {
    throw fail("This proposal has been replaced by an updated version. Please use the latest link from your relationship manager.", 410);
  }
  if (p.validUntil && new Date(p.validUntil as any) < new Date()) {
    throw fail("This proposal's validity has passed. Please ask your relationship manager for an updated one.", 410);
  }
  if (!(OPEN_FOR_CLIENT as readonly string[]).includes(p.status)) {
    throw fail("This proposal is no longer open for a response.", 409);
  }
}

/**
 * Who hears about the client's response: the person who prepared the
 * proposal, else the client's or lead's owner. Null when nobody is on record.
 */
export async function proposalOwnerId(tx: any, p: Proposal): Promise<string | null> {
  if (p.preparedByUserId) return p.preparedByUserId;
  if (p.leadId) {
    const [l] = await tx.select({ owner: leads.ownerId }).from(leads).where(eq(leads.id, p.leadId)).limit(1);
    if (l?.owner) return l.owner;
  }
  if (p.investorId) {
    const [i] = await tx.select({ rm: investors.rmId }).from(investors).where(eq(investors.id, p.investorId)).limit(1);
    if (i?.rm) return i.rm;
  }
  return null;
}

/** Where the RM should land to act on this proposal. */
export function proposalHref(p: Pick<Proposal, "id">): string {
  return `/dashboard/proposals/${p.id}`;
}
