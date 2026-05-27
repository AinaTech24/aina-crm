/**
 * Single-workflow endpoints.
 *
 *   GET    /api/workflows/[id]   — read workflow + current version graph
 *   PATCH  /api/workflows/[id]   — update name/desc/enabled/category
 *   DELETE /api/workflows/[id]   — soft-delete (set enabled=false; hard delete only on empty)
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { workflows, workflowVersions } from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(2000).optional(),
  enabled: z.boolean().optional(),
  category: z.string().optional(),
  recurrencePolicy: z.string().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const row = await withTenant(session.tenantId, async (tx) => {
      const wf = await tx.select().from(workflows).where(eq(workflows.id, id)).limit(1);
      if (!wf.length) return null;
      const ver = wf[0].currentVersionId
        ? await tx.select().from(workflowVersions).where(eq(workflowVersions.id, wf[0].currentVersionId!)).limit(1)
        : [];
      return { workflow: wf[0], version: ver[0] ?? null };
    });
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
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const result = await withTenant(session.tenantId, async (tx) => {
      const r = await tx
        .update(workflows)
        .set({ ...parse.data, updatedAt: new Date() } as any)
        .where(eq(workflows.id, id))
        .returning();
      return r[0] ?? null;
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
      await tx.update(workflows).set({ enabled: false, pausedReason: "deleted", pausedAt: new Date() } as any).where(eq(workflows.id, id));
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
