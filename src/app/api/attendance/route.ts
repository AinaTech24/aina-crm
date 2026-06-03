import { handleApiError } from "@/lib/api/error-handler";
/**
 * Attendance — manager upsert.
 *
 *   GET   /api/attendance   — list (RLS-scoped)
 *   POST  /api/attendance   — upsert a row by (employee, date): set status/note.
 *                             Managers only (owner / branch_head).
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { ATTENDANCE_STATUSES } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  employeeUserId: z.string().uuid(),
  date: z.string(), // YYYY-MM-DD
  status: z.enum(ATTENDANCE_STATUSES),
  note: z.string().max(500).optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT a.*, u.name AS employee_name
        FROM attendance a LEFT JOIN users u ON u.id = a.employee_user_id
        WHERE a.tenant_id = ${session.tenantId}::uuid
        ORDER BY a.attendance_date DESC LIMIT 500
      `);
      return r.rows;
    });
    return NextResponse.json({ attendance: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session.roles.some((r) => ["owner", "branch_head"].includes(r))) {
      return NextResponse.json({ error: "only a manager can mark attendance" }, { status: 403 });
    }
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const { employeeUserId, status, note } = parse.data;
    const date = parse.data.date.slice(0, 10);
    const clientMeta = clientMetaFromHeaders(req.headers);

    await withTenant(session.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO attendance (tenant_id, employee_user_id, attendance_date, status, note, source)
        VALUES (${session.tenantId}::uuid, ${employeeUserId}::uuid, ${date}::date, ${status}, ${note ?? null}, 'manual')
        ON CONFLICT (tenant_id, employee_user_id, attendance_date) DO UPDATE SET
          status = EXCLUDED.status,
          note = COALESCE(EXCLUDED.note, attendance.note),
          updated_at = now()
      `);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "attendance.mark",
        entityType: "attendance",
        entityId: session.tenantId,
        after: { employeeUserId, date, status } as any,
        ...clientMeta,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
