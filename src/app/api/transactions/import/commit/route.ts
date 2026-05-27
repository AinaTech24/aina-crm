/**
 * POST /api/transactions/import/commit
 *
 * Resolves each row's PAN → investor_id (within this tenant). Rows with no PAN
 * match get errored. Maps transaction type/direction/status to enum values.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const Body = z.object({
  mapping: z.record(z.string(), z.string()),
  rows: z.array(z.record(z.string(), z.any())),
});

const VALID_TYPES = new Set(["lumpsum", "sip", "stp", "swp", "redemption", "switch", "dividend_payout", "dividend_reinvest"]);
const VALID_STATUS = new Set(["pending", "submitted", "successful", "rejected", "failed", "cancelled"]);
const VALID_SOURCES = new Set(["bse", "nse", "cams", "kfintech", "manual", "import"]);

function inferDirection(type: string): "inflow" | "outflow" {
  if (["redemption", "swp", "dividend_payout"].includes(type)) return "outflow";
  return "inflow";
}

function normaliseDate(s: string): string {
  if (!s) return new Date().toISOString().slice(0, 10);
  const m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute");
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const reverse: Record<string, string> = {};
    for (const [src, our] of Object.entries(parse.data.mapping)) if (our) reverse[our] = src;
    if (!reverse.pan || !reverse.type || !reverse.amount) {
      return NextResponse.json({ error: "must map pan, type, amount at minimum" }, { status: 400 });
    }

    function pick(row: any, h?: string) {
      if (!h) return "";
      const v = row[h];
      return v === null || v === undefined ? "" : String(v).trim();
    }

    let inserted = 0;
    const errors: Array<{ rowIndex: number; error: string }> = [];

    await withTenant(session.tenantId, async (tx) => {
      for (let i = 0; i < parse.data.rows.length; i++) {
        const row = parse.data.rows[i];
        const pan = pick(row, reverse.pan).toUpperCase();
        const typeRaw = pick(row, reverse.type).toLowerCase().replace(/\s+/g, "_");
        const type = VALID_TYPES.has(typeRaw) ? typeRaw : "lumpsum";
        const direction = pick(row, reverse.direction) || inferDirection(type);
        const amount = parseFloat(pick(row, reverse.amount)) || 0;
        const statusRaw = pick(row, reverse.status).toLowerCase().replace(/\s+/g, "_") || "successful";
        const status = VALID_STATUS.has(statusRaw) ? statusRaw : "successful";
        const sourceRaw = pick(row, reverse.sourceFeed).toLowerCase() || "import";
        const sourceFeed = VALID_SOURCES.has(sourceRaw) ? sourceRaw : "import";
        const orderDate = normaliseDate(pick(row, reverse.orderDate));

        try {
          const invRow = await tx.execute(sql`
            SELECT id FROM investors WHERE pan = ${pan} LIMIT 1
          `);
          const investor = (invRow.rows[0] as any) ?? null;
          if (!investor) {
            errors.push({ rowIndex: i, error: `no investor with PAN ${pan}` });
            continue;
          }

          await tx.execute(sql`
            INSERT INTO transactions (
              id, tenant_id, investor_id, folio_number, amc_code, scheme_code, scheme_name,
              type, direction, amount, units, nav, status, reason_code, order_date,
              source_feed, created_at, updated_at
            )
            VALUES (
              ${uuid()}, ${session.tenantId}, ${investor.id},
              ${pick(row, reverse.folioNumber) || null},
              ${pick(row, reverse.amcCode) || null},
              ${pick(row, reverse.schemeCode) || null},
              ${pick(row, reverse.schemeName) || null},
              ${type}, ${direction},
              ${amount},
              ${parseFloat(pick(row, reverse.units)) || null},
              ${parseFloat(pick(row, reverse.nav)) || null},
              ${status},
              ${pick(row, reverse.reasonCode) || null},
              ${orderDate}::date,
              ${sourceFeed},
              now(), now()
            )
          `);
          inserted++;
        } catch (err: any) {
          errors.push({ rowIndex: i, error: String(err.message ?? "insert failed") });
        }
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "transaction.bulk_import",
        entityType: "transaction",
        entityId: null,
        meta: { inserted, errored: errors.length, totalRows: parse.data.rows.length },
        ...clientMeta,
      });
    });

    return NextResponse.json({ inserted, skipped: 0, errored: errors.length, errors: errors.slice(0, 50) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
