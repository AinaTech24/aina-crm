/**
 * POST /api/investors/unmerge — undo a client merge.
 *
 * Body: { mergeId }. Sends every row recorded in `investor_merges.moved` back to
 * the loser, restores its status and cached figures, and recomputes the
 * survivor.
 *
 * This only works because the merge RECORDED what it moved. After a merge the
 * loser's rows are indistinguishable from the survivor's own, so an un-merge
 * that inferred them would send back the wrong holdings — quietly, and with no
 * way to tell afterwards. A merge whose move was too large to log is marked
 * `reversible = false` at merge time and is refused here rather than
 * half-undone.
 *
 * Owner / branch-head only, one transaction, audited.
 */

import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { recomputeInvestorAum } from "@/lib/finance/aum-persist";
import { recomputeInvestorHealth } from "@/lib/investors/health-persist";
import { allInMergeScope, MERGEABLE_FIELDS } from "@/lib/investors/merge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));

/** Table names we will write to, restricted to the shape Postgres identifiers
 *  actually take. The values come from our own merge log, but this is the query
 *  that interpolates a table name, so it validates rather than trusts. */
const SAFE_TABLE = /^[a-z_][a-z0-9_]{0,62}$/;

const Body = z.object({ mergeId: z.string().uuid() });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) {
      return NextResponse.json({ error: "only owners / branch heads can un-merge records" }, { status: 403 });
    }
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const { mergeId } = parse.data;
    const meta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const row = (await tx.execute(sql`
          SELECT id, survivor_id, loser_id, moved, reversible, reversed_at,
                 loser_aum, loser_sip_amount, loser_status, survivor_before
            FROM investor_merges
           WHERE id = ${mergeId}::uuid AND tenant_id = ${session.tenantId}::uuid
        `)).rows[0] as any;

        if (!row) return { error: "merge not found" as const };
        if (row.reversed_at) return { error: "this merge has already been undone" as const };
        if (!row.reversible) {
          return {
            error:
              "This merge moved too many rows to be logged individually, so it cannot be undone automatically. The records can be separated manually." as const,
          };
        }

        const survivorId = String(row.survivor_id);
        const loserId = String(row.loser_id);
        // Data scope: both records must be in the viewer's book (and branch).
        if (!(await allInMergeScope(tx, session, [survivorId, loserId]))) return { error: "merge not found" as const };
        const moved = (row.moved ?? {}) as Record<string, string[]>;

        let restored = 0;
        for (const [tbl, ids] of Object.entries(moved)) {
          if (!SAFE_TABLE.test(tbl) || !Array.isArray(ids) || ids.length === 0) continue;
          // Chunked: a single UPDATE ... IN (…) with tens of thousands of binds
          // exceeds the parameter limit.
          for (let i = 0; i < ids.length; i += 500) {
            const part = ids.slice(i, i + 500);
            // Guarded by `investor_id = survivor` so a row the operator has since
            // moved elsewhere on purpose is left where they put it.
            const r = await tx.execute(sql`
              UPDATE ${sql.raw(`"${tbl}"`)}
                 SET investor_id = ${loserId}::uuid
               WHERE investor_id = ${survivorId}::uuid
                 AND id IN (${sql.join(part.map((v) => sql`${v}::uuid`), sql`, `)})
            `);
            restored += (r as any).rowCount ?? 0;
          }
        }

        // Put the SURVIVOR's own details back. The merge fills the survivor's
        // blank fields from the loser and may overwrite one the operator picked,
        // so without this an "undone" merge leaves the surviving client carrying
        // the other person's email or mobile. Null for merges recorded before
        // survivor_before existed — those simply skip this step.
        // Older merges snapshot five fields, newer ones every reconciled field
        // (MERGEABLE_FIELDS); restore exactly the keys that were recorded.
        // jsonb_populate_record casts each value to its column's type.
        const before = (row.survivor_before ?? null) as Record<string, unknown> | null;
        const restore = before ? MERGEABLE_FIELDS.filter((f) => f in before) : [];
        if (before && restore.length) {
          const sets = restore.map((f) => {
            const col = sql.raw(`"${f}"`);
            return f === "name" ? sql`${col} = COALESCE(r.${col}, i.${col})` : sql`${col} = r.${col}`;
          });
          await tx.execute(sql`
            UPDATE investors i
               SET ${sql.join(sets, sql`, `)}, updated_at = now()
              FROM jsonb_populate_record(NULL::investors, ${JSON.stringify(before)}::jsonb) r
             WHERE i.id = ${survivorId}::uuid AND i.tenant_id = ${session.tenantId}::uuid
          `);
        }

        // Bring the loser back, with the figures it had before the merge.
        await tx.execute(sql`
          UPDATE investors
             SET merged_into_id = NULL, merged_at = NULL, merged_by_id = NULL,
                 merge_source = NULL, merge_reason = NULL,
                 status = COALESCE(${row.loser_status}, 'active'),
                 aum = ${Number(row.loser_aum ?? 0)},
                 active_sip_amount = ${Number(row.loser_sip_amount ?? 0)},
                 updated_at = now()
           WHERE id = ${loserId}::uuid AND tenant_id = ${session.tenantId}::uuid
        `);

        await tx.execute(sql`
          UPDATE investor_merges
             SET reversed_at = now(), reversed_by_id = ${session.userId}::uuid, updated_at = now()
           WHERE id = ${mergeId}::uuid
        `);

        // Both sides changed shape — reprice each from what it now holds. The
        // restored figures above are a floor, not the answer: they were correct
        // at merge time, and NAV has moved since.
        await recomputeInvestorAum(tx, survivorId);
        await recomputeInvestorAum(tx, loserId);
        await recomputeInvestorHealth(tx, survivorId);
        await recomputeInvestorHealth(tx, loserId);

        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "investor.unmerge",
          entityType: "investor",
          entityId: loserId,
          after: { mergeId, survivorId, loserId, restored } as any,
          reason: "Merge reversed",
          ...meta,
        } as any);

        return { ok: true as const, restored, survivorId, loserId };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  } catch (e) {
    return handleApiError(e);
  }
}
