/**
 * POST /api/workflows/[id]/publish
 *
 * Atomically:
 *   1. Marks the draft as published
 *   2. Archives the previously-published version
 *   3. Points workflows.current_version_id at the new published version
 *
 * In-flight workflow_runs continue on their original version (version_id
 * stamped on the run row).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { workflows, workflowVersions } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "workflow.publish");
    await assertActiveLicense(session.tenantId, session.roles);

    const clientMeta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      const draft = await tx
        .select()
        .from(workflowVersions)
        .where(and(eq(workflowVersions.workflowId, id), eq(workflowVersions.status, "draft")))
        .limit(1);

      if (!draft.length) {
        throw Object.assign(new Error("no draft to publish"), { status: 400 });
      }

      // Archive previously-published versions
      await tx
        .update(workflowVersions)
        .set({ status: "archived" } as any)
        .where(
          and(
            eq(workflowVersions.workflowId, id),
            eq(workflowVersions.status, "published")
          )
        );

      // Publish the draft
      await tx
        .update(workflowVersions)
        .set({
          status: "published",
          publishedAt: new Date(),
          publishedBy: session.userId,
        } as any)
        .where(eq(workflowVersions.id, draft[0].id));

      // Point the workflow at it
      await tx
        .update(workflows)
        .set({ currentVersionId: draft[0].id, enabled: true, pausedReason: null, pausedAt: null } as any)
        .where(eq(workflows.id, id));

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "workflow.publish",
        entityType: "workflow",
        entityId: id,
        after: { versionId: draft[0].id, versionNumber: draft[0].versionNumber },
        ...clientMeta,
      });

      return { publishedVersionId: draft[0].id, versionNumber: draft[0].versionNumber };
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
