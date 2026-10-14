/**
 * Evening "close your day" nudge — 6:30 pm IST, one in-app + push notification
 * per working user that opens the Daily Job Tracker. The rules (who, what it
 * says) are pure in lib/habits/day-close.ts; this file only gathers counts.
 *
 * Mechanics mirror the morning briefing (daily-briefing.ts):
 *   · 15-minute tick that only acts inside the 18:30–19:59 IST window.
 *   · Per-user dedupe on a `day.close` notification created today (IST), so
 *     the cadence is idempotent — exactly one nudge per day.
 *   · withSystem lists active tenants; every read/write is inside withTenant.
 *   · Push goes out through the normal mobile-alert path (createNotification
 *     marks it pending; the task-reminder scanner delivers it).
 */

import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { createNotification } from "@/lib/notifications/create";
import { captureError } from "@/lib/observability/capture";
import {
  DAY_CLOSE_KIND,
  DAY_CLOSE_LINK,
  dayCloseBody,
  dayCloseTitle,
  inDayCloseWindow,
  shouldPromptDayClose,
  type DayCloseCounts,
} from "@/lib/habits/day-close";

const MAX_USERS_PER_TENANT = 200;

async function listActiveTenants(): Promise<string[]> {
  return await withSystem(async (tx) => {
    const r = await tx.execute(sql`SELECT id FROM tenants WHERE status IN ('active', 'trial')`);
    return (r.rows as Array<{ id: string }>).map((row) => row.id);
  });
}

type Row = {
  id: string;
  done: number;
  open_today: number;
  touches: number;
  focus_total: number;
  focus_done: number;
  closed_already: boolean;
  on_leave: boolean;
};

/** One tenant, one IST day. Exported for a manual run (and tests); idempotent. */
export async function promptTenant(tenantId: string, istDate: string): Promise<{ sent: number; skipped: number }> {
  let sent = 0;
  let skipped = 0;
  await withTenant(
    tenantId,
    async (tx) => {
      // Same audience as the morning briefing. One query gathers every count;
      // "today" is the IST calendar day throughout.
      const r = await tx.execute(sql`
        WITH d AS (SELECT ${istDate}::date AS day)
        SELECT u.id,
          (SELECT count(*)::int FROM tasks t
            WHERE t.tenant_id = u.tenant_id AND t.assignee_id = u.id AND t.deleted_at IS NULL
              AND t.status = 'completed'
              AND (t.completed_at AT TIME ZONE 'Asia/Kolkata')::date = d.day) AS done,
          (SELECT count(*)::int FROM tasks t
            WHERE t.tenant_id = u.tenant_id AND t.assignee_id = u.id AND t.deleted_at IS NULL
              AND t.status IN ('open', 'in_progress', 'blocked')
              AND (t.due_at AT TIME ZONE 'Asia/Kolkata')::date = d.day) AS open_today,
          (SELECT count(*)::int FROM activities a
            WHERE a.tenant_id = u.tenant_id AND a.owner_user_id = u.id AND a.kind <> 'note'
              AND (a.occurred_at AT TIME ZONE 'Asia/Kolkata')::date = d.day) AS touches,
          COALESCE(jsonb_array_length(dt.today_focus), 0)::int AS focus_total,
          COALESCE((SELECT count(*)::int FROM jsonb_array_elements(dt.today_focus) f
                     WHERE (f->>'done')::boolean IS TRUE), 0) AS focus_done,
          COALESCE(dt.updated_at >= (d.day + time '17:00') AT TIME ZONE 'Asia/Kolkata', false) AS closed_already,
          EXISTS (SELECT 1 FROM leave_applications la
                   WHERE la.tenant_id = u.tenant_id AND la.employee_user_id = u.id
                     AND la.status = 'approved' AND d.day BETWEEN la.from_date AND la.to_date) AS on_leave
        FROM users u
        CROSS JOIN d
        LEFT JOIN daily_trackers dt
          ON dt.tenant_id = u.tenant_id AND dt.user_id = u.id AND dt.tracker_date = d.day
        WHERE u.tenant_id = ${tenantId}::uuid
          AND u.status = 'active'
          AND u.roles && ARRAY['owner','branch_head','rm']::text[]
          AND NOT EXISTS (
            SELECT 1 FROM notifications n
             WHERE n.tenant_id = u.tenant_id AND n.user_id = u.id AND n.kind = ${DAY_CLOSE_KIND}
               AND (n.created_at AT TIME ZONE 'Asia/Kolkata')::date = d.day)
        ORDER BY u.name
        LIMIT ${MAX_USERS_PER_TENANT}
      `);

      for (const row of r.rows as Row[]) {
        const c: DayCloseCounts = {
          done: Number(row.done) || 0,
          openToday: Number(row.open_today) || 0,
          touches: Number(row.touches) || 0,
          focusTotal: Number(row.focus_total) || 0,
          focusDone: Number(row.focus_done) || 0,
          closedAlready: !!row.closed_already,
          onLeave: !!row.on_leave,
        };
        if (!shouldPromptDayClose(c)) {
          skipped++;
          continue;
        }
        await createNotification(tx, {
          tenantId,
          userId: String(row.id),
          kind: DAY_CLOSE_KIND,
          title: dayCloseTitle(c),
          body: dayCloseBody(c),
          linkUrl: DAY_CLOSE_LINK,
          severity: "info",
          meta: { date: istDate, ...c },
        });
        sent++;
      }
    },
    { roles: ["system"] }
  );
  return { sent, skipped };
}

export function startDayClosePromptWorker(): () => void {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // IST "now" — shift the epoch by +5:30 and read the UTC getters as IST.
      const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
      if (!inDayCloseWindow(istNow.getUTCHours(), istNow.getUTCMinutes())) return;
      const istDate = istNow.toISOString().slice(0, 10);

      let sent = 0;
      let skipped = 0;
      for (const tenantId of await listActiveTenants()) {
        try {
          const r = await promptTenant(tenantId, istDate);
          sent += r.sent;
          skipped += r.skipped;
        } catch (err) {
          captureError("[day-close] tenant failed", err, { tenantId });
        }
      }
      if (sent || skipped) console.log(`[day-close] sent=${sent} skipped=${skipped}`);
    } catch (err) {
      captureError("[day-close] tick failed", err);
    } finally {
      running = false;
    }
  };

  void tick();
  const t = setInterval(tick, 15 * 60 * 1000);
  t.unref?.();
  console.log("[day-close] evening close-your-day worker armed (6:30 PM IST window, 15 min tick)");
  return () => clearInterval(t);
}
