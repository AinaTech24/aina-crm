import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { createNotification } from "./create";
import { sendPushToUsers } from "@/lib/push/expo";

/** One reminder per meeting time, including reschedules. No client messages. */
export async function createMeetingReminders(tenantId: string) {
  return withTenant(tenantId, async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:mobile-meeting-reminders`}, 0))`);
    const meetings = (await tx.execute(sql`SELECT m.id, m.rm_id, m.meeting_date::text AS scheduled_at
      FROM review_meetings m JOIN users u ON u.id = m.rm_id AND u.tenant_id = m.tenant_id
      WHERE m.tenant_id = ${tenantId}::uuid AND u.status = 'active'
        AND m.status IN ('scheduled','confirmed') AND m.meeting_date > now()
        AND m.meeting_date <= now() + interval '15 minutes'
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.tenant_id = m.tenant_id
          AND n.kind = 'meeting.reminder' AND n.user_id = m.rm_id
          AND n.meta->>'meetingId' = m.id::text AND n.meta->>'scheduledAt' = m.meeting_date::text)
      ORDER BY m.meeting_date LIMIT 100`)).rows;
    for (const m of meetings) await createNotification(tx, {
      tenantId, userId: String(m.rm_id), kind: "meeting.reminder", title: "Your meeting starts soon",
      body: "A scheduled meeting begins within 15 minutes. Open Aina CRM for details.",
      linkUrl: `/dashboard/review-meetings/${m.id}`,
      meta: { meetingId: String(m.id), scheduledAt: String(m.scheduled_at) },
    });
    return meetings.length;
  });
}

type Pending = { id: string; user_id: string; title: string; body: string | null; link_url: string | null };

/**
 * Staff alerts only. Claim before sending: a worker retry must not double-send.
 * Delivery is best-effort/at-most-once. A crash after claim may miss the push;
 * the durable in-app notification remains available. No catch-up flood for
 * devices registered more than a day after an alert was created.
 */
export async function deliverMobileAlerts(tenantId: string): Promise<number> {
  const pending = await withTenant(tenantId, async tx => {
    const rows = (await tx.execute(sql`SELECT n.id, n.user_id, n.title, n.body, n.link_url
      FROM notifications n JOIN users u ON u.id = n.user_id AND u.tenant_id = n.tenant_id
      WHERE n.tenant_id = ${tenantId}::uuid AND u.status = 'active'
        AND n.read_at IS NULL AND n.archived_at IS NULL
        AND n.created_at > now() - interval '1 day' AND n.meta->'mobilePush'->>'status' = 'pending'
        AND EXISTS (SELECT 1 FROM devices d WHERE d.tenant_id = n.tenant_id AND d.user_id = n.user_id AND d.disabled_at IS NULL)
      ORDER BY n.created_at LIMIT 50 FOR UPDATE OF n SKIP LOCKED`)).rows as Pending[];
    for (const row of rows) await tx.execute(sql`UPDATE notifications SET
      meta = jsonb_set(COALESCE(meta,'{}'::jsonb), '{mobilePush}', ${JSON.stringify({ status: "claimed", at: new Date().toISOString() })}::jsonb), updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid AND id = ${row.id}::uuid`);
    return rows;
  });
  for (const row of pending) {
    try {
      await withTenant(tenantId, async tx => {
        const result = await sendPushToUsers(tx, tenantId, [row.user_id], {
          title: row.title, body: row.body ?? undefined,
          data: { notificationId: row.id, ...(row.link_url ? { url: row.link_url } : {}) },
        });
        await tx.execute(sql`UPDATE notifications SET
          meta = jsonb_set(COALESCE(meta,'{}'::jsonb), '{mobilePush}', ${JSON.stringify({ status: result.sent ? "accepted" : "failed", ...result, at: new Date().toISOString() })}::jsonb), updated_at = now()
          WHERE tenant_id = ${tenantId}::uuid AND id = ${row.id}::uuid`);
      });
    } catch (e) {
      // Leave claimed on an uncertain result; retrying can duplicate delivery.
      console.error("[mobile-alerts] delivery failed", row.id, (e as Error).message);
    }
  }
  return pending.length;
}
