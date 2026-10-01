/**
 *   GET   /api/opportunities/[id]   one opportunity's view (stages, next step, gates)
 *   PATCH /api/opportunities/[id]   edit details while it is open:
 *         { expectedValue?, investmentMode?, notes?, ownerId?, coOwnerId?, needsAnalysis? }
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
import { listOpportunities, syncOpportunity } from "@/lib/opportunities/journey";

export const dynamic = "force-dynamic";

const uuid = z.string().uuid();
const money = z.coerce.number().nonnegative().max(1e12).nullish();

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
      for (const u of [b.ownerId, b.coOwnerId]) {
        if (!u) continue;
        const ok = (await tx.execute(sql`SELECT 1 FROM users WHERE id = ${u}::uuid AND tenant_id = ${session.tenantId}::uuid AND status = 'active'`)).rows.length;
        if (!ok) throw Object.assign(new Error("The chosen owner is not an active user in this firm."), { status: 400 });
      }
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (b.expectedValue !== undefined) set.expectedValue = b.expectedValue == null ? null : String(b.expectedValue);
      if (b.investmentMode !== undefined && opp.pipeline === "mf") set.investmentMode = b.investmentMode;
      if (b.notes !== undefined) set.notes = b.notes?.trim() || null;
      if (b.ownerId !== undefined && b.ownerId) set.ownerId = b.ownerId;
      if (b.coOwnerId !== undefined) set.coOwnerId = b.coOwnerId || null;
      if (b.needsAnalysis !== undefined) {
        set.needsAnalysis = b.needsAnalysis
          ? { ...b.needsAnalysis, recordedAt: new Date().toISOString(), recordedBy: session.userId }
          : null;
      }
      await tx.update(clientOpportunities).set(set as any).where(eq(clientOpportunities.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "opportunity.update",
        entityType: "opportunity", entityId: id, before: { ...opp } as any, after: b as any,
      } as any);
      await syncOpportunity(tx, { tenantId: session.tenantId, userId: session.userId }, id);
      return (await listOpportunities(tx, session.tenantId, { ids: [id] }))[0];
    }, ctx(session));
    return NextResponse.json({ opportunity: view });
  } catch (err) {
    return handleApiError(err);
  }
}
