import Link from "next/link";
import { notFound } from "next/navigation";
import { ALL_RECIPES } from "@/lib/recipes";
import { ChevronLeft } from "lucide-react";
import { WorkflowCanvas } from "@/components/workflow/WorkflowCanvas";

export default async function RecipeDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const recipe = ALL_RECIPES.find((r) => r.key === key);
  if (!recipe) notFound();

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/workflows"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to workflows
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{recipe.name}</h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-3xl">{recipe.description}</p>
          {recipe.tags && recipe.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {recipe.tags.map((t) => (
                <span key={t} className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">Customize</button>
          <button className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium">
            Install workflow
          </button>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden bg-card">
        <div className="border-b px-4 py-2.5 flex items-center justify-between bg-muted/30">
          <div className="text-sm font-medium">Workflow canvas</div>
          <div className="text-xs text-muted-foreground">
            {(recipe.graph as any).nodes.length} nodes · {(recipe.graph as any).edges.length} edges
          </div>
        </div>
        <div className="h-[560px]">
          <WorkflowCanvas graph={recipe.graph as any} />
        </div>
      </div>

      {recipe.defaultTemplates && recipe.defaultTemplates.length > 0 && (
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold">Default templates</h2>
          <p className="text-sm text-muted-foreground">
            These templates are seeded into your library on install. You can edit them after.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-3">
            {recipe.defaultTemplates.map((t) => (
              <div key={t.key} className="border rounded-md p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase font-medium px-1.5 py-0.5 rounded bg-muted">
                    {t.channel}
                  </span>
                  <span className="text-xs uppercase px-1.5 py-0.5 rounded bg-muted">{t.category}</span>
                </div>
                <div className="font-medium mt-1.5">{t.name}</div>
                <div className="text-xs text-muted-foreground mt-1 font-mono whitespace-pre-wrap line-clamp-4">
                  {JSON.stringify(t.body, null, 0).slice(0, 200)}…
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
