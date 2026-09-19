import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { Workflow } from "lucide-react";
import { withTenant } from "@/db/client";
import { blueprintDefinitions, blueprintStages, blueprintTransitions } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { BlueprintDesigner } from "@/components/blueprints/BlueprintDesignerLazy";

export const dynamic = "force-dynamic";

export default async function BlueprintEditPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const data = await withTenant(session.tenantId, async (tx) => {
    const [def] = await tx.select().from(blueprintDefinitions).where(eq(blueprintDefinitions.id, id));
    if (!def) return null;
    const stages = await tx
      .select()
      .from(blueprintStages)
      .where(eq(blueprintStages.blueprintId, id))
      .orderBy(asc(blueprintStages.stageOrder));
    const transitions = await tx
      .select()
      .from(blueprintTransitions)
      .where(eq(blueprintTransitions.blueprintId, id));
    return { def, stages, transitions };
  });
  if (!data) notFound();

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeaderCard title={<><Workflow className="size-6 text-muted-foreground" /> {data.def.blueprintName}</>} subtitle={<>Edit stages, SLA days, required fields, and on-enter automations.</>} />

      <BlueprintDesigner
        blueprintId={data.def.id}
        moduleName={data.def.moduleName}
        initial={{
          blueprintName: data.def.blueprintName,
          description: data.def.description ?? "",
          isActive: data.def.isActive,
          stages: data.stages.map((s) => ({
            id: s.id,
            stageKey: s.stageKey,
            stageName: s.stageName,
            description: s.description ?? "",
            stageOrder: s.stageOrder,
            ownerRole: s.ownerRole ?? "",
            slaDays: s.slaDays ?? null,
            requiredFields: (s.requiredFields as string[]) ?? [],
            allowedActions: (s.allowedActions as string[]) ?? [],
            automationsOnEnter: (s.automationsOnEnter as string[]) ?? [],
          })),
          transitions: data.transitions.map((t) => ({
            id: t.id,
            fromStageKey: t.fromStageKey,
            toStageKey: t.toStageKey,
            transitionName: t.transitionName,
            allowedRoles: (t.allowedRoles as string[]) ?? [],
          })),
        }}
      />
    </div>
  );
}
