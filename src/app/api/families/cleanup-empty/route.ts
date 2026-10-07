import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/families/cleanup-empty
 *
 * Delete every family that has NO client linked. Body: { dryRun?: boolean }.
 *
 * Deliberately narrower than the "no AUM" band the Families list hides: that
 * band also holds real households whose holdings simply are not loaded yet,
 * and deleting those would break up clients' family links. Here a family
 * qualifies only when not one non-deleted investor points at it — the same
 * rule the single-family DELETE enforces.
 *
 * Families have no soft-delete column, so this is a real delete. Each family
 * gets its own audit row carrying what was removed (the same `family.delete`
 * entry the single delete writes), and each runs in its own savepoint that
 * re-checks "still no clients" at delete time, so a client linked a moment ago
 * keeps its family, and a family some other record still references is kept
 * rather than failing the whole batch.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { familyScopeSql } from "@/lib/families/access";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const Body = z.object({ dryRun: z.boolean().optional() });

type Row = {
  id: string;
  head_name: string | null;
  family_name: string | null;
  family_code: string | null;
  rm_id: string | null;
  notes: string | null;
  created_at: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["family.delete", "investor.edit.all"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    // Someone who does not see the whole firm cleans up only their own families.
    const seesAll = can(session.roles, "investor.view.all", session.permissions);
    const meta = clientMetaFromHeaders(req.headers);
    const ctx = { userId: session.userId, branchId: session.branchId, roles: session.roles };

    const noClients = sql`NOT EXISTS (SELECT 1 FROM investors i WHERE i.family_id = f.id AND i.deleted_at IS NULL)`;
    const ownScope = seesAll ? sql`` : sql` AND f.rm_id = ${session.userId}::uuid`;
    // Plus the shared family data scope (branch / own book).
    const scopeIn = async (tx: any) => {
      const famScope = await familyScopeSql(tx, session, "f")
        .catch((e: any) => { if (e?.status === 403) return sql`TRUE`; throw e; });
      return sql`${ownScope} AND ${famScope}`;
    };

    if (parsed.data.dryRun) {
      const n = await withTenant(
        session.tenantId,
        async (tx) =>
          Number(
            ((await tx.execute(sql`
              SELECT COUNT(*)::int AS c FROM families f
               WHERE f.tenant_id = ${session.tenantId}::uuid AND ${noClients}${await scopeIn(tx)}
            `)).rows[0] as { c?: number } | undefined)?.c ?? 0
          ),
        ctx
      );
      return NextResponse.json({ dryRun: true, count: n });
    }

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const candidates = (await tx.execute(sql`
          SELECT f.id, f.head_name, f.family_name, f.family_code, f.rm_id, f.notes, f.created_at
            FROM families f
           WHERE f.tenant_id = ${session.tenantId}::uuid AND ${noClients}${await scopeIn(tx)}
        `)).rows as unknown as Row[];

        let deleted = 0;
        let kept = 0;
        for (const f of candidates) {
          try {
            const gone = await tx.transaction(async (sp) => {
              const r = await sp.execute(sql`
                DELETE FROM families f
                 WHERE f.id = ${f.id}::uuid AND f.tenant_id = ${session.tenantId}::uuid AND ${noClients}
                RETURNING f.id
              `);
              if (r.rows.length === 0) return false; // a client was linked meanwhile
              await recordAudit(sp, {
                tenantId: session.tenantId,
                actorUserId: session.userId,
                action: "family.delete",
                entityType: "family",
                entityId: f.id,
                before: {
                  headName: f.head_name,
                  familyName: f.family_name,
                  familyCode: f.family_code,
                  rmId: f.rm_id,
                  notes: f.notes,
                  createdAt: f.created_at,
                  reason: "cleanup: no clients linked",
                },
                ...meta,
              });
              return true;
            });
            if (gone) deleted++;
            else kept++;
          } catch {
            // Another table still references this family: keep it.
            kept++;
          }
        }
        return { deleted, kept };
      },
      ctx
    );

    return NextResponse.json({ dryRun: false, ...result });
  } catch (err: any) {
    return handleApiError(err);
  }
}
