import { handleApiError } from "@/lib/api/error-handler";
/**
 * AINA landing-page package CRUD (the public pricing cards).
 *   GET  — list all cards (any order).
 *   POST — create a card.
 * Gated by platform.package.manage.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { asc } from "drizzle-orm";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { landingPackages } from "@/db/schema";
import { LandingBody } from "@/lib/landing/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");
    const rows = await withPlatformAdmin(session.userId, async (tx) =>
      tx.select().from(landingPackages).orderBy(asc(landingPackages.sortOrder), asc(landingPackages.name))
    );
    return NextResponse.json({ packages: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");
    const parse = LandingBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const d = parse.data;
    const row = await withPlatformAdmin(session.userId, async (tx) => {
      const [r] = await tx
        .insert(landingPackages)
        .values({
          name: d.name,
          tagline: d.tagline ?? null,
          priceLabel: d.priceLabel ?? null,
          unitLabel: d.unitLabel ?? null,
          setupLabel: d.setupLabel ?? null,
          setupOriginalLabel: d.setupOriginalLabel ?? null,
          discountBadge: d.discountBadge ?? null,
          seatsLabel: d.seatsLabel ?? null,
          inheritsLabel: d.inheritsLabel ?? null,
          features: d.features ?? [],
          featured: !!d.featured,
          badgeLabel: d.badgeLabel ?? null,
          isCustom: !!d.isCustom,
          ctaLabel: d.ctaLabel ?? "Start Free Trial",
          ctaHref: d.ctaHref ?? "/signup",
          sortOrder: d.sortOrder ?? 0,
          published: d.published ?? true,
        } as any)
        .returning();
      return r;
    });
    revalidatePath("/");
    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
