import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/families/relationship-types  — the firm's relationship list.
 * POST /api/families/relationship-types  — add one (materialises the shipped
 *                                          defaults first, so the new entry
 *                                          joins a real list rather than
 *                                          replacing it).
 *
 * Reading is open to anyone who may see households — the member pickers need
 * it. Editing is master-data administration.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { familyRelationshipTypes } from "@/db/schema";
import { loadRelationshipTypes, materializeRelationshipDefaults } from "@/lib/families/master";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(
      session.roles,
      ["family.view", "investor.view.all", "investor.view.assigned"],
      session.permissions
    );
    const includeInactive = req.nextUrl.searchParams.get("all") === "1";
    const rows = await withTenant(
      session.tenantId,
      (tx) => loadRelationshipTypes(tx, session.tenantId, { includeInactive }),
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
    return NextResponse.json({ types: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

const CreateBody = z.object({
  label: z.string().trim().min(2).max(60).optional(),
  /** Copy the shipped defaults into real rows without adding anything, so the
   *  editor can then PATCH them. */
  materializeOnly: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.masters", session.permissions);
    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "A label of 2–60 characters is required", issues: parse.error.issues }, { status: 400 });
    }
    if (parse.data.materializeOnly) {
      await withTenant(
        session.tenantId,
        (tx) => materializeRelationshipDefaults(tx, session.tenantId),
        { userId: session.userId, branchId: session.branchId, roles: session.roles }
      );
      return NextResponse.json({ ok: true, materialized: true });
    }

    const label = parse.data.label;
    if (!label) return NextResponse.json({ error: "A label of 2–60 characters is required" }, { status: 400 });
    // The key is derived once and then frozen — investors.family_role stores it.
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
    if (!key) return NextResponse.json({ error: "That label has no letters or digits to build a key from" }, { status: 400 });

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        await materializeRelationshipDefaults(tx, session.tenantId);
        const clash = await tx
          .select({ id: familyRelationshipTypes.id })
          .from(familyRelationshipTypes)
          .where(eq(familyRelationshipTypes.key, key))
          .limit(1);
        if (clash.length) return "duplicate" as const;

        const [row] = await tx
          .insert(familyRelationshipTypes)
          .values({ tenantId: session.tenantId, key, label, sortOrder: 500, isActive: true, isSystem: false })
          .returning();
        return row;
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (result === "duplicate") {
      return NextResponse.json({ error: "A relationship with that name already exists" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, type: result });
  } catch (err: any) {
    return handleApiError(err);
  }
}
