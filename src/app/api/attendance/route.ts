import { handleApiError } from "@/lib/api/error-handler";
/**
 * Attendance — manager upsert.
 *
 *   GET   /api/attendance   — list (RLS-scoped)
 *   POST  /api/attendance   — upsert a row by (employee, date): set status/note.
 *                             Managers only (owner / branch_head). A manager's
 *                             correction needs a reason; the audit row keeps
 *                             the before and after values with it.
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
  // Manager-edited clock times (ISO). When set, the row's times + worked
  // minutes are corrected (e.g. fixing a missed punch).
  clockInAt: z.string().optional(),
  clockOutAt: z.string().optional(),
  /** Why the record is being corrected — required, kept in the audit trail. */
  reason: z.string().trim().min(3, "Say why you are correcting this record").max(300),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const url = new URL(req.url);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    const rows = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT a.*, u.name AS employee_name
        FROM attendance a LEFT JOIN users u ON u.id = a.employee_user_id
        WHERE a.tenant_id = ${session.tenantId}::uuid
        ORDER BY a.attendance_date DESC LIMIT ${limit} OFFSET ${offset}
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
    const clockInIso = parse.data.clockInAt ? new Date(parse.data.clockInAt).toISOString() : null;
    const clockOutIso = parse.data.clockOutAt ? new Date(parse.data.clockOutAt).toISOString() : null;
    const totalMin =
      clockInIso && clockOutIso
        ? Math.max(0, Math.round((new Date(clockOutIso).getTime() - new Date(clockInIso).getTime()) / 60000))
        : null;
    const clientMeta = clientMetaFromHeaders(req.headers);

    await withTenant(session.tenantId, async (tx) => {
      const beforeRow = (await tx.execute(sql`
        SELECT status, clock_in_at, clock_out_at, total_minutes, note, source FROM attendance
         WHERE tenant_id = ${session.tenantId}::uuid AND employee_user_id = ${employeeUserId}::uuid AND attendance_date = ${date}::date
         LIMIT 1
      `)).rows[0] ?? null;
      await tx.execute(sql`
        INSERT INTO attendance (tenant_id, employee_user_id, attendance_date, status, note, clock_in_at, clock_out_at, total_minutes, source)
        VALUES (${session.tenantId}::uuid, ${employeeUserId}::uuid, ${date}::date, ${status}, ${note ?? null},
                ${clockInIso}::timestamptz, ${clockOutIso}::timestamptz, ${totalMin}, 'manual')
        ON CONFLICT (tenant_id, employee_user_id, attendance_date) DO UPDATE SET
          status = EXCLUDED.status,
          source = 'manual',
          note = COALESCE(EXCLUDED.note, attendance.note),
          clock_in_at = COALESCE(EXCLUDED.clock_in_at, attendance.clock_in_at),
          clock_out_at = COALESCE(EXCLUDED.clock_out_at, attendance.clock_out_at),
          total_minutes = CASE
            WHEN COALESCE(EXCLUDED.clock_in_at, attendance.clock_in_at) IS NOT NULL
             AND COALESCE(EXCLUDED.clock_out_at, attendance.clock_out_at) IS NOT NULL
            THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (
                 COALESCE(EXCLUDED.clock_out_at, attendance.clock_out_at) - COALESCE(EXCLUDED.clock_in_at, attendance.clock_in_at)
               )) / 60))::int
            ELSE attendance.total_minutes END,
          updated_at = now()
      `);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "attendance.correct",
        entityType: "attendance",
        entityId: session.tenantId,
        before: beforeRow ? { employeeUserId, date, ...beforeRow } : null,
        after: { employeeUserId, date, status, clockInIso, clockOutIso, reason: parse.data.reason },
        reason: parse.data.reason,
        ...clientMeta,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
