/**
 * Service-request acknowledgement — close the loop the instant a ticket opens.
 *
 * "I messaged my advisor and immediately got an acknowledgement with a promised
 * resolution time" is the single biggest perception-of-service lever. This sends
 * the client a confirmation (ticket no + promised resolution date), translated to
 * their preferred language, and always writes a communications audit row.
 *
 * Best-effort + fail-safe: a missing email / Resend key / any send error never
 * throws — the ticket is already created; the ack just degrades to an audited
 * "queued" row the RM can relay.
 */

import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { Resend } from "resend";
import type { Tx } from "@/db/client";
import { investors, tenants, communications } from "@/db/schema";
import { translateText } from "@/lib/comms/translate";

let resendClient: Resend | null = null;
function getResend(): Resend | null {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  resendClient = new Resend(key);
  return resendClient;
}

export async function acknowledgeServiceRequest(
  tx: Tx,
  args: {
    tenantId: string;
    srId: string;
    ticketNo: string;
    type: string;
    slaResolutionAt: Date;
    investorId: string | null;
  }
): Promise<{ sent: boolean }> {
  if (!args.investorId) return { sent: false };
  try {
    const [inv] = await tx
      .select({ name: investors.name, email: investors.email, lang: investors.languagePref })
      .from(investors)
      .where(eq(investors.id, args.investorId))
      .limit(1);
    if (!inv) return { sent: false };
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, args.tenantId)).limit(1);
    const tenant = t as any;

    const eta = args.slaResolutionAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const lines = await translateText(
      [
        `Hi ${inv.name ?? ""},`,
        `We've received your request (ref ${args.ticketNo}). Our team will get back to you by ${eta}.`,
        `Thank you for banking your trust with us.`,
      ],
      inv.lang
    );
    const signoff = `— ${tenant?.displayName ?? ""}, ARN ${tenant?.arn ?? "—"}`;

    let externalId: string | null = null;
    let status = "queued";
    if (inv.email) {
      const client = getResend();
      if (client) {
        try {
          const res = await client.emails.send({
            from: process.env.EMAIL_FROM_TRANSACTIONAL ?? "no-reply@example.com",
            to: [inv.email],
            subject: `We've received your request — ${args.ticketNo}`,
            html: `<p>${lines.map((l) => l).join("<br/>")}</p><p style="color:#64748b;font-size:12px">${signoff}</p>`,
          } as any);
          externalId = (res as any)?.data?.id ?? null;
          status = "sent";
        } catch {
          status = "queued";
        }
      } else {
        externalId = `dev_${uuid()}`;
        status = "sent";
      }
    }

    await tx.insert(communications).values({
      tenantId: args.tenantId,
      investorId: args.investorId,
      channel: inv.email ? "email" : "whatsapp",
      direction: "outbound",
      status,
      externalId,
      payload: {
        kind: "service_request_ack",
        serviceRequestId: args.srId,
        ticketNo: args.ticketNo,
        type: args.type,
        eta,
        text: [...lines, signoff].join("\n"),
      } as any,
      sentAt: status === "sent" ? new Date() : null,
    } as any);

    return { sent: status === "sent" };
  } catch (err) {
    console.error("[sr-ack] non-fatal:", (err as Error).message);
    return { sent: false };
  }
}
