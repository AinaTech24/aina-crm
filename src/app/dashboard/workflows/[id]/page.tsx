import { notFound } from "next/navigation";
import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db/client";
import { workflows, workflowVersions, workflowRuns } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { WorkflowEditor } from "@/components/workflow/WorkflowEditorLazy";

export const dynamic = "force-dynamic";

export default async function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  const data = await withTenant(session.tenantId, async (tx) => {
    const wf = (await tx.select().from(workflows).where(eq(workflows.id, id)).limit(1))[0];
    if (!wf) return null;
    const versions = await tx
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.workflowId, id))
      .orderBy(desc(workflowVersions.versionNumber));
    const draft = versions.find((v) => v.status === "draft");
    const published = versions.find((v) => v.status === "published");
    const recentRuns = await tx
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, id))
      .orderBy(desc(workflowRuns.createdAt))
      .limit(10);
    return { workflow: wf, versions, draft, published, recentRuns };
  });

  if (!data) notFound();

  // Editor edits the draft (or, if none, clones the published version into a new draft on save).
  const initialGraph = (data.draft ?? data.published)?.graph ?? {
    nodes: [{ id: "trigger", type: "trigger", config: { kind: "manual" } }],
    edges: [],
    startNodeId: "trigger",
  };

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/workflows"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to workflows
      </Link>

      <WorkflowEditor
        workflowId={data.workflow.id}
        workflow={JSON.parse(JSON.stringify(data.workflow))}
        initialGraph={initialGraph as any}
        versions={JSON.parse(JSON.stringify(data.versions))}
        recentRuns={JSON.parse(JSON.stringify(data.recentRuns))}
      />
    </div>
  );
}
