/**
 * Single service-request endpoints.
 *
 *   GET    /api/service-requests/[id]   — fetch one ticket
 *   PATCH  /api/service-requests/[id]   — update status / priority / assignee / resolution
 *   DELETE /api/service-requests/[id]   — close (status='closed')
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { serviceRequests } from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z.object({
  subject: z.string().min(2).max(300).optional(),
  description: z.string().optional(),
  status: z.enum(["open", "in_progress", "waiting_customer", "resolved", "closed", "escalated"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  assignedToUserId: z.string().uuid().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(serviceRequests).where(eq(serviceRequests.id, id)).limit(1))[0] ?? null
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
    requireCap(session.roles, "service_request.manage");
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const patch: any = { ...parse.data, updatedAt: new Date() };
    if (parse.data.status === "resolved") patch.resolvedAt = new Date();

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(serviceRequests).where(eq(serviceRequests.id, id)).limit(1))[0];
      if (!before) return null;
      const after = await tx.update(serviceRequests).set(patch).where(eq(serviceRequests.id, id)).returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "service_request.status_change",
        entityType: "service_request",
        entityId: id,
        before: { status: before.status } as any,
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
    requireCap(session.roles, "service_request.manage");
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      await tx
        .update(serviceRequests)
        .set({ status: "closed", updatedAt: new Date() } as any)
        .where(eq(serviceRequests.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "service_request.close",
        entityType: "service_request",
        entityId: id,
        ...clientMeta,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
