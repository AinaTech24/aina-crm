/**
 * Single investor endpoints.
 *
 *   GET    /api/investors/[id]   — full investor + folios + sips + last comms
 *   PATCH  /api/investors/[id]   — partial update (catalog-writable fields only)
 *   DELETE /api/investors/[id]   — soft delete (status='exited' + DPDP purge per request)
 */

import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import {
  investors,
  folios,
  sips,
  goals,
  communications,
  serviceRequests,
  tasks,
  eventsOutbox,
  auditLog,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  whatsappPhone: z.string().optional(),
  segmentTag: z.enum(["HNI", "Affluent", "Retail", "NRI", "Corporate"]).optional(),
  investorCategory: z.enum(["individual", "huf", "corporate", "trust", "nri", "minor", "other"]).optional(),
  rmId: z.string().uuid().optional(),
  riskProfile: z.enum(["conservative", "moderate", "aggressive", "very_aggressive"]).optional(),
  nomineeName: z.string().optional(),
  nomineeRelation: z.string().optional(),
  bankName: z.string().optional(),
  bankAccountNumberMasked: z.string().optional(),
  bankIfsc: z.string().optional(),
  notes: z.string().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const result = await withTenant(session.tenantId, async (tx) => {
      const inv = (await tx.select().from(investors).where(eq(investors.id, id)).limit(1))[0];
      if (!inv) return null;

      const [foliosRows, sipsRows, goalsRows, commsRows, tasksRows, srRows] = await Promise.all([
        tx.select().from(folios).where(eq(folios.investorId, id)),
        tx.select().from(sips).where(eq(sips.investorId, id)),
        tx.select().from(goals).where(eq(goals.investorId, id)),
        tx
          .select()
          .from(communications)
          .where(eq(communications.investorId, id))
          .orderBy(desc(communications.createdAt))
          .limit(10),
        tx.select().from(tasks).where(eq(tasks.subjectId, id)).limit(20),
        tx.select().from(serviceRequests).where(eq(serviceRequests.investorId, id)).limit(20),
      ]);

      // Log PII access (DPDP requirement)
      await tx.insert(auditLog).values({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorType: "user",
        action: "investor.view",
        entityType: "investor",
        entityId: id,
        piiAccessed: { pan: !!inv.pan, dob: !!inv.dob, address: !!inv.address } as any,
        reason: "investor 360 page",
      } as any);

      return {
        investor: inv,
        folios: foliosRows,
        sips: sipsRows,
        goals: goalsRows,
        communications: commsRows,
        tasks: tasksRows,
        serviceRequests: srRows,
      };
    });

    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(investors).where(eq(investors.id, id)).limit(1))[0];
      if (!before) return null;

      const after = await tx
        .update(investors)
        .set({ ...parse.data, updatedAt: new Date() } as any)
        .where(eq(investors.id, id))
        .returning();

      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "investor.updated",
        entityType: "investor",
        entityId: id,
        before: before as any,
        after: after[0] as any,
        meta: { userId: session.userId } as any,
      } as any);

      return after[0];
    });

    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    await withTenant(session.tenantId, async (tx) => {
      await tx
        .update(investors)
        .set({ status: "exited", exitedAt: new Date(), updatedAt: new Date() } as any)
        .where(eq(investors.id, id));

      await tx.insert(auditLog).values({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.exit",
        entityType: "investor",
        entityId: id,
      } as any);
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
