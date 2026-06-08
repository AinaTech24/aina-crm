/**
 * Wapi (Aina WhatsApp) template-sync worker.
 *
 * Polls the Wapi workspace's template list (GET /extension/templates) and
 * mirrors each template's Meta approval status into `whatsapp_templates`. When a
 * template that already passed internal approval (templates.status =
 * 'pending_approval') is APPROVED on Meta, we flip templates.status → 'approved'
 * so the comms pipeline will send it.
 *
 * Runs every 15 minutes (WORKER_GROUPS includes "wa_sync").
 *
 * Stores the Meta template name + language in `whatsapp_templates`
 * (meta_template_name / meta_language).
 */

import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { wainaWhatsappAdapter } from "@/lib/comms/adapters/waina";

export async function syncAllTenants(): Promise<{ tenants: number; updated: number }> {
  let updated = 0;

  // Templates come from the shared Wapi workspace (env key). Fetch once.
  const metaTemplates = await wainaWhatsappAdapter.listTemplates();
  if (!metaTemplates.length) return { tenants: 0, updated: 0 };

  const tenants = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT id FROM tenants WHERE status NOT IN ('churned', 'suspended')
    `);
    return r.rows as Array<{ id: string }>;
  });

  for (const t of tenants) {
    await withSystem(async (tx) => {
      for (const meta of metaTemplates as Array<any>) {
        const name = meta.name ?? meta.template_name;
        if (!name) continue;
        await tx.execute(sql`
          INSERT INTO whatsapp_templates
            (id, tenant_id, template_id, meta_template_name, meta_language, category, meta_status,
             meta_rejection_reason, components, last_synced_at, created_at, updated_at)
          VALUES (
            gen_random_uuid(), ${t.id},
            (SELECT id FROM templates WHERE tenant_id = ${t.id} AND channel = 'whatsapp' AND key = ${name} LIMIT 1),
            ${name}, ${meta.language ?? "en"},
            ${(meta.category ?? "UTILITY").toString().toUpperCase()},
            ${(meta.status ?? "PENDING").toString().toUpperCase()},
            ${meta.rejected_reason ?? meta.rejection_reason ?? null},
            ${JSON.stringify(meta.components ?? [])}::jsonb,
            now(), now(), now()
          )
          ON CONFLICT (tenant_id, meta_template_name, meta_language) DO UPDATE
          SET meta_status = EXCLUDED.meta_status,
              meta_rejection_reason = EXCLUDED.meta_rejection_reason,
              components = EXCLUDED.components,
              template_id = COALESCE(whatsapp_templates.template_id, EXCLUDED.template_id),
              last_synced_at = now(),
              updated_at = now()
        `);
      }

      // Promote internally-approved WhatsApp templates that Meta has now approved.
      const res = await tx.execute(sql`
        UPDATE templates SET status = 'approved', updated_at = now()
        WHERE tenant_id = ${t.id} AND channel = 'whatsapp' AND status = 'pending_approval'
          AND key IN (
            SELECT meta_template_name FROM whatsapp_templates
            WHERE tenant_id = ${t.id} AND meta_status = 'APPROVED'
          )
      `);
      updated += (res as any).rowCount ?? 0;
    });
  }

  return { tenants: tenants.length, updated };
}

export function startWapiTemplateSyncWorker(): () => void {
  const INTERVAL = 15 * 60 * 1000;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { tenants, updated } = await syncAllTenants();
      if (tenants || updated) console.log(`[wapi-template-sync] tenants=${tenants} promoted=${updated}`);
    } catch (err) {
      console.error("[wapi-template-sync] failed:", err);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, INTERVAL);
  const kickoff = setTimeout(tick, 5000);
  return () => {
    clearInterval(timer);
    clearTimeout(kickoff);
  };
}
