/**
 * The plan's client limit and the registrar (the firm's decision of
 * 2026-10-26).
 *
 * Clients added by hand, by CSV or from a lead stop at the limit
 * (`assertInvestorQuota`). A CAMS / KFintech import is NEVER cut short by it:
 * the registrar's data is the firm's real book, and refusing it would leave
 * AUM and holdings stale. Instead, after every RTA import, a firm that is now
 * over its plan's limit is told — each owner once a day, kind
 * `plan.client_limit` — and Billing shows how far over it is.
 *
 * "Clients" is the same count as the quota and Billing: not closed, not
 * deleted.
 */

import { sql } from "drizzle-orm";
import { withTenant, type Tx } from "@/db/client";
import { loadTenantLicense } from "@/lib/auth/license";
import { createNotification } from "@/lib/notifications/create";

/** Notify each owner, once per India day, that the firm is over its client limit. Returns owners told. */
export async function warnIfOverClientLimit(tx: Tx, tenantId: string, cap: number, now = new Date()): Promise<number> {
  if (!cap || cap >= 1e9) return 0;
  const used = Number(((await tx.execute(sql`
    SELECT count(*)::int AS c FROM investors WHERE tenant_id = ${tenantId}::uuid AND status <> 'closed' AND deleted_at IS NULL
  `)).rows[0] as { c?: number } | undefined)?.c ?? 0);
  if (used <= cap) return 0;
  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const owners = (await tx.execute(sql`
    SELECT u.id::text AS id FROM users u
     WHERE u.tenant_id = ${tenantId}::uuid AND u.status = 'active' AND u.roles @> ARRAY['owner']::text[]
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
          WHERE n.tenant_id = u.tenant_id AND n.user_id = u.id AND n.kind = 'plan.client_limit' AND n.meta ->> 'date' = ${today}
       )
  `)).rows as Array<{ id: string }>;
  const fmt = (n: number) => n.toLocaleString("en-IN");
  for (const o of owners) {
    await createNotification(tx, {
      tenantId,
      userId: o.id,
      kind: "plan.client_limit",
      severity: "warning",
      title: `${fmt(used - cap)} clients over your plan`,
      body: `Your plan includes ${fmt(cap)} clients and the registrar data now holds ${fmt(used)}. Registrar imports keep running; adding clients by hand is paused until you upgrade.`,
      linkUrl: "/dashboard/billing",
      meta: { date: today, used, cap },
    });
  }
  return owners.length;
}

/** After an RTA import. Best effort — never fails the import. */
export async function warnIfOverClientLimitAfterImport(tenantId: string | null | undefined): Promise<void> {
  if (!tenantId) return;
  try {
    const license = await loadTenantLicense(tenantId, undefined);
    const cap = license.maxInvestors ?? 0;
    if (!cap || cap >= 1e9) return;
    const told = await withTenant(tenantId, (tx) => warnIfOverClientLimit(tx, tenantId, cap), { roles: ["system"] });
    if (told) console.log(`[rta] ${tenantId} is over its client limit — ${told} owner(s) told`);
  } catch (e) {
    console.warn(`[rta] client-limit check failed for ${tenantId}:`, (e as Error)?.message);
  }
}
