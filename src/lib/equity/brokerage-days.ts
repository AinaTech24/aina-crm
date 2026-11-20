/**
 * Equity desk — daily brokerage (We Care, 2026-11-20). SERVER-ONLY.
 *
 * The equity team enters one row per trading day, as it did in Zoho's "Equity"
 * module. The month's figure in equity_brokerage — what the Equity Team MIS and
 * the Brokerage MoM report read — is ALWAYS the sum of that month's days once
 * the month has any: `syncBrokerageMonth` runs after every write. A month with
 * no days keeps whatever was typed for it by hand (older history).
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type BrokerageDay = {
  id: string;
  tradeDate: string;
  brokerage: number;
  turnover: number | null;
  activeClients: number | null;
  notes: string | null;
  fromZoho: boolean;
  createdByName: string | null;
};

export type BrokerageDayInput = {
  tradeDate: string;
  brokerage: number;
  turnover?: number | null;
  activeClients?: number | null;
  notes?: string | null;
};

type Row = Record<string, unknown>;
const rowsOf = (res: { rows: unknown[] }): Row[] => res.rows as Row[];

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** "2026-11-05" → "2026-11". */
export const periodOf = (isoDate: string): string => isoDate.slice(0, 7);

/** The month's days, newest first. */
export async function listBrokerageDays(tx: Tx, tenantId: string, period: string): Promise<BrokerageDay[]> {
  const res = await tx.execute(sql`
    SELECT d.id, to_char(d.trade_date, 'YYYY-MM-DD') AS trade_date, d.brokerage, d.turnover, d.active_clients, d.notes,
           d.zoho_id IS NOT NULL AS from_zoho, u.name AS created_by_name
      FROM equity_brokerage_days d
      LEFT JOIN users u ON u.id = d.created_by
     WHERE d.tenant_id = ${tenantId}::uuid AND to_char(d.trade_date, 'YYYY-MM') = ${period}
     ORDER BY d.trade_date DESC, d.created_at DESC
  `);
  return rowsOf(res).map((r) => ({
    id: String(r.id),
    tradeDate: String(r.trade_date),
    brokerage: num(r.brokerage) ?? 0,
    turnover: num(r.turnover),
    activeClients: num(r.active_clients),
    notes: (r.notes as string | null) ?? null,
    fromZoho: !!r.from_zoho,
    createdByName: (r.created_by_name as string | null) ?? null,
  }));
}

/** Month totals for the last `months` months (for the desk's summary strip). */
export async function brokerageMonths(tx: Tx, tenantId: string, months = 13): Promise<{ period: string; amount: number; days: number | null }[]> {
  const res = await tx.execute(sql`
    SELECT b.period, b.amount,
           (SELECT COUNT(*)::int FROM equity_brokerage_days d WHERE d.tenant_id = b.tenant_id AND to_char(d.trade_date, 'YYYY-MM') = b.period) AS days
      FROM equity_brokerage b
     WHERE b.tenant_id = ${tenantId}::uuid
     ORDER BY b.period DESC
     LIMIT ${months}
  `);
  return rowsOf(res).map((r) => ({ period: String(r.period), amount: num(r.amount) ?? 0, days: r.days ? Number(r.days) : null }));
}

/**
 * Make the month's equity_brokerage row the sum of its days. A month whose last
 * day was just deleted keeps a row at ₹0 rather than vanishing, so the MIS shows
 * "0" for a month someone emptied, not a gap.
 */
export async function syncBrokerageMonth(tx: Tx, tenantId: string, period: string): Promise<void> {
  const res = await tx.execute(sql`
    SELECT COALESCE(SUM(brokerage), 0)::numeric AS amount, COUNT(*)::int AS days,
           COALESCE(SUM(turnover), 0)::numeric AS turnover, MAX(active_clients) AS active
      FROM equity_brokerage_days
     WHERE tenant_id = ${tenantId}::uuid AND to_char(trade_date, 'YYYY-MM') = ${period}
  `);
  const r = rowsOf(res)[0];
  const days = Number(r?.days ?? 0);
  const turnover = num(r?.turnover) ?? 0;
  const notes = `Daily entries: ${days} day${days === 1 ? "" : "s"}${turnover ? ` · turnover ₹${Math.round(turnover).toLocaleString("en-IN")}` : ""}${r?.active != null ? ` · active clients up to ${r.active}` : ""}`;
  await tx.execute(sql`
    INSERT INTO equity_brokerage (id, tenant_id, period, amount, notes, created_at, updated_at)
    VALUES (gen_random_uuid(), ${tenantId}::uuid, ${period}, ${String(r?.amount ?? 0)}, ${notes}, now(), now())
    ON CONFLICT (tenant_id, period) DO UPDATE SET amount = EXCLUDED.amount, notes = EXCLUDED.notes, updated_at = now()
  `);
}

export async function createBrokerageDay(tx: Tx, tenantId: string, userId: string, input: BrokerageDayInput): Promise<{ id: string }> {
  const res = await tx.execute(sql`
    INSERT INTO equity_brokerage_days (id, tenant_id, trade_date, brokerage, turnover, active_clients, notes, created_by, created_at, updated_at)
    VALUES (gen_random_uuid(), ${tenantId}::uuid, ${input.tradeDate}::date, ${String(input.brokerage)}, ${input.turnover == null ? null : String(input.turnover)},
            ${input.activeClients ?? null}, ${input.notes?.trim() || null}, ${userId}::uuid, now(), now())
    RETURNING id
  `);
  await syncBrokerageMonth(tx, tenantId, periodOf(input.tradeDate));
  return { id: String(rowsOf(res)[0].id) };
}

export async function updateBrokerageDay(tx: Tx, tenantId: string, id: string, input: Partial<BrokerageDayInput>): Promise<boolean> {
  const before = (await tx.execute(sql`
    SELECT to_char(trade_date, 'YYYY-MM-DD') AS d FROM equity_brokerage_days WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
  `)).rows[0] as { d: string } | undefined;
  if (!before) return false;
  await tx.execute(sql`
    UPDATE equity_brokerage_days SET
      trade_date = COALESCE(${input.tradeDate ?? null}::date, trade_date),
      brokerage = COALESCE(${input.brokerage == null ? null : String(input.brokerage)}::numeric, brokerage),
      turnover = CASE WHEN ${input.turnover !== undefined}::boolean THEN ${input.turnover == null ? null : String(input.turnover)}::numeric ELSE turnover END,
      active_clients = CASE WHEN ${input.activeClients !== undefined}::boolean THEN ${input.activeClients ?? null}::int ELSE active_clients END,
      notes = CASE WHEN ${input.notes !== undefined}::boolean THEN ${input.notes?.trim() || null} ELSE notes END,
      updated_at = now()
    WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
  `);
  await syncBrokerageMonth(tx, tenantId, periodOf(before.d));
  if (input.tradeDate && periodOf(input.tradeDate) !== periodOf(before.d)) await syncBrokerageMonth(tx, tenantId, periodOf(input.tradeDate));
  return true;
}

export async function deleteBrokerageDay(tx: Tx, tenantId: string, id: string): Promise<boolean> {
  const res = await tx.execute(sql`
    DELETE FROM equity_brokerage_days WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
    RETURNING to_char(trade_date, 'YYYY-MM-DD') AS d
  `);
  const d = rowsOf(res)[0]?.d as string | undefined;
  if (!d) return false;
  await syncBrokerageMonth(tx, tenantId, periodOf(d));
  return true;
}

/**
 * Zoho "Equity" rows → days, keyed by the Zoho record id so a re-sync updates
 * instead of duplicating. A day already edited in the CRM after its import is
 * still overwritten by Zoho — Zoho stays the source until the firm stops
 * entering there. Returns the months touched (each then re-summed).
 */
export async function upsertZohoBrokerageDays(
  tx: Tx,
  tenantId: string,
  rows: { zohoId: string; tradeDate: string; brokerage: number; turnover: number | null; activeClients: number | null }[],
): Promise<{ inserted: number; updated: number; periods: string[] }> {
  let inserted = 0;
  let updated = 0;
  const periods = new Set<string>();
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((r) => ({ z: r.zohoId, d: r.tradeDate, b: r.brokerage, t: r.turnover, a: r.activeClients }));
    const res = await tx.execute(sql`
      INSERT INTO equity_brokerage_days (id, tenant_id, trade_date, brokerage, turnover, active_clients, zoho_id, created_at, updated_at)
      SELECT gen_random_uuid(), ${tenantId}::uuid, v.d, v.b, v.t, v.a, v.z, now(), now()
        FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS v(z text, d date, b numeric, t numeric, a int)
      ON CONFLICT (tenant_id, zoho_id) WHERE zoho_id IS NOT NULL DO UPDATE SET
        trade_date = EXCLUDED.trade_date, brokerage = EXCLUDED.brokerage, turnover = EXCLUDED.turnover,
        active_clients = EXCLUDED.active_clients, updated_at = now()
      RETURNING (xmax = 0) AS ins
    `);
    for (const r of rowsOf(res)) (r.ins ? inserted++ : updated++);
    for (const r of batch) periods.add(periodOf(r.d));
  }
  for (const p of periods) await syncBrokerageMonth(tx, tenantId, p);
  return { inserted, updated, periods: [...periods].sort() };
}
