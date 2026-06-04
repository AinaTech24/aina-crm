import { handleApiError } from "@/lib/api/error-handler";
/** PATCH /api/leads/[id]/pipeline — move a lead's pipeline / pipeline stage. */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { loadEditableLead } from "@/lib/leads/access";
import { leads } from "@/db/schema";
import { PIPELINE_KEYS, PIPELINES } from "@/lib/pipelines/config";

export const dynamic = "force-dynamic";

const Body = z.object({
  pipeline: z.enum(PIPELINE_KEYS).optional(),
  pipelineStage: z.string().max(40).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { pipeline, pipelineStage } = parse.data;
    // Validate the stage belongs to the (new or existing) pipeline.
    if (pipelineStage && pipeline && !PIPELINES[pipeline].stages.some((s) => s.key === pipelineStage)) {
      return NextResponse.json({ error: "stage not in pipeline" }, { status: 400 });
    }
    const patch: any = { updatedAt: new Date() };
    if (pipeline !== undefined) patch.pipeline = pipeline;
    if (pipelineStage !== undefined) patch.pipelineStage = pipelineStage;

    const row = await withTenant(session.tenantId, async (tx) => {
      // Capability + ownership + tenant gate (throws 403/404), matching the
      // other /leads/[id]/* mutations (audit: this route was RBAC-ungated).
      await loadEditableLead(tx, session, id);
      return (await tx.update(leads).set(patch).where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId))).returning())[0];
    }, { userId: session.userId, branchId: session.branchId, roles: session.roles });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ lead: { id: row.id, pipeline: row.pipeline, pipelineStage: row.pipelineStage } });
  } catch (err: any) { return handleApiError(err); }
}
