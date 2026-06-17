/**
 * Wapi (Aina WhatsApp) webhook handler — https://beckend.ainatech.in.
 *
 * Receives, from the Wapi platform:
 *   - Delivery status updates (sent → delivered → read → failed)
 *   - Inbound messages from clients/leads
 *
 * Wapi forwards Meta's standard webhook envelope
 *   { entry: [{ changes: [{ value: { messages?, statuses?, metadata } }] }] }
 * but we also tolerate a flattened { event, data } / { status } / { from } shape.
 *
 * GET handles Meta's verification handshake (hub.challenge).
 *
 * Security: the platform must echo WAINA_WEBHOOK_SECRET in the
 * `x-webhook-secret` (or `x-api-key`) header. In production the secret is
 * MANDATORY — an unconfigured secret fails closed (503), because an open
 * inbound path lets anyone who knows a tenant's receiving WA number forge
 * messages, flip outbound→replied, and revoke a tenant's marketing consent
 * via a fake STOP. In non-production the check is skipped when unset so local
 * testing isn't blocked. Idempotent by (external_id, channel).
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { withSystem, withTenant } from "@/db/client";
import { communications, eventsOutbox, leads } from "@/db/schema";
import { applyMonotonicStatus } from "@/lib/comms/webhook-status";
import { autoTriageInbound } from "@/lib/comms/auto-responder";
import { captureError } from "@/lib/observability/capture";

export const dynamic = "force-dynamic";

// Meta verification handshake (GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  const expected = process.env.WAINA_WEBHOOK_VERIFY_TOKEN ?? process.env.WAINA_WEBHOOK_SECRET;
  if (mode === "subscribe" && challenge && (!expected || token === expected)) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "verification failed" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Shared-secret gate. Mandatory in production (fail closed if unset).
  const secret = process.env.WAINA_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      captureError("webhook.secret_unconfigured", null, { source: "wapi" });
      return NextResponse.json(
        { error: "webhook not configured" },
        { status: 503 }
      );
    }
    // non-production: allow through for local testing
  } else {
    const got = req.headers.get("x-webhook-secret") ?? req.headers.get("x-api-key") ?? "";
    if (!safeEqual(got, secret)) {
      captureError("webhook.signature_failed", null, { source: "wapi" });
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    let handled = false;

    // 1. Meta-standard envelope (what Wapi forwards).
    if (Array.isArray(payload?.entry)) {
      for (const entry of payload.entry) {
        for (const change of entry?.changes ?? []) {
          const value = change?.value ?? {};
          const toNumber: string =
            value?.metadata?.display_phone_number ?? value?.metadata?.phone_number ?? "";

          for (const s of value?.statuses ?? []) {
            handled = true;
            await updateMessageStatus(s.id ?? s.message_id, String(s.status ?? "").toLowerCase(), s.errors?.[0]?.code);
          }
          for (const m of value?.messages ?? []) {
            handled = true;
            const text = m?.text?.body ?? m?.button?.text ?? m?.interactive?.list_reply?.title ?? m?.interactive?.button_reply?.title ?? "";
            await handleInbound({ from: m.from, to: toNumber, text, messageId: m.id, raw: payload });
          }
        }
      }
    }

    // 2. Flattened fallback shapes.
    if (!handled) {
      const event: string = payload.event ?? payload.type ?? "";
      if (event === "message_status" || payload.status) {
        const messageId = payload.data?.messageId ?? payload.data?.message_id ?? payload.messageId ?? payload.message_id;
        const status = String(payload.data?.status ?? payload.status ?? "").toLowerCase();
        await updateMessageStatus(messageId, status, payload.data?.errorCode ?? payload.errorCode);
      } else if (event === "inbound_message" || payload.from) {
        await handleInbound({
          from: payload.data?.from ?? payload.from,
          to: payload.data?.to ?? payload.to,
          text: payload.data?.text ?? payload.text ?? "",
          messageId: payload.data?.messageId ?? payload.data?.id ?? payload.messageId ?? payload.id ?? null,
          raw: payload,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhook:wapi]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

async function updateMessageStatus(externalId: string, status: string, errorCode?: string) {
  if (!externalId || !status) return;
  // Meta/Wapi statuses already match our enum (delivered/read/failed/sent).
  // Unknown statuses pass through; the monotonic helper treats them as rank 0.
  const ourStatus = status;

  await withSystem(async (tx) => {
    const rows = await applyMonotonicStatus(tx, {
      externalId,
      channel: "whatsapp",
      newStatus: ourStatus,
      reason: errorCode ?? null,
    });
    for (const row of rows) {
      if (!row.advanced) continue;
      await tx.insert(eventsOutbox).values({
        tenantId: row.tenantId,
        kind: `communication.${ourStatus}.whatsapp`,
        entityType: "communication",
        entityId: row.id,
        after: { external_id: externalId, status: ourStatus, error_code: errorCode },
      } as any);
    }
  });
}

async function handleInbound(msg: { from: string; to: string; text: string; messageId: string | null; raw: any }) {
  const { from, to, text, messageId: providerMsgId, raw } = msg;
  if (!from || !to) return;

  // Identify tenant via the receiving WA number.
  const numRow = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT * FROM whatsapp_numbers WHERE phone_e164 = ${normalizePhone(to)} LIMIT 1
    `);
    return r.rows[0] as any;
  });
  if (!numRow) {
    console.warn(`[webhook:wapi] unmapped WA number ${to}`);
    return;
  }
  const tenantId = numRow.tenant_id;

  await withTenant(tenantId, async (tx) => {
    // Associate the inbound to a record: existing client (investor) first, then
    // an existing lead, otherwise AUTO-CREATE a lead so the conversation always
    // has a home (no orphaned inbound from an unknown number).
    const fromNorm = normalizePhone(from);
    const invRows = await tx.execute(sql`
      SELECT id FROM investors
      WHERE tenant_id = ${tenantId} AND (phone = ${from} OR whatsapp_phone = ${from})
      LIMIT 1
    `);
    let investorId: string | null = (invRows.rows[0] as any)?.id ?? null;
    let leadId: string | null = null;

    if (!investorId) {
      const leadRows = await tx.execute(sql`
        SELECT id FROM leads
        WHERE tenant_id = ${tenantId} AND (phone = ${from} OR phone_normalized = ${fromNorm})
        LIMIT 1
      `);
      leadId = (leadRows.rows[0] as any)?.id ?? null;

      if (!leadId) {
        const [created] = await tx
          .insert(leads)
          .values({
            tenantId,
            name: `WhatsApp: ${from}`,
            phone: from,
            phoneNormalized: fromNorm,
            source: "other",
            sourceCampaign: "WhatsApp inbound",
          } as any)
          .returning({ id: leads.id });
        leadId = created?.id ?? null;
      }
    }

    const commId = uuid();
    const inserted = await tx
      .insert(communications)
      .values({
        id: commId,
        tenantId,
        investorId,
        leadId,
        channel: "whatsapp",
        direction: "inbound",
        status: "delivered",
        externalId: providerMsgId ?? null,
        inboundContent: { text, raw, messageId: providerMsgId } as any,
        sentAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: communications.id });

    if (inserted.length === 0) return; // duplicate inbound delivery

    // Mark the most recent outbound to this subject as 'replied' (two-way thread).
    if (investorId || leadId) {
      const subjectCond = investorId ? sql`investor_id = ${investorId}` : sql`lead_id = ${leadId}`;
      await tx.execute(sql`
        UPDATE communications
        SET status = 'replied', replied_at = COALESCE(replied_at, now()), updated_at = now()
        WHERE id = (
          SELECT id FROM communications
          WHERE tenant_id = ${tenantId} AND ${subjectCond}
            AND channel = 'whatsapp' AND direction = 'outbound'
            AND status IN ('sent', 'delivered', 'read')
          ORDER BY created_at DESC
          LIMIT 1
        )
      `);
    }

    const isOptOut = /^(stop|unsubscribe|opt out|opt-out)$/i.test(text.trim());
    if (isOptOut && investorId) {
      await tx.execute(sql`
        INSERT INTO consents (id, tenant_id, investor_id, channel, scope, status, revoked_at, source, created_at, updated_at)
        VALUES (gen_random_uuid(), ${tenantId}, ${investorId}, 'whatsapp', 'marketing', 'revoked', now(), 'wa_optin', now(), now())
        ON CONFLICT (tenant_id, investor_id, channel, scope) DO UPDATE
        SET status = 'revoked', revoked_at = now(), updated_at = now()
      `);
    }

    await tx.insert(eventsOutbox).values({
      tenantId,
      kind: "inbound_message.whatsapp",
      entityType: "communication",
      entityId: commId,
      after: { from, text, investor_id: investorId, lead_id: leadId },
    } as any);

    // AI triage + RM routing applies to known clients (investors have an RM).
    if (!isOptOut && investorId) {
      await autoTriageInbound({ tx, tenantId, investorId, fromPhone: from, text });
    }
  });
}

/** Constant-time string compare that tolerates length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function normalizePhone(num: string): string {
  let n = (num ?? "").replace(/[^\d+]/g, "");
  if (n.startsWith("+")) n = n.slice(1);
  if (n.length === 10) n = `91${n}`;
  return n;
}
