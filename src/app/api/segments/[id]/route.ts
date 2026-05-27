/**
 * Single segment endpoints.
 *
 *   GET    /api/segments/[id]   — fetch one segment
 *   PATCH  /api/segments/[id]   — update name/description/filter AST
 *   DELETE /api/segments/[id]   — hard delete (cascades memberships)
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { segments } from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().optional(),
  filterAst: z.any().optional(),
  kind: z.string().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(segments).where(eq(segments.id, id)).limit(1))[0] ?? null
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
    requireCap(session.roles, "segments.manage");
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.update(segments).set({ ...parse.data, updatedAt: new Date() } as any).where(eq(segments.id, id)).returning();
      if (!r[0]) return null;
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "segment.update",
        entityType: "segment",
        entityId: id,
        after: { name: r[0].name } as any,
        ...clientMeta,
      });
      return r[0];
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
    requireCap(session.roles, "segments.manage");
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(segments).where(eq(segments.id, id)).limit(1))[0];
      if (!before) return;
      await tx.delete(segments).where(eq(segments.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "segment.delete",
        entityType: "segment",
        entityId: id,
        before: { name: before.name } as any,
        ...clientMeta,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
