import Link from "next/link";
import { asc } from "drizzle-orm";
import { Plus, LayoutTemplate, Star, Eye, EyeOff } from "lucide-react";
import { withPlatformAdmin } from "@/db/client";
import { landingPackages } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LandingPackagesPage() {
  const session = await requireSession();
  const rows = await withPlatformAdmin(session.userId, async (tx) =>
    tx.select().from(landingPackages).orderBy(asc(landingPackages.sortOrder), asc(landingPackages.name))
  );

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Landing packages</h1>
          <p className="text-muted-foreground text-sm">
            The pricing cards shown on the public landing page. Changes go live immediately.
          </p>
        </div>
        <Link
          href="/super-admin/landing-packages/new"
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
        >
          <Plus className="size-4" /> New card
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted-foreground border rounded-lg bg-card">
          <LayoutTemplate className="size-8 mx-auto text-muted-foreground/50" />
          <div className="mt-2">No landing cards yet — the public page is showing the built-in defaults.</div>
          <Link href="/super-admin/landing-packages/new" className="text-primary hover:underline mt-2 inline-block">
            Create the first card →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((p) => (
            <Link
              key={p.id}
              href={`/super-admin/landing-packages/${p.id}`}
              className={`flex items-center gap-4 border rounded-lg bg-card px-4 py-3 hover:border-primary/40 hover:shadow-sm transition ${
                !p.published ? "opacity-60" : ""
              }`}
            >
              <div className="w-8 text-center text-xs font-mono text-muted-foreground tabular-nums shrink-0">
                {p.sortOrder}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold truncate">{p.name}</span>
                  {p.featured && (
                    <span className="text-[10px] flex items-center gap-0.5 bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full">
                      <Star className="size-3" /> Featured
                    </span>
                  )}
                  {p.isCustom && (
                    <span className="text-[10px] bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded-full">Custom</span>
                  )}
                  {p.badgeLabel && (
                    <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{p.badgeLabel}</span>
                  )}
                </div>
                {p.tagline && <div className="text-xs text-muted-foreground truncate mt-0.5">{p.tagline}</div>}
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-medium">{p.priceLabel || "Custom"}</div>
                <div className="text-[11px] text-muted-foreground">{(p.features as any[])?.length ?? 0} features</div>
              </div>
              <div className="shrink-0 w-6 flex justify-center" title={p.published ? "Published" : "Hidden"}>
                {p.published ? (
                  <Eye className="size-4 text-emerald-600" />
                ) : (
                  <EyeOff className="size-4 text-muted-foreground" />
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
