/**
 * AiSensy template sync — periodically polls AiSensy for the current
 * approval status of each tenant's templates. On status transition
 * (PENDING → APPROVED), flips the corresponding `templates` row to
 * `approved` so it becomes sendable.
 */

import { and, eq, sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { templates, tenants, whatsappTemplates } from "@/db/schema";
import { whatsappAdapter } from "@/lib/comms/adapters/aisensy";

export async function syncAllTenants(): Promise<{ tenants: number; updated: number }> {
  let updated = 0;
  const tenantRows = await withSystem(async (tx) => {
    return tx.select().from(tenants).where(sql`status NOT IN ('churned', 'suspended')`);
  });

  for (const t of tenantRows) {
    try {
      const live = await whatsappAdapter.listTemplates(t.id);
      await withTenant(t.id, async (tx) => {
        for (const meta of live) {
          // Upsert whatsapp_templates row. CRITICAL: link template_id by matching
          // the AiSensy template name to a WhatsApp template's `key` — without
          // this link the promote below never matches and WA templates never
          // become sendable. COALESCE on conflict so an existing link is kept.
          await tx.execute(
            sql`INSERT INTO whatsapp_templates
                  (id, tenant_id, template_id, aisensy_name, aisensy_language, category, meta_status,
                   meta_rejection_reason, components, last_synced_at, created_at, updated_at)
                VALUES (
                  gen_random_uuid(), ${t.id},
                  (SELECT id FROM templates WHERE tenant_id = ${t.id} AND channel = 'whatsapp' AND key = ${meta.name} LIMIT 1),
                  ${meta.name}, ${meta.language ?? "en"},
                  ${meta.category ?? "UTILITY"}, ${meta.status ?? "PENDING"},
                  ${meta.rejected_reason ?? null}, ${JSON.stringify(meta.components ?? [])}::jsonb,
                  now(), now(), now()
                )
                ON CONFLICT (tenant_id, aisensy_name, aisensy_language) DO UPDATE
                SET meta_status = EXCLUDED.meta_status,
                    meta_rejection_reason = EXCLUDED.meta_rejection_reason,
                    components = EXCLUDED.components,
                    template_id = COALESCE(whatsapp_templates.template_id, EXCLUDED.template_id),
                    last_synced_at = now(),
                    updated_at = now()`
          );
        }

        // Promote templates AWAITING Meta approval that are now APPROVED. Only
        // 'pending_approval' (NOT 'draft') — a draft never went through internal
        // submit/approval and must not jump straight to sendable.
        const promoted = await tx.execute(sql`
          UPDATE templates t SET status = 'approved'
          FROM whatsapp_templates wt
          WHERE wt.tenant_id = ${t.id}
            AND wt.template_id = t.id
            AND wt.meta_status = 'APPROVED'
            AND t.status = 'pending_approval'
          RETURNING t.id
        `);
        updated += promoted.rows.length;
      });
    } catch (err) {
      console.error(`[aisensy] sync failed for tenant ${t.id}:`, (err as Error).message);
    }
  }
  return { tenants: tenantRows.length, updated };
}

export function startAiSensyTemplateSyncWorker() {
  // Runs every 15 minutes
  const interval = 15 * 60 * 1000;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await syncAllTenants();
      console.log(`[aisensy] sync: tenants=${result.tenants} updated=${result.updated}`);
    } catch (err) {
      console.error("[aisensy] sync tick error:", (err as Error).message);
    } finally {
      running = false;
    }
  };
  // Run immediately, then on interval
  setTimeout(tick, 5_000);
  const handle = setInterval(tick, interval);
  console.log(`[aisensy] template-sync worker started`);
  return () => clearInterval(handle);
}
