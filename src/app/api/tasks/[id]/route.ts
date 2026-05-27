/**
 * Single-task endpoints.
 *
 *   GET    /api/tasks/[id]   — fetch one task
 *   PATCH  /api/tasks/[id]   — update status, priority, due, assignee
 *   DELETE /api/tasks/[id]   — soft cancel (status='cancelled')
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { tasks } from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().optional(),
  status: z.enum(["open", "in_progress", "blocked", "completed", "cancelled"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  assigneeId: z.string().uuid().optional(),
  dueAt: z.string().optional(),
  // Module 18 — explicit related entity + department + remarks
  relatedInvestorId: z.string().uuid().optional(),
  relatedLeadId: z.string().uuid().optional(),
  relatedServiceRequestId: z.string().uuid().optional(),
  relatedMeetingId: z.string().uuid().optional(),
  department: z
    .enum([
      "sales",
      "operations",
      "back_office",
      "compliance",
      "marketing",
      "advisory",
      "support",
      "leadership",
      "other",
    ])
    .optional(),
  remarks: z.string().max(1000).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1))[0] ?? null
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

    const patch: any = { ...parse.data, updatedAt: new Date() };
    if (parse.data.status === "completed" && !patch.completedAt) patch.completedAt = new Date();

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1))[0];
      if (!before) return null;
      const after = await tx.update(tasks).set(patch).where(eq(tasks.id, id)).returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "task.update",
        entityType: "task",
        entityId: id,
        before: { status: before.status, assigneeId: before.assigneeId } as any,
        after: parse.data as any,
        ...clientMeta,
      });
      return after[0];
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
      await tx
        .update(tasks)
        .set({ status: "cancelled", updatedAt: new Date() } as any)
        .where(eq(tasks.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "task.cancel",
        entityType: "task",
        entityId: id,
        ...clientMeta,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
