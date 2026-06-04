import Link from "next/link";
import { eq } from "drizzle-orm";
import { ChevronLeft, Mail, Check, AlertCircle } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { getTenantIntegration } from "@/lib/comms/integrations";
import { tenants } from "@/db/schema";
import { EmailSenderForm } from "@/components/settings/EmailSenderForm";
import { MailboxForm } from "@/components/settings/MailboxForm";

export const dynamic = "force-dynamic";

export default async function EmailSettingsPage() {
  const session = await requireSession();
  const { resolved, mailbox, tenant } = await withTenant(session.tenantId, async (tx) => {
    const resolved = await getTenantIntegration(tx, session.tenantId, "resend");
    const mailbox = await getTenantIntegration(tx, session.tenantId, "mailbox");
    const [t] = await tx
      .select({ displayName: tenants.displayName, legalName: tenants.legalName, email: tenants.email })
      .from(tenants)
      .where(eq(tenants.id, session.tenantId))
      .limit(1);
    return { resolved, mailbox, tenant: t };
  });

  const mbSmtp = (mailbox?.config as any)?.smtp;
  const mbImap = (mailbox?.config as any)?.imap;

  const platformConfigured = !!(process.env.RESEND_API_KEY && !process.env.RESEND_API_KEY.includes("xxx"));
  const ownKey = resolved?.config?.apiKey ?? "";
  const usingCustom = !!(resolved?.senderConfig?.fromName || resolved?.senderConfig?.fromEmail || resolved?.senderConfig?.replyTo);

  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/dashboard/settings" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to settings
      </Link>
      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
        <Mail className="size-5" /> Email setup
      </h1>

      {/* Platform sending status */}
      <div className={`border rounded-lg p-4 ${platformConfigured ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-300"}`}>
        <div className="flex items-start gap-2">
          {platformConfigured ? (
            <Check className="size-5 text-emerald-600 mt-0.5" />
          ) : (
            <AlertCircle className="size-5 text-amber-600 mt-0.5" />
          )}
          <div className="text-sm">
            <div className="font-medium">{platformConfigured ? "Email delivery active" : "Email delivery not yet configured"}</div>
            <p className="text-muted-foreground mt-0.5">
              {platformConfigured
                ? usingCustom
                  ? "Client emails go out under your firm's identity (set below)."
                  : "Set your sender identity below so client emails come from your firm, not the shared address."
                : "Email sends are queued in stub mode until the platform email key is configured."}
            </p>
          </div>
        </div>
      </div>

      {/* Option A — sender identity on the platform's email service */}
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-1">
        Option A · Use the platform email service
      </div>
      <EmailSenderForm
        initial={{
          fromName: resolved?.senderConfig?.fromName ?? "",
          fromEmail: resolved?.senderConfig?.fromEmail ?? "",
          replyTo: resolved?.senderConfig?.replyTo ?? "",
          ownKeyHint: ownKey ? `••••${ownKey.slice(-4)}` : null,
          platformFrom: process.env.EMAIL_FROM_TRANSACTIONAL ?? null,
          firmName: tenant?.displayName ?? tenant?.legalName ?? "",
          firmEmail: tenant?.email ?? "",
        }}
      />

      {/* Option B — connect the firm's own mailbox over SMTP/IMAP */}
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-2">
        Option B · Connect your own mailbox (recommended for true “from your address”)
      </div>
      <MailboxForm
        initial={{
          connected: !!(mailbox?.isActive && mbSmtp?.host),
          smtp: mbSmtp ? { host: mbSmtp.host, port: mbSmtp.port, secure: mbSmtp.secure, user: mbSmtp.user, hasPass: !!mbSmtp.pass } : null,
          imap: mbImap ? { host: mbImap.host, port: mbImap.port, secure: mbImap.secure, user: mbImap.user, hasPass: !!mbImap.pass } : null,
          fromName: mailbox?.senderConfig?.fromName ?? "",
          fromEmail: mailbox?.senderConfig?.fromEmail ?? "",
          replyTo: mailbox?.senderConfig?.replyTo ?? "",
          firmName: tenant?.displayName ?? tenant?.legalName ?? "",
          firmEmail: tenant?.email ?? "",
        }}
      />

      <div className="border rounded-lg bg-card p-4 text-xs text-muted-foreground">
        Transactional and marketing emails stay on separate sending streams for deliverability. A marketing
        unsubscribe footer is auto-injected. Only the firm owner can change the sender identity.
      </div>
    </div>
  );
}
