/**
 * Resend webhook handler. Receives delivery/open/click/bounce events
 * via Svix-signed payloads.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { emailAdapter } from "@/lib/comms/adapters/resend";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k] = v));

  if (!emailAdapter.verifyWebhookSignature(rawBody, headers)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const type: string = payload.type ?? "";
  const data = payload.data ?? {};
  const emailId: string = data.email_id ?? data.id ?? "";

  if (!emailId) return NextResponse.json({ ok: true });

  const statusMap: Record<string, string> = {
    "email.sent": "sent",
    "email.delivered": "delivered",
    "email.opened": "read",
    "email.clicked": "read",
    "email.bounced": "bounced",
    "email.complained": "bounced",
    "email.delivery_delayed": "queued",
    "email.failed": "failed",
  };

  const newStatus = statusMap[type] ?? null;
  if (!newStatus) return NextResponse.json({ ok: true });

  const tsField =
    newStatus === "delivered"
      ? "delivered_at"
      : newStatus === "read"
      ? "read_at"
      : newStatus === "failed" || newStatus === "bounced"
      ? "failed_at"
      : "sent_at";

  await withSystem(async (tx) => {
    await tx.execute(sql`
      UPDATE communications
      SET status = ${newStatus},
          ${sql.raw(tsField)} = COALESCE(${sql.raw(tsField)}, now())
      WHERE external_id = ${emailId} AND channel = 'email'
    `);
  });

  return NextResponse.json({ ok: true });
}
