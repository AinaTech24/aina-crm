import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/families/merge  — merge a duplicate family grouping into a survivor.
 *
 * Body: { survivorId, loserId }. Reassigns every child row referencing the
 * loser family (members, meetings, proposals…) to the survivor, then deletes
 * the now-empty loser grouping. Owner / branch-head only. Audited.
 *
 * Families are lightweight groupings (no portfolio of their own), so the loser
 * is hard-deleted once emptied rather than retired.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { recomputeFamilyHealth } from "@/lib/families/health-persist";
import { familyScopeSql } from "@/lib/families/access";
import { applyHeadRmToMembers } from "@/lib/families/head-rm";
import { applyFamilySharedDetails } from "@/lib/families/shared-details";

export const dynamic = "force-dynamic";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));
const DENYLIST = new Set(["families"]);

const Body = z.object({ survivorId: z.string().uuid(), loserId: z.string().uuid() });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) return NextResponse.json({ error: "only owners / branch heads can merge records" }, { status: 403 });
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const { survivorId, loserId } = parse.data;
    if (survivorId === loserId) return NextResponse.json({ error: "survivor and loser must differ" }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        // Data scope: both families must be visible to the viewer.
        const famScope = await familyScopeSql(tx, session, "f");
        const both = await tx.execute(sql`SELECT f.id FROM families f WHERE f.tenant_id = ${session.tenantId}::uuid AND f.id IN (${survivorId}::uuid, ${loserId}::uuid) AND ${famScope}`);
        if (both.rows.length !== 2) return { error: "one or both families not found" as const };

        // Who moves, and whether the survivor already has a head — for the RM
        // rule below (lib/families/head-rm).
        const moving = ((await tx.execute(sql`
          SELECT id FROM investors WHERE family_id = ${loserId}::uuid AND tenant_id = ${session.tenantId}::uuid`)).rows as Array<{ id: string }>).map((r) => r.id);
        const survivorHead = ((await tx.execute(sql`
          SELECT primary_investor_id FROM families WHERE id = ${survivorId}::uuid AND tenant_id = ${session.tenantId}::uuid`)).rows[0] as any)?.primary_investor_id ?? null;

        const tcols = await tx.execute(sql`
          SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'tenant_id'
        `);
        const hasTenant = new Set((tcols.rows as Array<{ table_name: string }>).map((r) => r.table_name));
        const tf = (table: string) =>
          hasTenant.has(table) ? sql` AND tenant_id = ${session.tenantId}::uuid` : sql``;

        const cols = await tx.execute(sql`
          SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'family_id'
        `);
        let reassigned = 0;
        const skipped: string[] = [];
        for (const row of cols.rows as Array<{ table_name: string }>) {
          const tbl = row.table_name;
          if (DENYLIST.has(tbl)) continue;
          // Per-table SAVEPOINT so a uniqueness collision skips that table
          // instead of aborting the whole family merge.
          await tx.execute(sql`SAVEPOINT merge_child`);
          try {
            const r = await tx.execute(
              sql`UPDATE ${sql.raw(`"${tbl}"`)} SET family_id = ${survivorId}::uuid WHERE family_id = ${loserId}::uuid${tf(tbl)}`
            );
            reassigned += (r as any).rowCount ?? 0;
            await tx.execute(sql`RELEASE SAVEPOINT merge_child`);
          } catch {
            await tx.execute(sql`ROLLBACK TO SAVEPOINT merge_child`);
            skipped.push(tbl);
          }
        }
        // Survivor adopts the loser's primary if it lacks one (tenant-scoped).
        await tx.execute(sql`
          UPDATE families s SET primary_investor_id = COALESCE(s.primary_investor_id, l.primary_investor_id), updated_at = now()
          FROM families l WHERE s.id = ${survivorId}::uuid AND l.id = ${loserId}::uuid AND s.tenant_id = ${session.tenantId}::uuid
        `);
        await tx.execute(sql`DELETE FROM families WHERE id = ${loserId}::uuid AND tenant_id = ${session.tenantId}::uuid`);

        // RM follows the head: the members who moved take the survivor head's
        // RM; if the survivor had no head and just adopted the loser's, every
        // member follows that new head.
        await applyHeadRmToMembers(tx, {
          tenantId: session.tenantId,
          familyId: survivorId,
          onlyInvestorIds: survivorHead ? moving : undefined,
          actorUserId: session.userId,
          reason: survivorHead ? "families_merged" : "head_changed",
          clientMeta: meta,
        });
        // …and the head's address and the family's review frequency.
        await applyFamilySharedDetails(tx, {
          tenantId: session.tenantId,
          familyId: survivorId,
          onlyInvestorIds: survivorHead ? moving : undefined,
          actorUserId: session.userId,
          reason: survivorHead ? "families_merged" : "head_changed",
          clientMeta: meta,
        });

        // The survivor just absorbed the loser's members — re-score it so its
        // health band, member count and AUM rollup reflect the merged household
        // (otherwise they stay stale until the next unrelated edit).
        await recomputeFamilyHealth(tx, survivorId);

        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "family.merge",
          entityType: "family",
          entityId: survivorId,
          after: { survivorId, loserId, childRowsReassigned: reassigned, skippedTables: skipped } as any,
          ...meta,
        });
        return { ok: true as const, reassigned, skipped };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const errMsg = "error" in result ? result.error : null;
    if (errMsg) return NextResponse.json({ error: errMsg }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
