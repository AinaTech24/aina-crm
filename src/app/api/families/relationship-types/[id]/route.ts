import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH  /api/families/relationship-types/[id]  — rename / reorder / re-enable.
 * DELETE /api/families/relationship-types/[id]  — retire (never hard-delete).
 *
 * The key is immutable and deletes are soft, because investors.family_role
 * stores the key: removing the row would leave existing members pointing at a
 * relationship nobody can name any more. Retiring hides it from the pickers
 * while the members who already have it keep reading correctly.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { familyRelationshipTypes } from "@/db/schema";
import { materializeRelationshipDefaults } from "@/lib/families/master";

export const dynamic = "force-dynamic";

const Patch = z.object({
  label: z.string().trim().min(2).max(60).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.masters", session.permissions);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }

    const out = await withTenant(
      session.tenantId,
      async (tx) => {
        await materializeRelationshipDefaults(tx, session.tenantId);
        const patch: Partial<typeof familyRelationshipTypes.$inferInsert> = { updatedAt: new Date() };
        if (parse.data.label !== undefined) patch.label = parse.data.label;
        if (parse.data.sortOrder !== undefined) patch.sortOrder = parse.data.sortOrder;
        if (parse.data.isActive !== undefined) patch.isActive = parse.data.isActive;

        const [row] = await tx
          .update(familyRelationshipTypes)
          .set(patch)
          .where(and(eq(familyRelationshipTypes.id, id), eq(familyRelationshipTypes.tenantId, session.tenantId)))
          .returning();
        return row ?? null;
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (!out) return NextResponse.json({ error: "relationship not found" }, { status: 404 });
    return NextResponse.json({ ok: true, type: out });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.masters", session.permissions);

    const out = await withTenant(
      session.tenantId,
      async (tx) => {
        await materializeRelationshipDefaults(tx, session.tenantId);
        const [row] = await tx
          .update(familyRelationshipTypes)
          .set({ isActive: false, updatedAt: new Date() })
          .where(and(eq(familyRelationshipTypes.id, id), eq(familyRelationshipTypes.tenantId, session.tenantId)))
          .returning();
        return row ?? null;
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (!out) return NextResponse.json({ error: "relationship not found" }, { status: 404 });
    return NextResponse.json({ ok: true, retired: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
