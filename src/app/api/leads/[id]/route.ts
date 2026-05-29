import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single-lead endpoints.
 *
 *   GET    /api/leads/[id]   — fetch one lead
 *   PATCH  /api/leads/[id]   — partial update
 *   DELETE /api/leads/[id]   — soft delete (stage='lost', lostReason='deleted')
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { leads, eventsOutbox } from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().min(2).max(120).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  city: z.string().optional(),
  source: z.string().optional(),
  sourceCampaign: z.string().optional(),
  stage: z.string().optional(),
  ownerId: z.string().uuid().optional(),
  intendedAmount: z.string().optional(),
  followUpNotes: z.string().optional(),
  nextFollowUpAt: z.string().optional(),
  notes: z.string().optional(),
});

function canEdit(roles: string[]) {
  return roles.some((r) => ["owner", "marketing", "rm", "branch_head"].includes(r));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(leads).where(eq(leads.id, id)).limit(1))[0] ?? null
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
    requireCap(session.roles, "lead.edit.all");
    if (!canEdit(session.roles)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(leads).where(eq(leads.id, id)).limit(1))[0];
      if (!before) return null;
      const after = await tx
        .update(leads)
        .set({ ...parse.data, updatedAt: new Date() } as any)
        .where(eq(leads.id, id))
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "lead.update",
        entityType: "lead",
        entityId: id,
        before: { name: before.name, stage: before.stage } as any,
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
    requireCap(session.roles, "lead.edit.all");
    if (!canEdit(session.roles)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    await assertActiveLicense(session.tenantId, session.roles);

    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(leads).where(eq(leads.id, id)).limit(1))[0];
      if (!before) return;
      await tx
        .update(leads)
        .set({
          stage: "lost",
          lostReason: before.lostReason ?? "deleted",
          lostAt: new Date(),
          updatedAt: new Date(),
        } as any)
        .where(eq(leads.id, id));
      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "lead.deleted",
        entityType: "lead",
        entityId: id,
        meta: { userId: session.userId } as any,
      } as any);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "lead.delete",
        entityType: "lead",
        entityId: id,
        before: { name: before.name, stage: before.stage } as any,
        ...clientMeta,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
