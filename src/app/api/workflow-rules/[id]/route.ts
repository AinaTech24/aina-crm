import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { workflowRules } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { WorkflowRuleSchema } from "@/lib/workflow-rules/types";
import { unsupportedRuleFeature, isDuplicateNameError } from "@/lib/workflow-rules/guard";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const row = await withTenant(session.tenantId, async (tx) => {
    const [r] = await tx.select().from(workflowRules).where(and(eq(workflowRules.id, id), eq(workflowRules.tenantId, session.tenantId)));
    return r;
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ rule: row });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  requireCap(session.roles, "workflow.edit");
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Allow partial updates — use WorkflowRuleSchema.partial()
  const parsed = WorkflowRuleSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const updates = parsed.data;

  // Gate unsupported triggers/actions when those fields are being changed.
  if (updates.triggerType !== undefined || updates.instantActions !== undefined || updates.scheduledActions !== undefined) {
    const unsupported = unsupportedRuleFeature({
      triggerType: updates.triggerType ?? "record_action",
      instantActions: updates.instantActions as any,
      scheduledActions: updates.scheduledActions as any,
    });
    if (unsupported) return NextResponse.json({ error: unsupported }, { status: 400 });
  }

  let row: any;
  try {
    row = await withTenant(session.tenantId, async (tx) => {
    const existing = await tx.select().from(workflowRules).where(and(eq(workflowRules.id, id), eq(workflowRules.tenantId, session.tenantId)));
    if (!existing[0]) return null;
    if (existing[0].locked && existing[0].lockedBy !== session.userId) {
      return { __locked: true };
    }
    const next: any = {};
    if (updates.name !== undefined) next.name = updates.name;
    if (updates.description !== undefined) next.description = updates.description;
    if (updates.triggerType !== undefined) next.triggerType = updates.triggerType;
    if (updates.triggerConfig !== undefined) next.triggerConfig = updates.triggerConfig;
    if (updates.criteriaPattern !== undefined) next.criteriaPattern = updates.criteriaPattern;
    if (updates.criteriaRows !== undefined) next.criteriaRows = updates.criteriaRows;
    if (updates.instantActions !== undefined) next.instantActions = updates.instantActions;
    if (updates.scheduledActions !== undefined) next.scheduledActions = updates.scheduledActions;
    if (updates.branches !== undefined) next.branches = updates.branches;
    if (updates.enabled !== undefined) next.enabled = updates.enabled;
    if (updates.executionOrder !== undefined) next.executionOrder = updates.executionOrder;
    next.updatedAt = new Date();

    const [r] = await tx.update(workflowRules).set(next).where(and(eq(workflowRules.id, id), eq(workflowRules.tenantId, session.tenantId))).returning();
    return r;
    });
  } catch (e: any) {
    if (isDuplicateNameError(e)) {
      return NextResponse.json({ error: "A rule with this name already exists in this module." }, { status: 409 });
    }
    throw e;
  }
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((row as any).__locked) return NextResponse.json({ error: "Rule is locked" }, { status: 423 });
  return NextResponse.json({ rule: row });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  requireCap(session.roles, "workflow.edit");
  const { id } = await params;

  await withTenant(session.tenantId, async (tx) => {
    await tx.delete(workflowRules).where(and(eq(workflowRules.id, id), eq(workflowRules.tenantId, session.tenantId)));
  });
  return NextResponse.json({ ok: true });
}
