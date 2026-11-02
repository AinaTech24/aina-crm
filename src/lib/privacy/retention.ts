/**
 * The nightly retention job (rules in retention-core.ts), run per firm by
 * workers/daily-ops-scanner.ts. A lost lead is blanked the way an erasure
 * request blanks it; a former client past the retention period is purged the
 * way the Trash purges (which never touches a client who holds money). The
 * firm's owners are told what was erased; each run is audited.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { leads } from "@/db/schema";
import type { Tx } from "@/db/client";
import { purgeInvestorsChunk } from "@/lib/investors/purge";
import { holdsMoneySql } from "@/lib/investors/holds-money";
import { createNotification } from "@/lib/notifications/create";
import { recordAudit } from "@/lib/audit";
import { eraseLeads } from "./requests";
import { LEAD_ERASE_PATCH } from "./requests-core";
import { NIGHTLY_LIMIT, cutoffs, readRetention, retentionIsOn, type RetentionSettings } from "./retention-core";

const ERASED_NAME = String(LEAD_ERASE_PATCH.name);

/** Who the policy would erase right now (ids, capped per night). */
async function dueIds(tx: Tx, tenantId: string, s: RetentionSettings, limit: { leads: number; clients: number } = NIGHTLY_LIMIT) {
  const { leadsBefore, clientsExitedBefore } = cutoffs(s);
  const leads = leadsBefore
    ? ((await tx.execute(sql`
        SELECT id FROM leads
         WHERE tenant_id = ${tenantId}::uuid AND converted_investor_id IS NULL AND name <> ${ERASED_NAME}
           AND (stage IN ('lost', 'not_interested') OR lost_reason IS NOT NULL)
           AND COALESCE(lost_at, stage_changed_at, updated_at) < ${leadsBefore.toISOString()}::timestamptz
         ORDER BY COALESCE(lost_at, stage_changed_at, updated_at)
         LIMIT ${limit.leads}`)).rows as Array<{ id: string }>).map((r) => r.id)
    : [];
  const clients = clientsExitedBefore
    ? ((await tx.execute(sql`
        SELECT i.id FROM investors i
         WHERE i.tenant_id = ${tenantId}::uuid AND i.status IN ('closed', 'exited')
           AND i.exited_at IS NOT NULL AND i.exited_at < ${clientsExitedBefore.toISOString()}::timestamptz
           AND i.merged_into_id IS NULL AND NOT ${holdsMoneySql("i")}
         ORDER BY i.exited_at
         LIMIT ${limit.clients}`)).rows as Array<{ id: string }>).map((r) => r.id)
    : [];
  return { leads, clients };
}

/** What switching a policy on would erase tonight (counts, uncapped up to 100k). */
export async function previewRetention(tx: Tx, tenantId: string, s: RetentionSettings): Promise<{ leads: number; clients: number }> {
  const ids = await dueIds(tx, tenantId, s, { leads: 100_000, clients: 100_000 });
  return { leads: ids.leads.length, clients: ids.clients.length };
}

export async function runRetentionPolicy(tx: Tx, tenantId: string): Promise<{ leads: number; clients: number }> {
  const r = await tx.execute(sql`SELECT data_retention FROM tenants WHERE id = ${tenantId}::uuid`);
  const settings = readRetention((r.rows[0] as { data_retention?: unknown } | undefined)?.data_retention);
  if (!retentionIsOn(settings)) return { leads: 0, clients: 0 };

  const due = await dueIds(tx, tenantId, settings);
  if (due.clients.length) {
    const src = await tx.select({ id: leads.id }).from(leads)
      .where(and(eq(leads.tenantId, tenantId), inArray(leads.convertedInvestorId, due.clients)));
    await eraseLeads(tx, tenantId, src.map((x) => x.id));
  }
  await eraseLeads(tx, tenantId, due.leads);
  const clients = due.clients.length ? await purgeInvestorsChunk(tx, tenantId, due.clients) : 0;
  const out = { leads: due.leads.length, clients };

  const lastRun = { at: new Date().toISOString(), ...out };
  const stamp = out.leads || out.clients ? { lastRun, lastErased: lastRun } : { lastRun };
  await tx.execute(sql`
    UPDATE tenants SET data_retention = data_retention || ${JSON.stringify(stamp)}::jsonb WHERE id = ${tenantId}::uuid`);

  if (out.leads || out.clients) {
    await recordAudit(tx, {
      tenantId, actorUserId: null, action: "privacy.retention_run",
      entityType: "tenant", entityId: tenantId, after: { ...out, settings },
    });
    const owners = (await tx.execute(sql`
      SELECT id FROM users WHERE tenant_id = ${tenantId}::uuid AND status = 'active' AND 'owner' = ANY(roles)`)).rows as Array<{ id: string }>;
    const parts = [out.leads ? `${out.leads} lost lead${out.leads === 1 ? "" : "s"}` : "", out.clients ? `${out.clients} former client${out.clients === 1 ? "" : "s"}` : ""].filter(Boolean);
    for (const o of owners) {
      await createNotification(tx, {
        tenantId, userId: o.id, kind: "privacy.retention_run",
        title: `Data retention: ${parts.join(" and ")} erased`,
        body: "Your retention policy erased personal data the firm no longer needs (Settings → Privacy notice).",
        linkUrl: "/dashboard/settings/privacy-notice",
        severity: "info",
      });
    }
  }
  return out;
}
