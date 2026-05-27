import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { tasks, users } from "@/db/schema";
import { resolveExpression } from "../context";
import type { ActionHandler } from "./index";

export const createTaskHandler: ActionHandler<any> = {
  type: "create_task",
  async execute(ctx, node, tx) {
    const cfg = node.config;
    const title = String(resolveExpression(cfg.title, ctx));
    const description = cfg.description ? String(resolveExpression(cfg.description, ctx)) : null;
    const subjectType = cfg.subjectType ?? ctx.subjectType ?? "investor";

    // Resolve assignee
    let assigneeId: string | null = null;
    if (cfg.assignee.startsWith("fixed:")) {
      assigneeId = cfg.assignee.replace("fixed:", "");
    } else if (cfg.assignee === "round_robin:rm") {
      const usersList = await tx
        .select()
        .from(users)
        .where(eq(users.tenantId, ctx.tenantId));
      const rms = usersList.filter((u: any) => (u.roles as string[])?.includes("rm") && u.status === "active");
      if (rms.length > 0) {
        const idx = Math.floor(Math.random() * rms.length); // simple — refine to actual round-robin
        assigneeId = rms[idx].id;
      }
    } else if (cfg.assignee === "branch_head" && ctx.subject?.branch_id) {
      assigneeId = ctx.subject.branch_id; // refine: look up branch.head_user_id
    } else {
      assigneeId = String(resolveExpression(cfg.assignee, ctx) ?? "") || null;
    }

    const dueAt = cfg.dueAfter ? addDuration(new Date(), cfg.dueAfter) : null;
    const slaDueAt = cfg.slaAfter ? addDuration(new Date(), cfg.slaAfter) : null;

    const id = uuid();
    await tx.insert(tasks).values({
      id,
      tenantId: ctx.tenantId,
      subjectType,
      subjectId: ctx.subjectId,
      type: cfg.type,
      title,
      description,
      priority: cfg.priority,
      assigneeId,
      dueAt,
      slaDueAt,
      workflowRunId: ctx.runId,
      workflowStepId: ctx.stepId,
      status: "open",
    });
    ctx.log(`created task ${id} for ${assigneeId ?? "unassigned"}`);
    return {
      kind: "continue",
      output: { taskId: id, assigneeId, dueAt: dueAt?.toISOString() ?? null },
      varsPatch: { lastTaskId: id },
    };
  },
};

function addDuration(d: Date, dur: { amount: number; unit: string }): Date {
  const n = new Date(d);
  switch (dur.unit) {
    case "minute": n.setMinutes(n.getMinutes() + dur.amount); break;
    case "hour":   n.setHours(n.getHours() + dur.amount); break;
    case "day":    n.setDate(n.getDate() + dur.amount); break;
    case "week":   n.setDate(n.getDate() + dur.amount * 7); break;
  }
  return n;
}
