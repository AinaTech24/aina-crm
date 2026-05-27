/**
 * Single goal endpoints.
 *
 *   GET    /api/goals/[id]   — fetch one goal
 *   PATCH  /api/goals/[id]   — partial update; recompute SIP fields if relevant inputs change
 *   DELETE /api/goals/[id]   — soft archive (status='abandoned')
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { goals } from "@/db/schema";
import { computeGoal, monthsBetween } from "@/lib/goal-planning/calc";

export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().min(2).max(120).optional(),
  category: z.string().optional(),
  targetAmount: z.number().positive().optional(),
  targetDate: z.string().optional(),
  currentValue: z.number().nonnegative().optional(),
  existingMonthlySip: z.number().nonnegative().optional(),
  expectedReturnPct: z.number().min(1).max(30).optional(),
  status: z.enum([
    "not_started", "on_track", "behind_track", "achieved",
    "active", "on_hold", "abandoned",
  ]).optional(),
  remarks: z.string().optional(),
  /** Linker — investor folio + SIP ids */
  linkedFolios: z.array(z.string().uuid()).optional(),
  linkedSips: z.array(z.string().uuid()).optional(),
  /** Per-folio allocation (0..100). Folios in linkedFolios without an
   *  entry here are treated as 100%. */
  folioAllocations: z
    .array(
      z.object({
        folioId: z.string().uuid(),
        allocationPct: z.number().min(0).max(100),
      })
    )
    .optional(),
  sipAllocations: z
    .array(
      z.object({
        sipId: z.string().uuid(),
        allocationPct: z.number().min(0).max(100),
      })
    )
    .optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(goals).where(eq(goals.id, id)).limit(1))[0] ?? null
    );
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(goals).where(eq(goals.id, id)).limit(1))[0];
      if (!before) return null;

      const patch: any = { ...parse.data, updatedAt: new Date() };

      // Recompute derived fields if any calc input changed
      const inputsChanged =
        parse.data.targetAmount !== undefined ||
        parse.data.targetDate !== undefined ||
        parse.data.currentValue !== undefined ||
        parse.data.existingMonthlySip !== undefined ||
        parse.data.expectedReturnPct !== undefined;
      if (inputsChanged) {
        const targetAmount = parse.data.targetAmount ?? Number(before.targetAmount);
        const targetDate = new Date(parse.data.targetDate ?? before.targetDate);
        const currentValue = parse.data.currentValue ?? Number(before.currentValue ?? 0);
        const existingSip = parse.data.existingMonthlySip ?? Number(before.existingMonthlySip ?? 0);
        const ret = parse.data.expectedReturnPct ?? Number(before.expectedReturn ?? 12);
        const calc = computeGoal({
          targetAmount,
          currentValue,
          existingMonthlySip: existingSip,
          monthsLeft: monthsBetween(new Date(), targetDate),
          expectedReturnPct: ret,
        });
        patch.requiredMonthlySip = calc.requiredMonthlySipTotal.toFixed(2);
        patch.existingMonthlySip = existingSip.toString();
        patch.gapAmount = calc.gapAmount.toFixed(2);
        // Don't override explicit status from the body
        if (!parse.data.status) patch.status = calc.status;
      }

      await tx.update(goals).set(patch).where(eq(goals.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "goal.update",
        entityType: "goal",
        entityId: id,
        after: parse.data as any,
        ...clientMeta,
      });
      return { ok: true };
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      await tx.update(goals).set({ status: "abandoned", updatedAt: new Date() } as any).where(eq(goals.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "goal.archive",
        entityType: "goal",
        entityId: id,
        ...clientMeta,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
