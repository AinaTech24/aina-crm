/**
 * Daily firm- and RM-snapshot recorder.
 *
 * Once a day, writes one `firm_snapshots` row per tenant capturing that day's
 * AUM, active-client count, monthly SIP book and active-SIP count. AUM is a
 * point-in-time market value that can't be reconstructed retrospectively, so the
 * trend the copilot shows (get_aum_trend) accrues forward from the first run.
 *
 * It also writes one `rm_snapshots` row per (tenant, RM) for exactly the same
 * reason one level down. The personal cockpit asks "what was MY AUM a month
 * ago?", and the firm table has no RM dimension to answer it with. The only
 * alternative was to approximate AUM-then as AUM-now minus net flow, which
 * hands the RM credit for every point the market moved.
 *
 * Cross-tenant (system context) — one sweep, upsert keyed by (tenant_id, date)
 * / (tenant_id, rm_id, date) so re-runs on the same day are idempotent.
 */

import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";

export async function recordDailySnapshots(): Promise<number> {
  return withSystem(async (tx) => {
    // Per-tenant client aggregates in one pass.
    const agg = await tx.execute(sql`
      SELECT t.id AS tenant_id,
        COALESCE(SUM(i.aum::numeric) FILTER (WHERE i.deleted_at IS NULL AND i.status NOT IN ('closed', 'exited') AND i.merged_into_id IS NULL), 0) AS total_aum,
        COUNT(i.id) FILTER (WHERE i.deleted_at IS NULL AND i.status NOT IN ('closed', 'exited') AND i.merged_into_id IS NULL)::int AS active_clients,
        COALESCE(SUM(i.active_sip_amount::numeric) FILTER (WHERE i.deleted_at IS NULL AND i.status NOT IN ('closed', 'exited') AND i.merged_into_id IS NULL), 0) AS monthly_sip
      FROM tenants t
      LEFT JOIN investors i ON i.tenant_id = t.id
      WHERE t.deleted_at IS NULL
      GROUP BY t.id
    `);

    // Active-SIP counts per tenant (separate table).
    const sips = await tx.execute(sql`
      SELECT tenant_id, COUNT(*) FILTER (WHERE status = 'active')::int AS active_sips
      FROM sips GROUP BY tenant_id
    `);
    const sipByTenant = new Map((sips.rows as Array<{ tenant_id: string; active_sips: number }>).map((r) => [r.tenant_id, Number(r.active_sips) || 0]));

    let written = 0;
    for (const r of agg.rows as Array<{ tenant_id: string; total_aum: string; active_clients: number; monthly_sip: string }>) {
      await tx.execute(sql`
        INSERT INTO firm_snapshots (tenant_id, snapshot_date, total_aum, active_clients, monthly_sip, active_sips)
        VALUES (${r.tenant_id}::uuid, current_date, ${Number(r.total_aum) || 0}, ${Number(r.active_clients) || 0}, ${Number(r.monthly_sip) || 0}, ${sipByTenant.get(r.tenant_id) ?? 0})
        ON CONFLICT (tenant_id, snapshot_date) DO UPDATE SET
          total_aum = EXCLUDED.total_aum,
          active_clients = EXCLUDED.active_clients,
          monthly_sip = EXCLUDED.monthly_sip,
          active_sips = EXCLUDED.active_sips
      `);
      written++;
    }

    // ── Per-RM rows ────────────────────────────────────────────────────────
    // Only RMs who actually hold clients: an RM with an empty book has no AUM
    // history worth keeping, and adding a zero row every night for every past
    // employee would make the table grow with the staff list rather than the
    // business. The join is on investors, so an RM re-appears the day they are
    // given their first client.
    await tx.execute(sql`
      INSERT INTO rm_snapshots (tenant_id, rm_id, snapshot_date, aum, clients, monthly_sip, active_sips)
      SELECT i.tenant_id, i.rm_id, current_date,
             COALESCE(SUM(i.aum::numeric), 0),
             COUNT(*)::int,
             COALESCE(SUM(i.active_sip_amount::numeric), 0),
             COALESCE(SUM(s.n), 0)::int
        FROM investors i
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS n FROM sips
           WHERE sips.investor_id = i.id AND sips.status = 'active'
        ) s ON true
       WHERE i.rm_id IS NOT NULL
         AND i.deleted_at IS NULL AND i.status NOT IN ('closed', 'exited') AND i.merged_into_id IS NULL
       GROUP BY i.tenant_id, i.rm_id
      ON CONFLICT (tenant_id, rm_id, snapshot_date) DO UPDATE SET
        aum = EXCLUDED.aum,
        clients = EXCLUDED.clients,
        monthly_sip = EXCLUDED.monthly_sip,
        active_sips = EXCLUDED.active_sips
    `);

    // ── Per-branch rows (migration 0218) ───────────────────────────────────
    // Grouped by the branch that owns each CLIENT, the same attribution the
    // director's branch scoreboard and the branch command centre use — not by
    // the RM's branch, which would move a Surat client's AUM to Ahmedabad
    // because an Ahmedabad RM happens to service it.
    await tx.execute(sql`
      INSERT INTO branch_snapshots (tenant_id, branch_id, snapshot_date, aum, clients, monthly_sip, active_sips)
      SELECT i.tenant_id, i.branch_id, current_date,
             COALESCE(SUM(i.aum::numeric), 0),
             COUNT(*)::int,
             COALESCE(SUM(i.active_sip_amount::numeric), 0),
             COALESCE(SUM(s.n), 0)::int
        FROM investors i
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS n FROM sips
           WHERE sips.investor_id = i.id AND sips.status = 'active'
        ) s ON true
       WHERE i.branch_id IS NOT NULL
         AND i.deleted_at IS NULL AND i.status NOT IN ('closed', 'exited') AND i.merged_into_id IS NULL
       GROUP BY i.tenant_id, i.branch_id
      ON CONFLICT (tenant_id, branch_id, snapshot_date) DO UPDATE SET
        aum = EXCLUDED.aum,
        clients = EXCLUDED.clients,
        monthly_sip = EXCLUDED.monthly_sip,
        active_sips = EXCLUDED.active_sips
    `);

    return written;
  });
}
