/**
 * Aina Admin → operational alerts (final security patch, P1; ops_alerts).
 *
 *   GET  [?status=open|acknowledged]          alerts, newest first, with their delivery attempts
 *   POST { action: "acknowledge", id, note }  the signed-in on-call operator closes an alert (final)
 *   POST { action: "test", note }             raise a test alert and deliver it now — the drill
 *                                             that proves the channel reaches an operator
 *
 * Acknowledging needs a live, MFA-verified platform session (it silences the
 * escalation); the operator is taken from the server session only, never from
 * the body. Every acknowledgement and test is also written to the audit log.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withSystem } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { ControlError } from "@/lib/rta/posting/controls";
import { verifyOperator } from "@/lib/rta/posting/approvals";
import { acknowledgeAlert, AlertError, deliverDueAlerts, raiseOpsAlert } from "@/lib/ops/alerts";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("acknowledge"), id: z.string().uuid(), note: z.string().trim().min(5).max(1000) }).strict(),
  z.object({ action: z.literal("test"), note: z.string().trim().max(200).optional() }).strict(),
]);

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const status = req.nextUrl.searchParams.get("status");
    const rows = await withSystem(async (tx) => (await tx.execute(sql`
      SELECT a.id::text, a.kind, a.severity, a.summary, a.details, a.firm_id::text, a.status, a.delivery_state, a.occurrences,
             a.first_seen_at, a.last_seen_at, a.delivery_attempts, a.next_attempt_at, a.last_error, a.delivered_at,
             a.escalated_at, a.escalation_reason, a.acknowledged_at, a.acknowledged_by::text, u.name AS acknowledged_by_name, a.ack_note,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('channel', d.channel, 'attempt', d.attempt, 'at', d.at, 'outcome', d.outcome, 'httpStatus', d.http_status, 'error', d.error) ORDER BY d.at)
                         FROM ops_alert_deliveries d WHERE d.alert_id = a.id), '[]'::jsonb) AS deliveries
        FROM ops_alerts a LEFT JOIN users u ON u.id = a.acknowledged_by
       WHERE (${status}::text IS NULL OR a.status = ${status})
       ORDER BY (a.status = 'open') DESC, a.last_seen_at DESC LIMIT 200`)).rows);
    return NextResponse.json({ alerts: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const parse = Body.safeParse(await req.json().catch(() => null));
    if (!parse.success) return NextResponse.json({ error: "invalid request", issues: parse.error.issues }, { status: 400 });
    const b = parse.data;

    if (b.action === "test") {
      const alert = await withSystem(async (tx) => {
        const a = await raiseOpsAlert(tx, {
          kind: "ops.alert.test", severity: "warning", dedupKey: `test:${randomUUID()}`,
          summary: "TEST alert from the MFD CRM: acknowledge it to prove the on-call channel reaches an operator.",
          details: { requestedBy: session.userId, note: b.note ?? null },
        });
        await tx.execute(sql`
          INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
          VALUES (${session.tenantId}::uuid, ${session.userId}::uuid, 'user', 'ops.alert.test', 'ops_alert', ${a.id}::uuid, ${JSON.stringify({ note: b.note ?? null })}::jsonb)`);
        return a;
      });
      const delivery = await deliverDueAlerts();
      return NextResponse.json({ alert, delivery });
    }

    const row = await withSystem(async (tx) => {
      await verifyOperator(tx, session.userId, session.sid ?? null, { live: true, who: "operator" });
      const r = await acknowledgeAlert(tx, { id: b.id, by: session.userId, note: b.note });
      await tx.execute(sql`
        INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, after, reason)
        VALUES (${session.tenantId}::uuid, ${session.userId}::uuid, 'user', 'ops.alert.acknowledged', 'ops_alert', ${b.id}::uuid,
                ${JSON.stringify({ kind: (r as any).kind })}::jsonb, ${b.note})`);
      return r;
    });
    return NextResponse.json({ alert: row });
  } catch (err: any) {
    if (err instanceof AlertError || err instanceof ControlError) return NextResponse.json({ error: err.message }, { status: err.status });
    return handleApiError(err);
  }
}
