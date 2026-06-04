/**
 * Per-MFD mailbox (SMTP send + IMAP receive) — "map your own email account".
 *
 * When an SMTP mailbox is connected + active, the dispatch pipeline sends client
 * email straight through it (authentic From, no domain verification needed),
 * preferring it over Resend. IMAP creds are stored for the inbound-sync worker.
 *
 *   GET    → non-secret status (hosts/users, connected flags, from identity)
 *   POST   → save { smtp, imap?, fromName?, fromEmail?, replyTo? } (encrypted)
 *   DELETE → disconnect (revert to the Resend sender)
 *
 * Owner-only. Passwords are write-only: leave blank on edit to keep the saved one.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { getTenantIntegration, upsertTenantIntegration, disableTenantIntegration } from "@/lib/comms/integrations";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

function requireOwner(roles: string[] | undefined) {
  if (!roles?.includes("owner")) {
    return NextResponse.json({ error: "forbidden: only the firm owner can connect a mailbox" }, { status: 403 });
  }
  return null;
}

export async function GET() {
  try {
    const session = await requireSession();
    const m = await withTenant(session.tenantId, async (tx) => getTenantIntegration(tx, session.tenantId, "mailbox"));
    const smtp = (m?.config as any)?.smtp;
    const imap = (m?.config as any)?.imap;
    return NextResponse.json({
      connected: !!(m?.isActive && smtp?.host),
      smtp: smtp ? { host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user, hasPass: !!smtp.pass } : null,
      imap: imap ? { host: imap.host, port: imap.port, secure: imap.secure, user: imap.user, hasPass: !!imap.pass } : null,
      fromName: m?.senderConfig?.fromName ?? "",
      fromEmail: m?.senderConfig?.fromEmail ?? "",
      replyTo: m?.senderConfig?.replyTo ?? "",
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const Server = z.object({
  host: z.string().trim().min(1).max(200),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().min(1).max(200),
  pass: z.string().max(500).optional().or(z.literal("")),
});

const SaveSchema = z.object({
  fromName: z.string().trim().max(120).optional().or(z.literal("")),
  fromEmail: z.string().trim().email().max(200).optional().or(z.literal("")),
  replyTo: z.string().trim().email().max(200).optional().or(z.literal("")),
  smtp: Server,
  imap: Server.optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const forbidden = requireOwner(session.roles);
    if (forbidden) return forbidden;

    const parsed = SaveSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid input", details: parsed.error.flatten() }, { status: 400 });
    }
    const d = parsed.data;

    await withTenant(session.tenantId, async (tx) => {
      const existing = await getTenantIntegration(tx, session.tenantId, "mailbox");
      const exSmtp = (existing?.config as any)?.smtp ?? {};
      const exImap = (existing?.config as any)?.imap ?? {};

      const config: Record<string, any> = {
        smtp: { ...d.smtp, pass: d.smtp.pass || exSmtp.pass || "" },
      };
      if (d.imap) {
        config.imap = { ...d.imap, pass: d.imap.pass || exImap.pass || "" };
      } else if (exImap.host) {
        config.imap = exImap; // keep previously-saved IMAP if the form omitted it
      }

      await upsertTenantIntegration(tx, session.tenantId, "mailbox", config, {
        fromName: d.fromName || undefined,
        fromEmail: d.fromEmail || d.smtp.user,
        replyTo: d.replyTo || undefined,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE() {
  try {
    const session = await requireSession();
    const forbidden = requireOwner(session.roles);
    if (forbidden) return forbidden;
    await withTenant(session.tenantId, async (tx) => {
      await disableTenantIntegration(tx, session.tenantId, "mailbox");
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
