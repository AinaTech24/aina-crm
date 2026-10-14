/**
 * "Script for this stage" — the SOP(s) the firm linked to the lead's current
 * journey stage (sop_links, blueprint_stage "lead:<stageKey>"), on the lead
 * page. The starter manual ships one call script per main lead stage
 * (lib/practice/starter-manual.ts); a firm can link its own.
 *
 * Server component: one tenant transaction, renders nothing when the stage has
 * no SOP. The stage is the blueprint instance's current stage, else the lead's
 * own `stage` column (a lead whose journey has not started yet).
 */

import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { MessageSquareText } from "lucide-react";
import { withTenant } from "@/db/client";
import { leadBlueprintInstances } from "@/db/schema";
import { linkedSopsFor, blueprintStageKey } from "@/lib/practice/sop-links";
import { SopMarkdown } from "@/components/practice/HowWeDoThisMarkdown";
import { Card } from "@/components/ui/Card";

export async function StageScript({
  session,
  leadId,
  fallbackStage,
}: {
  session: { tenantId: string; userId: string; branchId?: string | null; roles: string[] };
  leadId: string;
  fallbackStage: string | null | undefined;
}) {
  const { stage, sops } = await withTenant(
    session.tenantId,
    async (tx) => {
      const [inst] = await tx
        .select({ key: leadBlueprintInstances.currentStageKey })
        .from(leadBlueprintInstances)
        .where(and(eq(leadBlueprintInstances.tenantId, session.tenantId), eq(leadBlueprintInstances.leadId, leadId)))
        .limit(1);
      const stage = inst?.key ?? fallbackStage ?? null;
      if (!stage) return { stage, sops: [] };
      const sops = await linkedSopsFor(tx, session.tenantId, [
        { kind: "blueprint_stage", key: blueprintStageKey("lead", stage) },
      ]);
      return { stage, sops };
    },
    { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles },
  );
  if (!stage || sops.length === 0) return null;
  // Call scripts first, then any other SOP linked to the stage.
  const ordered = [...sops].sort((a, b) => Number(b.category === "Scripts") - Number(a.category === "Scripts"));

  return (
    <Card className="my-4">
      <details className="group">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm">
          <MessageSquareText className="size-4 text-muted-foreground shrink-0" aria-hidden />
          <span className="font-semibold">Script for this stage</span>
          <span className="text-muted-foreground truncate">· {ordered.map((s) => s.title).join(" · ")}</span>
          <span className="ml-auto text-xs text-primary group-open:hidden">Show</span>
          <span className="ml-auto text-xs text-primary hidden group-open:inline">Hide</span>
        </summary>
        <div className="space-y-4 px-5 pb-5">
          {ordered.map((s) => (
            <section key={s.sopId} className="rounded-md bg-secondary/70 p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h4 className="text-sm font-semibold">{s.title}</h4>
                <Link href={`/dashboard/sops/${s.sopId}`} className="text-xs text-primary hover:underline shrink-0">
                  Full SOP · v{s.versionNumber}
                </Link>
              </div>
              {s.markdown.trim() ? (
                <SopMarkdown markdown={s.markdown} />
              ) : (
                <p className="text-sm text-muted-foreground">This SOP has no text yet.</p>
              )}
            </section>
          ))}
        </div>
      </details>
    </Card>
  );
}
