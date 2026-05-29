import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single-family endpoints.
 *
 *   GET    /api/families/[id]   — fetch one family + member count
 *   PATCH  /api/families/[id]   — partial update
 *   DELETE /api/families/[id]   — hard delete only if no members linked, otherwise 409
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { families, investors } from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z.object({
  headName: z.string().min(2).max(120).optional(),
  familyName: z.string().min(2).max(120).optional(),
  primaryInvestorId: z.string().uuid().nullable().optional(),
  rmId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).optional(),
  lastReviewAt: z.string().optional(),
  nextReviewAt: z.string().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(families).where(eq(families.id, id)).limit(1))[0] ?? null
    );
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "investor.edit.all");
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(families).where(eq(families.id, id)).limit(1))[0];
      if (!before) return null;
      const after = await tx
        .update(families)
        .set({ ...parse.data, updatedAt: new Date() } as any)
        .where(eq(families.id, id))
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "family.update",
        entityType: "family",
        entityId: id,
        after: parse.data as any,
        ...clientMeta,
      });
      return after[0];
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "investor.edit.all");
    await assertActiveLicense(session.tenantId, session.roles);

    const clientMeta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      // Refuse delete if any members are still linked
      const count = await tx.execute(sql`SELECT COUNT(*)::int AS c FROM investors WHERE family_id = ${id}`);
      const c = Number((count.rows[0] as any)?.c ?? 0);
      if (c > 0) {
        throw Object.assign(new Error(`cannot delete: ${c} member(s) still linked`), { status: 409 });
      }
      const before = (await tx.select().from(families).where(eq(families.id, id)).limit(1))[0];
      if (!before) return null;

      await tx.delete(families).where(eq(families.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "family.delete",
        entityType: "family",
        entityId: id,
        before: { headName: before.headName, familyName: before.familyName } as any,
        ...clientMeta,
      });
      return { ok: true };
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
