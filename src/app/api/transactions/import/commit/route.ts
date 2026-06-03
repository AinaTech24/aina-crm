import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/transactions/import/commit
 *
 * Resolves each row's PAN → investor_id (within this tenant). Rows with no PAN
 * match get errored. Maps transaction type/direction/status to enum values.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import crypto from "node:crypto";
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

const VALID_TYPES = new Set([
  "purchase",
  "lumpsum",
  "sip",
  "sip_stop",
  "sip_pause",
  "stp",
  "swp",
  "redemption",
  "switch",
  "dividend_payout",
  "dividend_reinvest",
]);
const VALID_STATUS = new Set([
  "pending",
  "processed",
  "submitted",
  "successful",
  "rejected",
  "failed",
  "cancelled",
]);
const VALID_SOURCES = new Set([
  "bse",
  "nse",
  "cams",
  "kfintech",
  "mfu",
  "other",
  "manual",
  "import",
]);

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

/** Map any legacy/free-text status onto the canonical Module-9 set. Defaults to
 *  `processed` (an imported row is a settled transaction unless flagged). */
const STATUS_MAP: Record<string, string> = { successful: "processed", failed: "rejected", submitted: "pending" };
const CANON_STATUS = new Set(["pending", "processed", "rejected", "cancelled"]);
function normaliseStatus(raw: string): string {
  const s = raw.toLowerCase().replace(/\s+/g, "_");
  const mapped = STATUS_MAP[s] ?? s;
  return CANON_STATUS.has(mapped) ? mapped : "processed";
}

/** Import idempotency key: the real order id when present, else a deterministic
 *  hash of the natural transaction key — so re-importing the same file is a
 *  no-op (ON CONFLICT) instead of duplicating the row. */
function dedupKeyFor(orderId: string, natural: Array<string | number | null>): string {
  if (orderId) return orderId.slice(0, 200);
  const h = crypto.createHash("sha256").update(natural.map((p) => String(p ?? "")).join("|")).digest("hex");
  return `nk:${h.slice(0, 40)}`;
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
    let skipped = 0; // duplicate rows already present (idempotent re-import)
    const errors: Array<{ rowIndex: number; error: string }> = [];
    // Highest processed order_date per investor → bump last_transaction_at so
    // dormancy / health / churn signals reflect the freshly-imported activity.
    const lastTxByInvestor = new Map<string, string>();

    await withTenant(session.tenantId, async (tx) => {
      for (let i = 0; i < parse.data.rows.length; i++) {
        const row = parse.data.rows[i];
        const pan = pick(row, reverse.pan).toUpperCase();
        const typeRaw = pick(row, reverse.type).toLowerCase().replace(/\s+/g, "_");
        const type = VALID_TYPES.has(typeRaw) ? typeRaw : "lumpsum";
        const direction = pick(row, reverse.direction) || inferDirection(type);
        const amount = parseFloat(pick(row, reverse.amount)) || 0;
        const units = parseFloat(pick(row, reverse.units)) || null;
        const status = normaliseStatus(pick(row, reverse.status));
        const sourceRaw = pick(row, reverse.sourceFeed).toLowerCase() || "import";
        const sourceFeed = VALID_SOURCES.has(sourceRaw) ? sourceRaw : "import";
        const orderDate = normaliseDate(pick(row, reverse.orderDate));
        const schemeCode = pick(row, reverse.schemeCode) || null;
        const schemeName = pick(row, reverse.schemeName) || null;
        const folioNumber = pick(row, reverse.folioNumber) || null;
        const orderId = pick(row, (reverse as any).orderId);

        try {
          const invRow = await tx.execute(sql`
            SELECT id FROM investors WHERE tenant_id = ${session.tenantId} AND pan = ${pan} LIMIT 1
          `);
          const investor = (invRow.rows[0] as any) ?? null;
          if (!investor) {
            errors.push({ rowIndex: i, error: `no investor with PAN ${pan}` });
            continue;
          }

          const dedupKey = dedupKeyFor(orderId, [
            investor.id, schemeCode ?? schemeName, orderDate, type, amount, units, direction,
          ]);

          const r = await tx.execute(sql`
            INSERT INTO transactions (
              id, tenant_id, investor_id, folio_number, amc_code, scheme_code, scheme_name,
              type, direction, amount, units, nav, status, reason_code, order_date,
              order_id, dedup_key, source_feed, created_at, updated_at
            )
            VALUES (
              ${uuid()}, ${session.tenantId}, ${investor.id},
              ${folioNumber},
              ${pick(row, reverse.amcCode) || null},
              ${schemeCode},
              ${schemeName},
              ${type}, ${direction},
              ${amount},
              ${units},
              ${parseFloat(pick(row, reverse.nav)) || null},
              ${status},
              ${pick(row, reverse.reasonCode) || null},
              ${orderDate}::date,
              ${orderId || null},
              ${dedupKey},
              ${sourceFeed},
              now(), now()
            )
            ON CONFLICT (tenant_id, dedup_key) DO NOTHING
            RETURNING id
          `);

          if ((r as any).rows.length > 0) {
            inserted++;
            if (status === "processed") {
              const prev = lastTxByInvestor.get(investor.id);
              if (!prev || orderDate > prev) lastTxByInvestor.set(investor.id, orderDate);
            }
          } else {
            skipped++; // already imported — idempotent
          }
        } catch (err: any) {
          errors.push({ rowIndex: i, error: String(err.message ?? "insert failed") });
        }
      }

      // Bump last_transaction_at for each affected investor (only forward).
      for (const [investorId, maxDate] of lastTxByInvestor) {
        await tx.execute(sql`
          UPDATE investors
             SET last_transaction_at = GREATEST(COALESCE(last_transaction_at, 'epoch'::timestamptz), ${maxDate}::timestamptz),
                 updated_at = now()
           WHERE id = ${investorId}::uuid
        `);
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "transaction.bulk_import",
        entityType: "transaction",
        entityId: null,
        meta: { inserted, skipped, errored: errors.length, totalRows: parse.data.rows.length },
        ...clientMeta,
      });
    });

    return NextResponse.json({ inserted, skipped, errored: errors.length, errors: errors.slice(0, 50) });
  } catch (err: any) {
    return handleApiError(err);
  }
}
