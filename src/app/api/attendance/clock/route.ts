import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/attendance/clock  — self clock-in / clock-out.
 *
 * Body: { action: "in" | "out", employeeUserId? }
 *   in  → opens (or keeps) today's row, status=present, stamps clock_in_at.
 *   out → stamps clock_out_at + computes total_minutes from clock_in_at.
 *
 * Defaults to the current user; a manager may punch for another employee.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["in", "out"]),
  employeeUserId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { action } = parse.data;
    const employeeUserId = parse.data.employeeUserId ?? session.userId;
    const isManager = session.roles.some((r) => ["owner", "branch_head"].includes(r));
    if (employeeUserId !== session.userId && !isManager) {
      return NextResponse.json({ error: "only a manager can punch for another employee" }, { status: 403 });
    }

    const result = await withTenant(session.tenantId, async (tx) => {
      if (action === "in") {
        const r = await tx.execute(sql`
          INSERT INTO attendance (tenant_id, employee_user_id, attendance_date, status, clock_in_at, source)
          VALUES (${session.tenantId}::uuid, ${employeeUserId}::uuid, current_date, 'present', now(), 'clock')
          ON CONFLICT (tenant_id, employee_user_id, attendance_date) DO UPDATE SET
            clock_in_at = COALESCE(attendance.clock_in_at, EXCLUDED.clock_in_at),
            status = 'present',
            source = 'clock',
            updated_at = now()
          RETURNING clock_in_at, status, total_minutes, clock_out_at
        `);
        return { row: r.rows[0] };
      } else {
        const r = await tx.execute(sql`
          UPDATE attendance SET
            clock_out_at = now(),
            total_minutes = CASE WHEN clock_in_at IS NOT NULL
              THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (now() - clock_in_at)) / 60))::int
              ELSE total_minutes END,
            updated_at = now()
          WHERE tenant_id = ${session.tenantId}::uuid AND employee_user_id = ${employeeUserId}::uuid AND attendance_date = current_date
          RETURNING clock_in_at, status, total_minutes, clock_out_at
        `);
        if (!r.rows.length) return { error: "clock in first" };
        return { row: r.rows[0] };
      }
    });

    if ((result as any).error) return NextResponse.json({ error: (result as any).error }, { status: 400 });
    return NextResponse.json({ ok: true, ...(result as any).row });
  } catch (err: any) {
    return handleApiError(err);
  }
}
