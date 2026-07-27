import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { withPlatformAdmin } from "@/db/client";
import { landingPackages } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { LandingPackageForm } from "@/components/super-admin/LandingPackageForm";

export const dynamic = "force-dynamic";

export default async function EditLandingPackagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  requirePlatform(session.roles, "platform.package.manage");
  const row = await withPlatformAdmin(session.userId, async (tx) => {
    const [r] = await tx.select().from(landingPackages).where(eq(landingPackages.id, id)).limit(1);
    return r;
  });
  if (!row) notFound();

  return (
    <LandingPackageForm
      initial={{
        id: row.id,
        name: row.name,
        tagline: row.tagline,
        priceLabel: row.priceLabel,
        unitLabel: row.unitLabel,
        setupLabel: row.setupLabel,
        setupOriginalLabel: row.setupOriginalLabel,
        discountBadge: row.discountBadge,
        seatsLabel: row.seatsLabel,
        inheritsLabel: row.inheritsLabel,
        features: Array.isArray(row.features) ? (row.features as string[]) : [],
        featured: row.featured,
        badgeLabel: row.badgeLabel,
        isCustom: row.isCustom,
        ctaLabel: row.ctaLabel,
        ctaHref: row.ctaHref,
        sortOrder: row.sortOrder,
        published: row.published,
      }}
    />
  );
}
