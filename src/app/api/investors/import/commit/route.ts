/**
 * POST /api/investors/import/commit
 * Body: { mapping: Record<sourceHeader, ourField>, rows: object[] }
 *
 * Inserts the parsed rows as investors, deduping by (tenant_id, PAN).
 * Returns counts: inserted / skipped / errored, with per-row errors.
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

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "investor.edit.all");
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const { mapping, rows } = parse.data;

    // Build the reverse map: ourField -> sourceHeader
    const reverse: Record<string, string> = {};
    for (const [src, our] of Object.entries(mapping)) {
      if (our) reverse[our] = src;
    }
    if (!reverse.name || !reverse.pan) {
      return NextResponse.json({ error: "mapping must cover at least name + pan" }, { status: 400 });
    }

    let inserted = 0;
    let skipped = 0;
    const errors: Array<{ rowIndex: number; error: string }> = [];

    await withTenant(session.tenantId, async (tx) => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = String(row[reverse.name] ?? "").trim();
        const pan = String(row[reverse.pan] ?? "").trim().toUpperCase();

        if (!name || !pan) {
          errors.push({ rowIndex: i, error: "missing name or pan" });
          continue;
        }
        if (!PAN_RE.test(pan)) {
          errors.push({ rowIndex: i, error: `invalid PAN: ${pan}` });
          continue;
        }

        const email = pick(row, reverse.email);
        const phone = pick(row, reverse.phone);
        const whatsapp = pick(row, reverse.whatsappPhone) || phone;
        const dob = pick(row, reverse.dob);
        const segment = pick(row, reverse.segmentTag);
        const category = pick(row, reverse.investorCategory) || "individual";
        const city = pick(row, reverse.city);
        const state = pick(row, reverse.state);
        const pincode = pick(row, reverse.pincode);

        try {
          const r = await tx.execute(sql`
            INSERT INTO investors (
              id, tenant_id, branch_id, name, pan, email, phone, whatsapp_phone,
              dob, segment_tag, investor_category, address, rm_id, status, onboarded_at,
              created_at, updated_at
            )
            VALUES (
              ${uuid()}, ${session.tenantId}, ${session.branchId ?? null},
              ${name}, ${pan}, ${email || null}, ${phone || null}, ${whatsapp || null},
              ${dob ? new Date(dob) : null}, ${segment || null}, ${category},
              ${JSON.stringify({ city, state, pincode, country: "India" })}::jsonb,
              ${session.userId}, 'active', now(),
              now(), now()
            )
            ON CONFLICT (tenant_id, pan) DO NOTHING
            RETURNING id
          `);
          if ((r as any).rows.length > 0) inserted++;
          else skipped++;
        } catch (err: any) {
          errors.push({ rowIndex: i, error: String(err.message ?? "insert failed") });
        }
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.bulk_import",
        entityType: "investor",
        entityId: null,
        meta: { inserted, skipped, errored: errors.length, totalRows: rows.length },
        ...clientMeta,
      });
    });

    return NextResponse.json({ inserted, skipped, errored: errors.length, errors: errors.slice(0, 50) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}

function pick(row: Record<string, any>, header: string | undefined): string {
  if (!header) return "";
  const v = row[header];
  if (v === null || v === undefined) return "";
  return String(v).trim();
}
