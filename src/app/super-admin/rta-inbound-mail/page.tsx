import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { getRtaInboxStatusForAdmin } from "@/lib/rta/inbox-config";
import { RtaInboundMailLog } from "@/components/super-admin/RtaInboundMailLog";

export const dynamic = "force-dynamic";

export default async function PlatformRtaInboundMailPage() {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.settings.manage");

  const status = await getRtaInboxStatusForAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Inbound Mail</h1>
        <p className="text-muted-foreground text-sm max-w-3xl">
          Every message the RTA mailback poller has seen — routed to a firm or not. Expand a row for the message body and
          the per-attachment verdict, which is what tells you <em>why</em> a mail didn&apos;t import.
        </p>
      </div>

      {!status.configured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm">
          The catch-all inbox isn&apos;t configured yet, so nothing is being polled. Set it up under{" "}
          <Link href="/super-admin/rta-inbox" className="underline font-medium">
            RTA Mailbox
          </Link>
          .
        </div>
      )}

      <RtaInboundMailLog />

      <div className="border rounded-lg bg-muted/30 p-4 text-xs text-muted-foreground space-y-1.5 max-w-3xl">
        <p className="font-medium text-foreground">Reading this screen</p>
        <p>
          <strong>Unroutable</strong> means no firm&apos;s forwarding address matched the recipient — usually a typo in the
          forward rule, or the firm rotated their address and didn&apos;t repoint it.{" "}
          <strong>No RTA file</strong> means the mail reached the right firm but no attachment carried a recognised
          CAMS/KFintech report code; the filename pattern may need adding to the classifier.{" "}
          <strong>Already imported</strong> is a safe no-op — the same file was already in flight.
        </p>
        <p>
          Only the first 2000 characters of the plain-text body are stored, and attachment <em>bytes</em> are never kept
          here — they go straight to S3 and through the import pipeline. For the full original message, open the{" "}
          <code className="bg-background px-1 rounded">{status.user ?? "rta@…"}</code> mailbox directly; the poller only
          flags mail as read, it never deletes.
        </p>
      </div>
    </div>
  );
}
