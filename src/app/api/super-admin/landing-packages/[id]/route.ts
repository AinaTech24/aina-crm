import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH  /api/super-admin/landing-packages/[id]  — edit a landing card.
 * DELETE /api/super-admin/landing-packages/[id]  — remove it.
 * Gated by platform.package.manage.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { landingPackages } from "@/db/schema";
import { LandingPatchBody } from "@/lib/landing/schema";

export const dynamic = "force-dynamic";

const PatchBody = LandingPatchBody;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");
    const parse = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const patch: any = { updatedAt: new Date() };
    for (const k of ["name", "tagline", "priceLabel", "unitLabel", "setupLabel", "setupOriginalLabel", "discountBadge", "seatsLabel", "inheritsLabel", "features", "featured", "badgeLabel", "isCustom", "ctaLabel", "ctaHref", "sortOrder", "published"] as const) {
      if (parse.data[k] !== undefined) patch[k] = parse.data[k];
    }
    await withPlatformAdmin(session.userId, async (tx) => {
      await tx.update(landingPackages).set(patch).where(eq(landingPackages.id, id));
    });
    revalidatePath("/");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");
    await withPlatformAdmin(session.userId, async (tx) => {
      await tx.delete(landingPackages).where(eq(landingPackages.id, id));
    });
    revalidatePath("/");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
