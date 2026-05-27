import Link from "next/link";
import { desc } from "drizzle-orm";
import { Plus, GitBranch } from "lucide-react";
import { withTenant } from "@/db/client";
import { workflows } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { ALL_RECIPES } from "@/lib/recipes";
import { formatRelative } from "@/lib/utils";

const categoryColors: Record<string, string> = {
  operations: "bg-blue-50 text-blue-700",
  compliance: "bg-purple-50 text-purple-700",
  retention: "bg-emerald-50 text-emerald-700",
  marketing: "bg-pink-50 text-pink-700",
  service: "bg-amber-50 text-amber-700",
  internal: "bg-slate-50 text-slate-700",
  onboarding: "bg-teal-50 text-teal-700",
  custom: "bg-gray-50 text-gray-700",
};

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  const session = await requireSession();
  const installed = await withTenant(session.tenantId, async (tx) => {
    return tx.select().from(workflows).orderBy(desc(workflows.updatedAt));
  });

  const installedKeys = new Set(installed.map((w) => w.recipeKey).filter(Boolean));
  const uninstalledRecipes = ALL_RECIPES.filter((r) => !installedKeys.has(r.key));

  return (
    <div className="space-y-8 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Workflows</h1>
          <p className="text-muted-foreground text-sm">
            Trigger → Filter → Branch → Action. The nervous system of your firm.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard/workflows/new"
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
          >
            <Plus className="size-4" /> Build from scratch
          </Link>
        </div>
      </div>

      {/* Installed workflows */}
      {installed.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-lg">Your workflows</h2>
            <span className="text-xs text-muted-foreground">{installed.length} installed</span>
          </div>
          <div className="border rounded-lg bg-card divide-y">
            {installed.map((w) => (
              <div key={w.id} className="flex items-center justify-between p-4 hover:bg-accent/40">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/dashboard/workflows/${w.id}`}
                      className="font-medium hover:underline"
                    >
                      {w.name}
                    </Link>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${categoryColors[w.category] ?? categoryColors.custom}`}>
                      {w.category}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        w.enabled ? "bg-emerald-50 text-emerald-700" : "bg-gray-50 text-gray-600"
                      }`}
                    >
                      {w.enabled ? "active" : "draft / paused"}
                    </span>
                    {w.pausedReason && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                        {w.pausedReason}
                      </span>
                    )}
                  </div>
                  {w.description && (
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-1">{w.description}</div>
                  )}
                  <div className="text-xs text-muted-foreground mt-1">
                    Updated {formatRelative(w.updatedAt)}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/dashboard/workflows/${w.id}`}
                    className="text-xs rounded-md border px-2.5 py-1 hover:bg-accent"
                  >
                    Open
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recipe library */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <GitBranch className="size-4" /> Recipe library
          </h2>
          <span className="text-xs text-muted-foreground">{uninstalledRecipes.length} available</span>
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          Pre-built MFD automations — SIP rejections, mandate expiry, redemption retention, NISM alerts, market
          volatility broadcasts, lead nurture, and more. One click to install.
        </p>

        <div className="grid grid-cols-2 gap-4">
          {uninstalledRecipes.map((r) => (
            <Link
              key={r.key}
              href={`/dashboard/workflows/recipes/${r.key}`}
              className="border rounded-lg p-4 hover:bg-accent/40 transition-colors block"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{r.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${categoryColors[r.category] ?? categoryColors.custom}`}>
                      {r.category}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed line-clamp-2">
                    {r.description}
                  </p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t flex items-center gap-3 text-xs text-muted-foreground">
                <span>{(r.graph as any).nodes.length} nodes</span>
                <span>·</span>
                <span>{(r.graph as any).edges.length} edges</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
