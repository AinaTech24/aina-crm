/**
 * POST /api/workflow-rules/library/activate  { key }
 *
 * Copies a predefined rule from the starter library into this tenant's
 * workflow_rules — created DISABLED so the owner reviews it (and picks their own
 * message template for comms actions) before enabling. Returns the new rule id
 * so the UI can open it in the editor.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { workflowRules } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { WorkflowRuleSchema } from "@/lib/workflow-rules/types";
import { isDuplicateNameError } from "@/lib/workflow-rules/guard";
import { getPredefinedRule } from "@/lib/workflow-rules/predefined";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await requireSession();
  requireCap(session.roles, "workflow.edit");

  const body = await req.json().catch(() => ({}));
  const key = String((body as { key?: string }).key ?? "");
  const predefined = getPredefinedRule(key);
  if (!predefined) return NextResponse.json({ error: "Unknown rule template" }, { status: 404 });

  // Re-validate the template through the same schema the create route uses, so a
  // bad template can never produce an invalid stored rule.
  const parsed = WorkflowRuleSchema.safeParse({ ...predefined.rule, enabled: false });
  if (!parsed.success) {
    return NextResponse.json({ error: "Template is invalid", issues: parsed.error.flatten() }, { status: 500 });
  }
  const input = parsed.data;

  try {
    const row = await withTenant(session.tenantId, async (tx) => {
      const [created] = await tx
        .insert(workflowRules)
        .values({
          tenantId: session.tenantId,
          module: input.module as any,
          name: input.name,
          description: input.description ?? null,
          triggerType: input.triggerType,
          triggerConfig: input.triggerConfig,
          criteriaPattern: input.criteriaPattern ?? null,
          criteriaRows: input.criteriaRows as any,
          instantActions: input.instantActions as any,
          scheduledActions: input.scheduledActions as any,
          branches: input.branches as any,
          enabled: false,
          executionOrder: input.executionOrder,
          createdBy: session.userId,
        })
        .returning();
      return created;
    });
    return NextResponse.json({ rule: row, id: row.id }, { status: 201 });
  } catch (e: any) {
    if (isDuplicateNameError(e)) {
      return NextResponse.json(
        { error: `"${predefined.rule.name}" is already in your rules. Open Workflow Rules to edit or enable it.`, code: "duplicate" },
        { status: 409 }
      );
    }
    throw e;
  }
}
