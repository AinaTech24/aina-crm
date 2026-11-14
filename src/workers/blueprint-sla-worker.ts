import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { createNotification } from "@/lib/notifications/create";
import { ensureInstance } from "@/lib/blueprints/engine";
import { isClientPhaseStage } from "@/lib/blueprints/journey-rules";

/**
 * Sweeps active Lead and Polymorphic Blueprint instances,
 * flags them as delayed (is_delayed = true) on SLA breach,
 * and fires outbox events.
 */
export async function checkBlueprintSLADelays(): Promise<{
  leadsDelayed: number;
  polyDelayed: number;
}> {
  return await withSystem(async (tx) => {
    // 0. A lead nobody has opened has no journey yet (instances were created
    //    on first touch), so an untouched lead never breached anything and
    //    never escalated (audit L5). Open the journey for every lead still at
    //    New past its first-response day, dated from when the lead arrived.
    const untouched = await tx.execute(sql`
      SELECT l.id, l.tenant_id, l.created_at FROM leads l
       WHERE l.stage = 'new' AND l.converted_investor_id IS NULL AND l.lost_reason IS NULL
         AND l.created_at < now() - interval '1 day'
         AND NOT EXISTS (SELECT 1 FROM lead_blueprint_instances b WHERE b.lead_id = l.id AND b.tenant_id = l.tenant_id)
       ORDER BY l.created_at
       LIMIT 500
    `);
    for (const l of untouched.rows as Array<{ id: string; tenant_id: string; created_at: string | Date }>) {
      try {
        await tx.transaction((sp) => ensureInstance(sp as any, l.tenant_id, l.id, { enteredAt: new Date(l.created_at) }));
      } catch {
        // A firm with no blueprint yet is seeded on first use; skip, retry next sweep.
      }
    }

    // 1. Sweep lead_blueprint_instances (Leads). A deleted or lost lead's
    //    journey is over — no SLA, no alert (audit L20).
    const newlyDelayedLeads = await tx.execute(sql`
      WITH due AS (
        SELECT lbi.id AS instance_id, lbi.tenant_id, lbi.lead_id, lbi.current_stage_key,
               bs.sla_days, bs.stage_name
        FROM lead_blueprint_instances lbi
        JOIN blueprint_stages bs
          ON bs.blueprint_id = lbi.blueprint_id
         AND bs.stage_key = lbi.current_stage_key
        WHERE lbi.status = 'in_progress'
          AND lbi.is_delayed = false
          AND bs.sla_days IS NOT NULL
          AND lbi.stage_entered_at + (bs.sla_days || ' days')::interval < now()
          AND NOT EXISTS (
            SELECT 1 FROM leads ld WHERE ld.id = lbi.lead_id
               AND (ld.lost_reason = '__deleted__' OR ld.stage = 'not_qualified')
          )
      )
      UPDATE lead_blueprint_instances l
        SET is_delayed = true,
            delayed_since = now(),
            updated_at = now()
        FROM due
       WHERE l.id = due.instance_id
       RETURNING l.id, l.tenant_id, l.lead_id, l.current_stage_key,
                 due.stage_name, due.sla_days
    `);

    // Emit outbox events + notify the owner (and escalate untouched leads) for
    // each newly-delayed lead, so an SLA breach is actually seen — not just a
    // silent `is_delayed` flag. Fires once per breach (the WHERE is_delayed=false
    // guard above means a lead is swept here only on the transition into delayed).
    for (const r of newlyDelayedLeads.rows as any[]) {
      await tx.execute(sql`
        INSERT INTO events_outbox (tenant_id, kind, entity_type, entity_id, after, meta)
        VALUES (
          ${r.tenant_id}::uuid,
          'blueprint.stage.delayed',
          'lead',
          ${r.lead_id}::uuid,
          ${JSON.stringify({ stageKey: r.current_stage_key, stageName: r.stage_name, slaDays: r.sla_days })}::jsonb,
          ${JSON.stringify({ source: "sla_worker" })}::jsonb
        )
      `);

      try {
        await notifyDelayed(tx, r);
      } catch {
        // Notification is best-effort — never fail the SLA sweep over a notify.
      }
    }

    // 2. Sweep blueprint_instances (Polymorphic subjects)
    const newlyDelayedPoly = await tx.execute(sql`
      WITH due AS (
        SELECT bi.id AS instance_id, bi.tenant_id, bi.subject_type, bi.subject_id, bi.current_stage_key,
               bs.sla_days, bs.stage_name
        FROM blueprint_instances bi
        JOIN blueprint_stages bs
          ON bs.blueprint_id = bi.blueprint_id
         AND bs.stage_key = bi.current_stage_key
        WHERE bi.status = 'in_progress'
          AND bi.is_delayed = false
          AND bs.sla_days IS NOT NULL
          AND bi.stage_entered_at + (bs.sla_days || ' days')::interval < now()
      )
      UPDATE blueprint_instances b
        SET is_delayed = true,
            delayed_since = now(),
            updated_at = now()
        FROM due
       WHERE b.id = due.instance_id
       RETURNING b.id, b.tenant_id, b.subject_type, b.subject_id, b.current_stage_key,
                 due.stage_name, due.sla_days
    `);

    // Emit outbox events for each newly-delayed polymorphic instance
    for (const r of newlyDelayedPoly.rows as any[]) {
      await tx.execute(sql`
        INSERT INTO events_outbox (tenant_id, kind, entity_type, entity_id, after, meta)
        VALUES (
          ${r.tenant_id}::uuid,
          'blueprint.stage.delayed',
          ${r.subject_type},
          ${r.subject_id}::uuid,
          ${JSON.stringify({ stageKey: r.current_stage_key, stageName: r.stage_name, slaDays: r.sla_days })}::jsonb,
          ${JSON.stringify({ source: "sla_worker" })}::jsonb
        )
      `);
    }

    return {
      leadsDelayed: newlyDelayedLeads.rows.length,
      polyDelayed: newlyDelayedPoly.rows.length,
    };
  });
}

/**
 * Starts the blueprint SLA worker poller.
 */
export function startBlueprintSLAWorker(): () => void {
  const interval = Number(process.env.BLUEPRINT_SLA_INTERVAL_MS ?? 300_000); // 5 minutes default
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const results = await checkBlueprintSLADelays();
      if (results.leadsDelayed > 0 || results.polyDelayed > 0) {
        console.log(
          `[blueprint-sla-worker] swept: leadsDelayed=${results.leadsDelayed} polyDelayed=${results.polyDelayed}`
        );
      }
    } catch (err) {
      console.error("[blueprint-sla-worker] sweep failed:", (err as Error).message);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(tick, interval);
  console.log(`[blueprint-sla-worker] started (interval=${interval}ms)`);
  return () => clearInterval(handle);
}

type DelayedRow = { tenant_id: string; lead_id: string; current_stage_key: string; stage_name: string; sla_days: number };

/**
 * Who hears about a step past its SLA.
 *
 *  - An untouched lead (still New): its owner, the firm's owners and the
 *    branch head(s) of the LEAD's branch — not every branch head in the firm.
 *  - Client onboarding: the person who holds the step's open task and the
 *    client's CURRENT RM, worded as onboarding (audit C13).
 *  - Any other lead step: the lead's owner.
 */
async function notifyDelayed(tx: any, r: DelayedRow): Promise<void> {
  const lr = await tx.execute(sql`
    SELECT l.owner_id, l.name, l.lead_score, l.score_band, l.branch_id, l.converted_investor_id,
           i.rm_id AS client_rm_id, i.name AS client_name
      FROM leads l LEFT JOIN investors i ON i.id = l.converted_investor_id
     WHERE l.id = ${r.lead_id}::uuid AND l.tenant_id = ${r.tenant_id}::uuid LIMIT 1
  `);
  const lead = lr.rows[0] as
    | { owner_id?: string; name?: string; lead_score?: number; score_band?: string; branch_id?: string | null;
        converted_investor_id?: string | null; client_rm_id?: string | null; client_name?: string | null }
    | undefined;
  // A journey whose subject is a client directly (no lead row).
  const inv = lead
    ? null
    : ((await tx.execute(sql`
        SELECT id, name, rm_id FROM investors WHERE id = ${r.lead_id}::uuid AND tenant_id = ${r.tenant_id}::uuid LIMIT 1
      `)).rows[0] as { id: string; name: string; rm_id: string | null } | undefined);

  const recipients = new Set<string>();
  const onboarding = isClientPhaseStage(r.current_stage_key);
  if (onboarding) {
    const owner = await tx.execute(sql`
      SELECT assignee_id FROM tasks
       WHERE tenant_id = ${r.tenant_id}::uuid AND deleted_at IS NULL AND status NOT IN ('completed', 'cancelled')
         AND meta->>'journeyLeadId' = ${r.lead_id} AND meta->>'journeyStageKey' = ${r.current_stage_key}
         AND assignee_id IS NOT NULL
       LIMIT 1
    `);
    const stepOwner = (owner.rows[0] as { assignee_id?: string } | undefined)?.assignee_id;
    if (stepOwner) recipients.add(stepOwner);
    const rm = lead?.client_rm_id ?? inv?.rm_id ?? (lead && !lead.converted_investor_id ? lead.owner_id : null);
    if (rm) recipients.add(rm);
    const clientId = lead?.converted_investor_id ?? inv?.id ?? null;
    const name = lead?.client_name ?? inv?.name ?? lead?.name ?? "client";
    for (const userId of await activeOnly(tx, r.tenant_id, recipients)) {
      await createNotification(tx, {
        tenantId: r.tenant_id,
        userId,
        kind: "blueprint.stage.delayed",
        title: `Onboarding overdue: ${name}`,
        body: `The "${r.stage_name}" onboarding step is past its ${r.sla_days}-day SLA — move it on or update the client.`,
        linkUrl: clientId ? `/dashboard/investors/${clientId}` : `/dashboard/leads/${r.lead_id}`,
        severity: "warning",
        meta: { lead_id: r.lead_id, investor_id: clientId, stage: r.current_stage_key, sla_days: r.sla_days, source: "sla_worker" },
      });
    }
    return;
  }

  if (!lead) return;
  const untouched = r.current_stage_key === "new"; // never first-contacted
  // Hot lead = a high deterministic score / "hot" band. An untouched HOT
  // lead is the costliest miss, so it escalates harder (critical + 🔥).
  const hot = lead.score_band === "hot" || Number(lead.lead_score ?? 0) >= 70;
  if (lead.owner_id) recipients.add(lead.owner_id);
  if (untouched) {
    const mgrs = await tx.execute(sql`
      SELECT id FROM users
       WHERE tenant_id = ${r.tenant_id}::uuid AND status = 'active'
         AND ('owner' = ANY(roles)
              OR ('branch_head' = ANY(roles) AND ${lead.branch_id ?? null}::uuid IS NOT NULL AND branch_id = ${lead.branch_id ?? null}::uuid))
    `);
    for (const m of mgrs.rows as Array<{ id: string }>) recipients.add(m.id);
  }
  const name = lead.name ?? "lead";
  const title = untouched ? `${hot ? "🔥 Hot lead untouched" : "Untouched lead"}: ${name}` : `Lead overdue: ${name}`;
  const severity = untouched ? (hot ? "critical" : "warning") : "info";
  for (const userId of await activeOnly(tx, r.tenant_id, recipients)) {
    await createNotification(tx, {
      tenantId: r.tenant_id,
      userId,
      kind: "blueprint.stage.delayed",
      title,
      body: `Stuck in "${r.stage_name}" past the ${r.sla_days}-day SLA — follow up to keep it moving.`,
      linkUrl: `/dashboard/leads/${r.lead_id}`,
      severity,
      meta: { lead_id: r.lead_id, stage: r.current_stage_key, sla_days: r.sla_days, hot, source: "sla_worker" },
    });
  }
}

async function activeOnly(tx: any, tenantId: string, ids: Set<string>): Promise<string[]> {
  if (!ids.size) return [];
  const r = await tx.execute(sql`
    SELECT id::text AS id FROM users
     WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
       AND id IN (${sql.join([...ids].map((x) => sql`${x}::uuid`), sql`, `)})
  `);
  return (r.rows as Array<{ id: string }>).map((x) => x.id);
}
