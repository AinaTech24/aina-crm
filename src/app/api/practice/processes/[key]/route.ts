import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH /api/practice/processes/[key] — a core process's per-firm settings.
 *   Body { ownerPositionId?: uuid | null, notes?: string | null }
 *   Upserts practice_process_settings for (tenant, key). The key must be one of
 *   PRACTICE_PROCESSES; the position must belong to the firm.
 *
 * Gate: the practice managers (canManagePractice) AND `settings.users`.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit } from "@/lib/audit";
import { canManagePractice } from "@/lib/practice/access";
import { PROCESS_BY_KEY } from "@/lib/practice/catalog";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    ownerPositionId: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((b) => b.ownerPositionId !== undefined || b.notes !== undefined, { message: "nothing to change" });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    if (!canManagePractice(session)) return NextResponse.json({ error: "Only the owner can change the practice system." }, { status: 403 });
    await assertActiveLicense(session.tenantId, session.roles);

    const process = PROCESS_BY_KEY.get(key);
    if (!process) return NextResponse.json({ error: "unknown process" }, { status: 404 });

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: parse.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
    }
    const b = parse.data;

    const result = await withTenant(session.tenantId, async (tx) => {
      if (b.ownerPositionId) {
        const pos = (await tx.execute(sql`
          SELECT id FROM practice_positions WHERE tenant_id = ${session.tenantId}::uuid AND id = ${b.ownerPositionId}::uuid
        `)).rows[0];
        if (!pos) return { error: "position not found" as const };
      }

      const before = (await tx.execute(sql`
        SELECT owner_position_id, notes FROM practice_process_settings
         WHERE tenant_id = ${session.tenantId}::uuid AND process_key = ${key}
      `)).rows[0] as { owner_position_id: string | null; notes: string | null } | undefined;

      const owner = b.ownerPositionId !== undefined ? b.ownerPositionId : before?.owner_position_id ?? null;
      const notes = b.notes !== undefined ? (b.notes || null) : before?.notes ?? null;

      const row = (await tx.execute(sql`
        INSERT INTO practice_process_settings (tenant_id, process_key, owner_position_id, notes, updated_at)
        VALUES (${session.tenantId}::uuid, ${key}, ${owner}::uuid, ${notes}, now())
        ON CONFLICT (tenant_id, process_key)
        DO UPDATE SET owner_position_id = EXCLUDED.owner_position_id, notes = EXCLUDED.notes, updated_at = now()
        RETURNING id, process_key, owner_position_id, notes
      `)).rows[0] as { id: string; process_key: string; owner_position_id: string | null; notes: string | null };

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "practice.process.update",
        entityType: "practice_process_settings",
        entityId: row.id,
        before: before ? { ownerPositionId: before.owner_position_id, notes: before.notes } : null,
        after: { processKey: key, ownerPositionId: row.owner_position_id, notes: row.notes },
      });
      return { row };
    }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({
      process: { key: result.row.process_key, ownerPositionId: result.row.owner_position_id, notes: result.row.notes },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
