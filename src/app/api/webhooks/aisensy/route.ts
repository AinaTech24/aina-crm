/**
 * AiSensy webhook handler. Receives:
 *   - Delivery status updates (sent → delivered → read → failed)
 *   - Inbound messages from investors
 *   - Template approval status changes
 *
 * Security: verify HMAC signature on every request. Idempotent by
 * (external_id, status) — same status update arriving twice is harmless.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, sql, and } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { withSystem, withTenant } from "@/db/client";
import { communications, eventsOutbox, whatsappNumbers } from "@/db/schema";
import { whatsappAdapter } from "@/lib/comms/adapters/aisensy";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-aisensy-signature") ?? req.headers.get("x-hub-signature-256") ?? "";

  if (!whatsappAdapter.verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // AiSensy payload shapes vary by event type. Handle the common ones:
  // - { event: 'message_status', data: { messageId, status, timestamp, errorCode? } }
  // - { event: 'inbound_message', data: { from, to, text, mediaUrl?, timestamp } }
  // - { event: 'template_status', data: { name, status, language } }

  const event: string = payload.event ?? payload.type ?? "";

  try {
    if (event === "message_status" || payload.status) {
      const messageId = payload.data?.messageId ?? payload.messageId;
      const status = (payload.data?.status ?? payload.status ?? "").toLowerCase();
      await updateMessageStatus(messageId, status, payload.data?.errorCode ?? payload.errorCode);
    } else if (event === "inbound_message" || payload.from) {
      await handleInbound(payload);
    } else if (event === "template_status") {
      // Status will be picked up by the template-sync worker; just acknowledge.
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhook:aisensy]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

async function updateMessageStatus(externalId: string, status: string, errorCode?: string) {
  if (!externalId) return;
  await withSystem(async (tx) => {
    // Map AiSensy statuses to our enum
    const ourStatus =
      status === "delivered"
        ? "delivered"
        : status === "read"
        ? "read"
        : status === "failed"
        ? "failed"
        : status === "sent"
        ? "sent"
        : status;

    const tsField =
      ourStatus === "delivered"
        ? "delivered_at"
        : ourStatus === "read"
        ? "read_at"
        : ourStatus === "failed"
        ? "failed_at"
        : "sent_at";

    await tx.execute(sql`
      UPDATE communications
      SET status = ${ourStatus},
          ${sql.raw(tsField)} = COALESCE(${sql.raw(tsField)}, now()),
          status_reason = ${errorCode ?? null}
      WHERE external_id = ${externalId} AND channel = 'whatsapp'
    `);

    // Emit outbox event so workflows can react (e.g., wait_for_event on delivered)
    const tenant = await tx.execute(
      sql`SELECT tenant_id, id FROM communications WHERE external_id = ${externalId} AND channel = 'whatsapp' LIMIT 1`
    );
    const row = (tenant.rows[0] ?? null) as any;
    if (row) {
      await tx.insert(eventsOutbox).values({
        tenantId: row.tenant_id,
        kind: `communication.${ourStatus}.whatsapp`,
        entityType: "communication",
        entityId: row.id,
        after: { external_id: externalId, status: ourStatus, error_code: errorCode },
      } as any);
    }
  });
}

async function handleInbound(payload: any) {
  const from: string = payload.data?.from ?? payload.from ?? "";
  const to: string = payload.data?.to ?? payload.to ?? "";
  const text: string = payload.data?.text ?? payload.text ?? "";

  if (!from || !to) return;

  // Identify tenant via the receiving WA number
  const numRow = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT * FROM whatsapp_numbers WHERE phone_e164 = ${normalizePhone(to)} LIMIT 1
    `);
    return r.rows[0] as any;
  });

  if (!numRow) {
    console.warn(`[webhook:aisensy] unmapped WA number ${to}`);
    return;
  }

  const tenantId = numRow.tenant_id;

  await withTenant(tenantId, async (tx) => {
    // Try to match the sender phone to an investor (or create a lead)
    const matchRows = await tx.execute(sql`
      SELECT id FROM investors
      WHERE tenant_id = ${tenantId}
        AND (phone = ${from} OR whatsapp_phone = ${from})
      LIMIT 1
    `);
    const investorId = (matchRows.rows[0] as any)?.id ?? null;

    const commId = uuid();
    await tx.insert(communications).values({
      id: commId,
      tenantId,
      investorId,
      channel: "whatsapp",
      direction: "inbound",
      status: "delivered",
      inboundContent: { text, raw: payload } as any,
      sentAt: new Date(),
    });

    // Handle one-tap opt-out keywords
    if (/^(stop|unsubscribe|opt out|opt-out)$/i.test(text.trim())) {
      if (investorId) {
        await tx.execute(sql`
          INSERT INTO consents (id, tenant_id, investor_id, channel, scope, status, revoked_at, source, created_at, updated_at)
          VALUES (gen_random_uuid(), ${tenantId}, ${investorId}, 'whatsapp', 'marketing', 'revoked', now(), 'wa_optin', now(), now())
          ON CONFLICT (tenant_id, investor_id, channel, scope) DO UPDATE
          SET status = 'revoked', revoked_at = now(), updated_at = now()
        `);
      }
    }

    // Emit outbox so wait_for_event workflows can resume
    await tx.insert(eventsOutbox).values({
      tenantId,
      kind: "inbound_message.whatsapp",
      entityType: "communication",
      entityId: commId,
      after: { from, text, investor_id: investorId },
    } as any);
  });
}

function normalizePhone(num: string): string {
  let n = num.replace(/[^\d+]/g, "");
  if (n.startsWith("+")) n = n.slice(1);
  if (n.length === 10) n = `91${n}`;
  return n;
}
