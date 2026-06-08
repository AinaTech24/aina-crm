/**
 * Blueprint lifecycle-event consumers.
 *
 * The blueprint engine emits three internal outbox events that, until now, had
 * NO subscriber (so the metadata was inert):
 *
 *   blueprint.stage.enter / blueprint.stage.exit
 *     — carry a `recipeKey`; we run that tenant's matching enabled workflow for
 *       the subject. This is what makes a stage's `automationsOnEnter` actually
 *       fire (send the doc checklist, the won-lead celebration, etc.).
 *
 *   blueprint.stage.delayed  (lead journey)
 *     — an SLA breach. We turn it into an actionable TASK for the lead's owner
 *       instead of just flipping a flag nobody sees.
 *
 * Wired into the outbox poller (src/workers/outbox-poller.ts). All best-effort:
 * a failure here is logged, never blocks the rest of outbox processing.
 */

import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { workflows } from "@/db/schema";
import { startRun } from "@/lib/workflow/runner";

/** Returns true if the event was a blueprint.stage.* event (handled here). */
export async function handleBlueprintStageEvent(event: any): Promise<boolean> {
  const kind: string = typeof event?.kind === "string" ? event.kind : "";
  if (!kind.startsWith("blueprint.stage.")) return false;

  const tenantId: string = event.tenant_id;
  const after = (event.after ?? {}) as { recipeKey?: string; stageKey?: string; stageName?: string; slaDays?: number };

  // ── Stage automations: run the named recipe's workflow for the subject ──
  if (kind === "blueprint.stage.enter" || kind === "blueprint.stage.exit") {
    const recipeKey = after.recipeKey;
    if (!recipeKey) return true;

    const wf = await withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: workflows.id })
        .from(workflows)
        .where(and(eq(workflows.tenantId, tenantId), eq(workflows.recipeKey, recipeKey), eq(workflows.enabled, true)))
        .limit(1);
      return row ?? null;
    });
    // No enabled workflow installed for this recipe → silent no-op (the stage
    // automation is simply "not configured", not an error).
    if (!wf) return true;

    await startRun({
      tenantId,
      workflowId: wf.id,
      triggeredBy: "event",
      subjectType: event.entity_type,
      subjectId: event.entity_id,
      contextSnapshot: { stageKey: after.stageKey ?? null, recipeKey, via: kind },
      event,
    });
    return true;
  }

  // ── SLA breach → owner task (lead journey only; SR/complaints have their own
  //    escalation sweep). ──
  if (kind === "blueprint.stage.delayed" && event.entity_type === "lead") {
    await createLeadDelayTask(tenantId, event.entity_id, after);
    return true;
  }

  return true;
}

async function createLeadDelayTask(
  tenantId: string,
  leadId: string,
  after: { stageKey?: string; stageName?: string; slaDays?: number }
): Promise<void> {
  const stageKey = after.stageKey ?? "";
  const stageName = after.stageName ?? (stageKey || "this stage");

  await withTenant(tenantId, async (tx) => {
    const leadRes = await tx.execute(
      sql`SELECT owner_id, name FROM leads WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`
    );
    const lead = leadRes.rows[0] as { owner_id?: string | null; name?: string | null } | undefined;
    if (!lead) return;

    // Dedup — one open SLA task per (lead, stage). A looped re-entry into the
    // same stage that breaches again will only re-task once the prior one closes.
    const dup = await tx.execute(sql`
      SELECT 1 FROM tasks
       WHERE tenant_id = ${tenantId}::uuid
         AND related_lead_id = ${leadId}::uuid
         AND status IN ('open', 'in_progress')
         AND type = 'blueprint_sla'
         AND meta->>'stageKey' = ${stageKey}
       LIMIT 1
    `);
    if (dup.rows.length) return;

    await tx.execute(sql`
      INSERT INTO tasks (
        id, tenant_id, subject_type, subject_id, related_lead_id, department,
        type, title, description, priority, status, assignee_id, due_at, meta,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), ${tenantId}::uuid, 'lead', ${leadId}::uuid, ${leadId}::uuid, 'sales',
        'blueprint_sla',
        ${`⏰ Lead overdue at "${stageName}" — ${lead.name ?? "lead"}`},
        ${`This lead has passed its SLA for the "${stageName}" stage. Advance it or update the disposition today so the pipeline stays clean.`},
        'high', 'open', ${lead.owner_id ?? null},
        now() + interval '1 day',
        ${JSON.stringify({ source: "blueprint_sla", stageKey })}::jsonb,
        now(), now()
      )
    `);
  });
}
