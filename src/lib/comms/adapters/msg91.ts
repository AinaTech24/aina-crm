/**
 * MSG91 SMS adapter (India). Requires DLT (Distributed Ledger Technology)
 * template registration with TRAI — the template version's body must include
 * a `dltTemplateId`, enforced by compliance.
 */

import axios from "axios";
import type { TemplateVersion } from "@/db/schema";

export interface SendSmsArgs {
  tenantId: string;
  templateVersion: TemplateVersion;
  tokens: Record<string, string>;
  rendered: { text: string; tokens: Record<string, string> };
  recipient: string;
  apiKey?: string;
  senderId?: string;
}

export const smsAdapter = {
  async send(args: SendSmsArgs): Promise<{ externalId: string; status: "sent" | "queued" }> {
    const authKey = args.apiKey ?? process.env.MSG91_AUTH_KEY;
    if (!authKey) throw new Error("MSG91_AUTH_KEY not set");
    const senderId = args.senderId ?? process.env.MSG91_SENDER_ID ?? "MFDPLT";
    const body = args.templateVersion.body as any;
    const dltTemplateId = body?.dltTemplateId;
    if (!dltTemplateId) {
      throw new Error("SMS template missing dltTemplateId");
    }

    const recipient = normalizeMobile(args.recipient);

    // MSG91 v5 Flow API expects template_id + variables
    const payload = {
      template_id: dltTemplateId,
      short_url: "0",
      recipients: [
        {
          mobiles: recipient,
          ...args.tokens, // variable values keyed by var1, var2, etc.
        },
      ],
      sender: senderId,
    };

    const res = await axios.post("https://control.msg91.com/api/v5/flow/", payload, {
      headers: {
        "Content-Type": "application/json",
        authkey: authKey,
      },
      timeout: 15_000,
    });


    return {
      externalId: res.data?.request_id ?? `msg91-${Date.now()}`,
      status: "sent",
    };
  },
};

function normalizeMobile(num: string): string {
  let n = num.replace(/[^\d+]/g, "");
  if (n.startsWith("+")) n = n.slice(1);
  if (n.length === 10) n = `91${n}`;
  return n;
}
