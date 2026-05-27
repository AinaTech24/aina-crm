import { dispatch } from "@/lib/comms/pipeline";
import { resolveExpression, resolveRecord } from "../context";
import type { ActionHandler } from "./index";

export const sendSmsHandler: ActionHandler<any> = {
  type: "send_sms",
  async execute(ctx, node, tx) {
    const cfg = node.config;
    const resolvedVars = resolveRecord(cfg.variables ?? {}, ctx);
    let recipient: string | null = null;
    if (cfg.recipient.source === "fixed") {
      recipient = String(cfg.recipient.value ?? "");
    } else if (cfg.recipient.source === "context") {
      recipient = String(resolveExpression(cfg.recipient.value ?? "", ctx) ?? "");
    } else {
      recipient = String(ctx.subject?.phone ?? "");
    }
    if (!recipient) throw new Error("send_sms: recipient unresolved");

    const result = await dispatch(tx, {
      tenantId: ctx.tenantId,
      channel: "sms",
      templateKey: cfg.templateKey,
      recipient,
      variables: resolvedVars,
      category: "transactional",
      investorId: ctx.subjectType === "investor" ? ctx.subjectId ?? undefined : undefined,
      leadId: ctx.subjectType === "lead" ? ctx.subjectId ?? undefined : undefined,
      workflowRunId: ctx.runId,
      workflowRunStepId: ctx.stepId,
    });

    return {
      kind: "continue",
      output: {
        communicationId: result.communicationId,
        status: result.status,
        externalId: result.externalId,
      },
    };
  },
};
