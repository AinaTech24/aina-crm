import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/attendance/clock  — self clock-in / clock-out, as often as needed.
 *
 * Body: { action: "in" | "out", employeeUserId?, lat?, lng? }
 *   in  → logs a punch; the day's row becomes present, keeps its FIRST clock-in,
 *         and its clock-out clears while the person is back in.
 *   out → logs a punch; the row's clock-out is this LAST clock-out and
 *         total_minutes is the sum of every in → out session of the day.
 *
 * Every punch is kept in attendance_punches (migration 0230) — the log the
 * attendance page shows. `attendance` stays the one-row-per-day summary that
 * reports, the monthly grid and the payroll export read.
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
  /** Optional geolocation captured by the browser at punch time. */
  lat: z.number().optional(),
  lng: z.number().optional(),
});

type Punch = { kind: "in" | "out"; at: string };

/** Minutes worked across the day's in → out sessions (an open session counts nothing yet). */
function workedMinutes(punches: Punch[]): number {
  let total = 0;
  let openAt: number | null = null;
  for (const p of punches) {
    const t = new Date(p.at).getTime();
    if (p.kind === "in") openAt ??= t;
    else if (openAt != null) {
      total += Math.max(0, t - openAt);
      openAt = null;
    }
  }
  return Math.round(total / 60000);
}

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
    const lat = parse.data.lat ?? null;
    const lng = parse.data.lng ?? null;
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
    const recordedBy = employeeUserId === session.userId ? null : session.userId;

    const result = await withTenant(session.tenantId, async (tx) => {
      // One punch at a time per person per day: a double click must not log twice.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`attendance:${session.tenantId}:${employeeUserId}`}), hashtext(current_date::text))`);

      const load = async () =>
        (await tx.execute(sql`
          SELECT kind, at FROM attendance_punches
          WHERE tenant_id = ${session.tenantId}::uuid AND employee_user_id = ${employeeUserId}::uuid AND attendance_date = current_date
          ORDER BY at, created_at
        `)).rows as Punch[];
      let punches = await load();

      // A day punched before the log existed: carry its single in / out into the log first.
      if (!punches.length) {
        const legacy = (await tx.execute(sql`
          SELECT clock_in_at, clock_out_at FROM attendance
          WHERE tenant_id = ${session.tenantId}::uuid AND employee_user_id = ${employeeUserId}::uuid AND attendance_date = current_date
        `)).rows[0] as { clock_in_at: string | null; clock_out_at: string | null } | undefined;
        if (legacy?.clock_in_at) {
          await tx.execute(sql`
            INSERT INTO attendance_punches (tenant_id, employee_user_id, attendance_date, kind, at)
            VALUES (${session.tenantId}::uuid, ${employeeUserId}::uuid, current_date, 'in', ${legacy.clock_in_at}::timestamptz)
          `);
          if (legacy.clock_out_at) {
            await tx.execute(sql`
              INSERT INTO attendance_punches (tenant_id, employee_user_id, attendance_date, kind, at)
              VALUES (${session.tenantId}::uuid, ${employeeUserId}::uuid, current_date, 'out', ${legacy.clock_out_at}::timestamptz)
            `);
          }
          punches = await load();
        }
      }

      const clockedIn = punches.length > 0 && punches[punches.length - 1].kind === "in";
      if (action === "in" && clockedIn) return { error: "You're already clocked in." };
      if (action === "out" && !clockedIn) return { error: "Clock in first." };

      await tx.execute(sql`
        INSERT INTO attendance_punches (tenant_id, employee_user_id, attendance_date, kind, lat, lng, ip, recorded_by)
        VALUES (${session.tenantId}::uuid, ${employeeUserId}::uuid, current_date, ${action}, ${lat}, ${lng}, ${ip}, ${recordedBy})
      `);
      punches = await load();
      const total = workedMinutes(punches);

      if (action === "in") {
        await tx.execute(sql`
          INSERT INTO attendance (tenant_id, employee_user_id, attendance_date, status, clock_in_at, clock_in_lat, clock_in_lng, clock_in_ip, source)
          VALUES (${session.tenantId}::uuid, ${employeeUserId}::uuid, current_date, 'present', now(), ${lat}, ${lng}, ${ip}, 'clock')
          ON CONFLICT (tenant_id, employee_user_id, attendance_date) DO UPDATE SET
            clock_in_at = COALESCE(attendance.clock_in_at, EXCLUDED.clock_in_at),
            clock_in_lat = COALESCE(attendance.clock_in_lat, EXCLUDED.clock_in_lat),
            clock_in_lng = COALESCE(attendance.clock_in_lng, EXCLUDED.clock_in_lng),
            clock_in_ip = COALESCE(attendance.clock_in_ip, EXCLUDED.clock_in_ip),
            -- Back in: no clock-out until they clock out again.
            clock_out_at = NULL,
            status = 'present',
            source = 'clock',
            updated_at = now()
        `);
      } else {
        await tx.execute(sql`
          UPDATE attendance SET
            clock_out_at = now(),
            clock_out_lat = ${lat},
            clock_out_lng = ${lng},
            clock_out_ip = ${ip},
            total_minutes = ${total},
            updated_at = now()
          WHERE tenant_id = ${session.tenantId}::uuid AND employee_user_id = ${employeeUserId}::uuid AND attendance_date = current_date
        `);
      }

      const row = (await tx.execute(sql`
        SELECT clock_in_at, clock_out_at, total_minutes, status FROM attendance
        WHERE tenant_id = ${session.tenantId}::uuid AND employee_user_id = ${employeeUserId}::uuid AND attendance_date = current_date
      `)).rows[0];
      return { row: { ...(row as object), punches } };
    });

    if ((result as any).error) return NextResponse.json({ error: (result as any).error }, { status: 400 });
    return NextResponse.json({ ok: true, ...(result as any).row });
  } catch (err: any) {
    return handleApiError(err);
  }
}
