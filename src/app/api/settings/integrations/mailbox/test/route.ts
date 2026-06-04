/**
 * Live connection test for an MFD mailbox — used by the "Test" buttons before
 * saving. Verifies SMTP (auth + accept) or IMAP (auth + open INBOX).
 *
 * Returns 200 with { ok: false, error } on a failed connection so the form can
 * show the provider's message inline (wrong password, blocked port, etc.).
 * Owner-only. If the password field is blank, the saved one is reused.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { getTenantIntegration } from "@/lib/comms/integrations";
import { verifySmtp } from "@/lib/comms/adapters/resend";
import { verifyImap } from "@/lib/comms/imap";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(["smtp", "imap"]),
  config: z.object({
    host: z.string().trim().min(1).max(200),
    port: z.coerce.number().int().min(1).max(65535),
    secure: z.boolean(),
    user: z.string().trim().min(1).max(200),
    pass: z.string().max(500).optional().or(z.literal("")),
  }),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session.roles?.includes("owner")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid input" }, { status: 400 });
    }
    const { kind, config } = parsed.data;

    // Reuse the saved password when the form leaves it blank.
    let pass = config.pass ?? "";
    if (!pass) {
      const m = await withTenant(session.tenantId, async (tx) => getTenantIntegration(tx, session.tenantId, "mailbox"));
      pass = (m?.config as any)?.[kind]?.pass ?? "";
    }
    if (!pass) {
      return NextResponse.json({ ok: false, error: "Enter the password to test." });
    }

    const full = { host: config.host, port: config.port, secure: config.secure, user: config.user, pass };
    try {
      if (kind === "smtp") await verifySmtp(full);
      else await verifyImap(full);
      return NextResponse.json({ ok: true });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message ?? "Connection failed" });
    }
  } catch (err) {
    return handleApiError(err);
  }
}
