/**
 * AINA edit page for one package.
 *
 * Loads the package server-side, hands the values to the client editor.
 * The editor handles the form (active toggle, prices, limits, module
 * checkbox grid) and posts a PATCH to `/api/super-admin/packages/[id]`.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { withPlatformAdmin } from "@/db/client";
import { packages } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { PackageEditor } from "@/components/super-admin/PackageEditor";

export const dynamic = "force-dynamic";

export default async function EditPackagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const pkg = await withPlatformAdmin(session.userId, async (tx) => {
    return (await tx.select().from(packages).where(eq(packages.id, id)).limit(1))[0] ?? null;
  });
  if (!pkg) notFound();

  return (
    <div className="space-y-4 max-w-3xl">
      <Link
        href="/super-admin/packages"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to packages
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="page-title">Edit package</h1>
          <p className="text-muted-foreground text-sm font-mono">{pkg.key}</p>
        </div>
        <span
          className={`text-xs px-2 py-1 rounded-full ${
            pkg.isActive ? "bg-emerald-50 text-emerald-700" : "bg-gray-50 text-gray-600"
          }`}
        >
          {pkg.isActive ? "active" : "disabled"}
        </span>
      </div>
      <PackageEditor pkg={JSON.parse(JSON.stringify(pkg))} />
    </div>
  );
}
