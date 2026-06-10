/**
 * Net-Sales matrix (Finowise MIS idea) — Gross Sales · Redemption · Net Sales by
 * execution platform, for a product vertical + month. SERVER-ONLY.
 *
 * Net = Gross − Redemption. Gross = inflow lines (lumpsum / additional / sip /
 * switch / stp); Redemption = outflow lines (redemption / swp). Source: business
 * entries + their lines.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export const PRODUCT_OPTIONS: [string, string][] = [
  ["mutual_fund", "Mutual Fund"],
  ["pms", "PMS"],
  ["aif", "AIF"],
  ["sif", "SIF"],
  ["bond", "Bond"],
  ["ncd", "NCD"],
  ["other", "Other"],
  ["__all__", "All products"],
];

export type NetSalesRow = { platform: string; gross: number; redemption: number; net: number };
export type NetSalesMatrix = {
  period: string;
  productType: string;
  rows: NetSalesRow[];
  total: { gross: number; redemption: number; net: number };
};

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
function periodRange(period: string): { start: string; end: string } {
  const [y, m] = period.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start, end };
}

export async function loadNetSalesMatrix(tx: Tx, productType: string, period: string): Promise<NetSalesMatrix> {
  const { start, end } = periodRange(period);
  const all = productType === "__all__";
  const productCond = all ? sql`` : sql`AND be.product_type = ${productType}`;

  const res = await tx.execute(sql`
    SELECT COALESCE(NULLIF(be.platform, ''), '(Unspecified)') AS platform,
      COALESCE(SUM(bel.amount) FILTER (WHERE bel.txn_type IN ('lumpsum','additional_purchase','sip','switch','stp')), 0)::numeric AS gross,
      COALESCE(SUM(bel.amount) FILTER (WHERE bel.txn_type IN ('redemption','swp')), 0)::numeric AS redemption
    FROM business_entries be
    JOIN business_entry_lines bel ON bel.entry_id = be.id
    WHERE be.status IN ('confirmed','emailed')
      AND be.business_date >= ${start} AND be.business_date < ${end}
      ${productCond}
    GROUP BY COALESCE(NULLIF(be.platform, ''), '(Unspecified)')
    ORDER BY gross DESC
  `);

  const rows: NetSalesRow[] = (res.rows as any[]).map((r) => {
    const gross = n(r.gross);
    const redemption = n(r.redemption);
    return { platform: String(r.platform), gross, redemption, net: gross - redemption };
  });

  const total = rows.reduce(
    (a, r) => ({ gross: a.gross + r.gross, redemption: a.redemption + r.redemption, net: a.net + r.net }),
    { gross: 0, redemption: 0, net: 0 }
  );

  return { period, productType, rows, total };
}
