/**
 * Billing usage — live consumption against the plan's caps, so the billing page
 * can show "8 of 25 users", "12 GB of 100 GB" etc. instead of bare limits.
 *
 *   users     — active users vs seat cap
 *   investors — open clients vs maxInvestors (same predicate as assertInvestorQuota)
 *   storage   — summed tracked file bytes vs storageLimitGb
 *   messages  — this-month outbound vs maxMessagesPerMonth (same predicate as the comms quota)
 *
 * Storage is the sum of the three tables that actually record file sizes
 * (compliance docs, content library, RTA uploads); the bytes live in S3 but
 * these rows are the tracked accounting of them.
 */

import { sql } from "drizzle-orm";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export type UsageMetric = { used: number; limit: number | null; pct: number | null };
export type BillingUsage = {
  users: UsageMetric;
  investors: UsageMetric;
  storage: UsageMetric; // used = GB used, limit = GB
  messages: UsageMetric; // limit = monthly cap (null = unlimited)
  storageUsedBytes: number;
};

function metric(used: number, limit: number | null): UsageMetric {
  const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : null;
  return { used, limit, pct };
}

export async function getBillingUsage(
  tx: Tx,
  tenantId: string,
  caps: { seatLimit: number; investorLimit: number; storageGb: number; messageCap: number }
): Promise<BillingUsage> {
  const [usersRes, investorsRes, storageRes, messagesRes] = await Promise.all([
    tx.execute(sql`SELECT count(*)::int AS c FROM users WHERE tenant_id = ${tenantId}::uuid AND status = 'active'`),
    tx.execute(sql`SELECT count(*)::int AS c FROM investors WHERE tenant_id = ${tenantId}::uuid AND status <> 'closed' AND deleted_at IS NULL`),
    tx.execute(sql`
      SELECT
        COALESCE((SELECT SUM(NULLIF(size_bytes,'')::bigint) FROM compliance_documents WHERE tenant_id = ${tenantId}::uuid), 0)
        + COALESCE((SELECT SUM(file_size_bytes) FROM content_library_assets WHERE tenant_id = ${tenantId}::uuid), 0)
        + COALESCE((SELECT SUM(file_size_bytes) FROM rta_file_imports WHERE tenant_id = ${tenantId}::uuid), 0)
        AS bytes
    `),
    tx.execute(sql`
      SELECT count(*)::int AS c FROM communications
      WHERE tenant_id = ${tenantId}::uuid AND direction = 'outbound'
        AND created_at >= date_trunc('month', now())
        AND status NOT LIKE 'skipped_%' AND status <> 'failed'
    `),
  ]);

  const usersUsed = Number((usersRes.rows[0] as any)?.c ?? 0);
  const investorsUsed = Number((investorsRes.rows[0] as any)?.c ?? 0);
  const storageBytes = Number((storageRes.rows[0] as any)?.bytes ?? 0);
  const messagesUsed = Number((messagesRes.rows[0] as any)?.c ?? 0);

  const storageUsedGb = storageBytes / (1024 * 1024 * 1024);

  return {
    users: metric(usersUsed, caps.seatLimit || null),
    investors: metric(investorsUsed, caps.investorLimit && caps.investorLimit < 1e9 ? caps.investorLimit : null),
    storage: metric(Number(storageUsedGb.toFixed(2)), caps.storageGb || null),
    messages: metric(messagesUsed, caps.messageCap > 0 ? caps.messageCap : null),
    storageUsedBytes: storageBytes,
  };
}
