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
        const both = await tx.execute(sql`SELECT id FROM families WHERE tenant_id = ${session.tenantId}::uuid AND id IN (${survivorId}::uuid, ${loserId}::uuid)`);
        if (both.rows.length !== 2) return { error: "one or both families not found" as const };

        const cols = await tx.execute(sql`
          SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'family_id'
        `);
        let reassigned = 0;
        for (const row of cols.rows as Array<{ table_name: string }>) {
          if (DENYLIST.has(row.table_name)) continue;
          const r = await tx.execute(sql`UPDATE ${sql.raw(`"${row.table_name}"`)} SET family_id = ${survivorId}::uuid WHERE family_id = ${loserId}::uuid`);
          reassigned += (r as any).rowCount ?? 0;
        }
        // Survivor adopts the loser's primary if it lacks one.
        await tx.execute(sql`
          UPDATE families s SET primary_investor_id = COALESCE(s.primary_investor_id, l.primary_investor_id), updated_at = now()
          FROM families l WHERE s.id = ${survivorId}::uuid AND l.id = ${loserId}::uuid
        `);
        await tx.execute(sql`DELETE FROM families WHERE id = ${loserId}::uuid`);

        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "family.merge",
          entityType: "family",
          entityId: survivorId,
          after: { survivorId, loserId, childRowsReassigned: reassigned } as any,
          ...meta,
        });
        return { ok: true as const, reassigned };
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
