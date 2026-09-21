/**
 * "Proposal shared" follow-up task.
 *
 * Spec §13: when a proposal's status becomes Shared, raise a task for the
 * person who prepared it so a sent proposal is never simply forgotten. A
 * proposal that goes out and is never chased is the single most common way an
 * MFD loses business that was already won.
 *
 * Two code paths set `sent` — the manual status PATCH and the send route that
 * actually emails it — so this lives in one place and both call it.
 */

import { and, eq, sql } from "drizzle-orm";
import { tasks } from "@/db/schema";

type Tx = Parameters<Parameters<typeof import("@/db/client").withTenant>[1]>[0];

/** Marks the task this module owns, so we can find it again and not duplicate. */
export const PROPOSAL_SHARED_TASK_TYPE = "proposal_shared";

export async function createProposalSharedTask(
  tx: Tx,
  input: {
    tenantId: string;
    proposalId: string;
    proposalNumber?: string | null;
    investorId?: string | null;
    leadId?: string | null;
    /** Who prepared the proposal — spec: assigned TO and BY the proposal owner. */
    preparedByUserId?: string | null;
    /** Falls back to the actor when the proposal carries no preparer. */
    actorUserId?: string | null;
    /** Proposal creation date — quoted in the task so the age is obvious. */
    proposalCreatedAt?: Date | string | null;
  }
): Promise<{ created: boolean }> {
  const owner = input.preparedByUserId ?? input.actorUserId ?? null;

  // Idempotent by construction. The PATCH guards on `sentAt` being unset, but a
  // proposal can legitimately be re-sent (resend, corrected copy), and a second
  // identical task would just be noise in someone's list.
  const existing = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.tenantId, input.tenantId),
        eq(tasks.subjectType, "investor"),
        eq(tasks.subjectId, input.proposalId),
        eq(tasks.type, PROPOSAL_SHARED_TASK_TYPE),
        sql`${tasks.deletedAt} IS NULL`
      )
    )
    .limit(1);
  if (existing.length) return { created: false };

  const ref = input.proposalNumber ? `Proposal ${input.proposalNumber}` : "Proposal";
  const madeOn = input.proposalCreatedAt ? new Date(input.proposalCreatedAt) : null;
  const madeOnText =
    madeOn && !isNaN(madeOn.getTime())
      ? ` Created ${madeOn.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}.`
      : "";

  await tx.insert(tasks).values({
    tenantId: input.tenantId,
    // subjectId carries the PROPOSAL id; subjectType has no 'proposal' member
    // and widening that enum would touch every consumer of the column, so the
    // authoritative link is `type` + the related* columns below.
    subjectType: "investor",
    subjectId: input.proposalId,
    relatedInvestorId: input.investorId ?? null,
    relatedLeadId: input.leadId ?? null,
    department: "advisory",
    type: PROPOSAL_SHARED_TASK_TYPE,
    title: "Proposal shared",
    description: `${ref} was shared with the client — follow up for a decision.${madeOnText}`,
    priority: "normal",
    status: "open", // spec's "Not Started"
    assigneeId: owner,
    createdById: owner,
  } as any);

  return { created: true };
}
