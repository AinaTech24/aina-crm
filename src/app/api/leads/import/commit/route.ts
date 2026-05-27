/**
 * POST /api/leads/import/commit  Body: { mapping, rows }
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

const VALID_STAGES = new Set(["new", "contacted", "qualified", "proposal_sent", "converted", "lost", "cold"]);
const VALID_SOURCES = new Set([
  "website", "referral", "meta_ads", "google_ads", "linkedin", "youtube",
  "webinar", "event", "walk_in", "manual", "other",
]);

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "lead.edit.all");
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const reverse: Record<string, string> = {};
    for (const [src, our] of Object.entries(parse.data.mapping)) if (our) reverse[our] = src;
    if (!reverse.name) return NextResponse.json({ error: "mapping must include name" }, { status: 400 });

    function pick(row: any, h?: string) {
      if (!h) return "";
      const v = row[h];
      return v === null || v === undefined ? "" : String(v).trim();
    }

    let inserted = 0;
    let skipped = 0;
    const errors: Array<{ rowIndex: number; error: string }> = [];

    await withTenant(session.tenantId, async (tx) => {
      for (let i = 0; i < parse.data.rows.length; i++) {
        const row = parse.data.rows[i];
        const name = pick(row, reverse.name);
        if (!name) {
          errors.push({ rowIndex: i, error: "missing name" });
          continue;
        }
        const sourceRaw = pick(row, reverse.source).toLowerCase().replace(/\s+/g, "_");
        const source = VALID_SOURCES.has(sourceRaw) ? sourceRaw : "manual";
        const stageRaw = pick(row, reverse.stage).toLowerCase().replace(/\s+/g, "_");
        const stage = VALID_STAGES.has(stageRaw) ? stageRaw : "new";

        try {
          await tx.execute(sql`
            INSERT INTO leads (
              id, tenant_id, branch_id, name, email, phone, city,
              source, source_campaign, stage, stage_changed_at, score, intended_amount,
              owner_id, notes, created_at, updated_at
            )
            VALUES (
              ${uuid()}, ${session.tenantId}, ${session.branchId ?? null},
              ${name},
              ${pick(row, reverse.email) || null},
              ${pick(row, reverse.phone) || null},
              ${pick(row, reverse.city) || null},
              ${source}, ${pick(row, reverse.campaignName) || null},
              ${stage}, now(),
              ${pick(row, reverse.score) || "0"},
              ${pick(row, reverse.intendedAmount) || null},
              ${session.userId},
              ${pick(row, reverse.notes) || null},
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
        action: "lead.bulk_import",
        entityType: "lead",
        entityId: null,
        meta: { inserted, skipped, errored: errors.length, totalRows: parse.data.rows.length },
        ...clientMeta,
      });
    });

    return NextResponse.json({ inserted, skipped, errored: errors.length, errors: errors.slice(0, 50) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
