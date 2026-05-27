import { v4 as uuid } from "uuid";
import { auditLog } from "@/db/schema";
import { resolveExpression } from "../context";
import type { ActionHandler } from "./index";

/**
 * Raise an alert to a set of users (by role or id), optionally via additional
 * channels. Writes to audit_log + creates in-app notifications.
 */
export const raiseAlertHandler: ActionHandler<any> = {
  type: "raise_alert",
  async execute(ctx, node, tx) {
    const cfg = node.config;
    const title = String(resolveExpression(cfg.title, ctx));
    const body = cfg.body ? String(resolveExpression(cfg.body, ctx)) : null;

    await tx.insert(auditLog).values({
      id: uuid(),
      tenantId: ctx.tenantId,
      actorType: "workflow",
      action: `alert.${cfg.severity}`,
      entityType: ctx.subjectType ?? null,
      entityId: ctx.subjectId ?? null,
      meta: { title, body, audience: cfg.audience, channels: cfg.channels },
      reason: title,
    });

    // TODO: in-app push + optional email/WA via comms pipeline for channels.

    return { kind: "continue", output: { severity: cfg.severity, title } };
  },
};
