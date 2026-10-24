/**
 *   GET   /api/opportunities/[id]   one opportunity's view (stages, next step, gates)
 *   PATCH /api/opportunities/[id]   edit details while it is open:
 *         { expectedValue?, investmentMode?, notes?, ownerId?, coOwnerId?, needsAnalysis?, followUpOn? }
 * A new ownerId must be someone the editor may assign this client to
 * (lib/opportunities/assignees.ts); the open tasks the old owner had on it
 * move to them with it, and they are notified.
 * followUpOn (YYYY-MM-DD) moves the next follow-up — the opportunity's open
 * follow-up task, or a new one when none is open.
 * Saving a needs analysis can clear the insurance suitability gate, so a PATCH
 * re-checks the journey and moves it on if it can.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { clientOpportunities } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { loadViewableOpportunity, requireWorkOpportunities } from "@/lib/opportunities/access";
import { listOpportunities, setFollowUp, syncOpportunity } from "@/lib/opportunities/journey";
import { assertAssignable, notifyOpportunityOwner } from "@/lib/opportunities/assignees";

export const dynamic = "force-dynamic";

const uuid = z.string().uuid();
const money = z.coerce.number().nonnegative().max(1e12).nullish();

/** A follow-up date: YYYY-MM-DD, today (India) or later. */
const followUpDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a follow-up date")
  .refine((d) => d >= new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10), "The follow-up date can't be in the past");

const Body = z.object({
  expectedValue: money,
  investmentMode: z.enum(["sip", "lumpsum"]).nullish(),
  notes: z.string().max(2000).nullish(),
  ownerId: uuid.nullish(),
  coOwnerId: uuid.nullish(),
  needsAnalysis: z.object({
    annualIncome: money,
    dependants: z.coerce.number().int().min(0).max(50).nullish(),
    existingCover: money,
    coverNeeded: money,
    liabilities: money,
    notes: z.string().max(2000).nullish(),
  }).nullish(),
  followUpOn: followUpDay.optional(),
});

const ctx = (session: Awaited<ReturnType<typeof requireSession>>) => ({
  userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles,
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const view = await withTenant(session.tenantId, async (tx) => {
      await loadViewableOpportunity(tx, session, id);
      return (await listOpportunities(tx, session.tenantId, { ids: [id] }))[0];
    }, ctx(session));
    return NextResponse.json({ opportunity: view });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireWorkOpportunities(session);
    const { id } = await params;
    if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    }
    const b = parsed.data;
    const view = await withTenant(session.tenantId, async (tx) => {
      const opp = await loadViewableOpportunity(tx, session, id);
      if (opp.status !== "open") throw Object.assign(new Error(`This opportunity is already ${opp.status}.`), { status: 409 });
      const newOwner = b.ownerId && b.ownerId !== opp.ownerId ? b.ownerId : null;
      if (newOwner) await assertAssignable(tx, session, opp.investorId, newOwner);
      if (b.coOwnerId) {
        const ok = (await tx.execute(sql`SELECT 1 FROM users WHERE id = ${b.coOwnerId}::uuid AND tenant_id = ${session.tenantId}::uuid AND status = 'active'`)).rows.length;
        if (!ok) throw Object.assign(new Error("The chosen co-owner is not an active user in this firm."), { status: 400 });
      }
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (b.expectedValue !== undefined) set.expectedValue = b.expectedValue == null ? null : String(b.expectedValue);
      if (b.investmentMode !== undefined && opp.pipeline === "mf") set.investmentMode = b.investmentMode;
      if (b.notes !== undefined) set.notes = b.notes?.trim() || null;
      if (newOwner) set.ownerId = newOwner;
      if (b.coOwnerId !== undefined) set.coOwnerId = b.coOwnerId || null;
      if (b.needsAnalysis !== undefined) {
        set.needsAnalysis = b.needsAnalysis
          ? { ...b.needsAnalysis, recordedAt: new Date().toISOString(), recordedBy: session.userId }
          : null;
      }
      await tx.update(clientOpportunities).set(set as any).where(eq(clientOpportunities.id, id));
      if (newOwner) {
        // The follow-up goes with the opportunity: what the old owner had open on
        // it (follow-up, revisit reminder) is now the new owner's. Tasks it put on
        // someone else's list (operations, a co-owner) stay where they are.
        await tx.execute(sql`
          UPDATE tasks SET assignee_id = ${newOwner}::uuid, updated_at = now()
           WHERE tenant_id = ${session.tenantId}::uuid AND meta ->> 'opportunityId' = ${id}
             AND status IN ('open', 'in_progress', 'blocked')
             AND ${opp.ownerId ? sql`assignee_id = ${opp.ownerId}::uuid` : sql`assignee_id IS NULL`}
        `);
        // Parked until money comes in: the expected inflow and its reminder move too.
        if (opp.expectedInflowId) {
          await tx.execute(sql`
            UPDATE expected_inflows SET owner_id = ${newOwner}::uuid, updated_at = now()
             WHERE id = ${opp.expectedInflowId}::uuid AND tenant_id = ${session.tenantId}::uuid
               AND ${opp.ownerId ? sql`owner_id = ${opp.ownerId}::uuid` : sql`owner_id IS NULL`}
          `);
        }
      }
      if (b.followUpOn) {
        await setFollowUp(tx, { tenantId: session.tenantId, userId: session.userId }, { ...opp, ownerId: (set.ownerId as string) ?? opp.ownerId }, b.followUpOn);
      }
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "opportunity.update",
        entityType: "opportunity", entityId: id, before: { ...opp } as any, after: b as any,
      } as any);
      await syncOpportunity(tx, { tenantId: session.tenantId, userId: session.userId }, id);
      if (newOwner) await notifyOpportunityOwner(tx, session, id, newOwner);
      return (await listOpportunities(tx, session.tenantId, { ids: [id] }))[0];
    }, ctx(session));
    return NextResponse.json({ opportunity: view });
  } catch (err) {
    return handleApiError(err);
  }
}
