import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { pollRtaInboxOnce } from "@/workers/rta-inbox-poller";
import { enforce } from "@/lib/rate-limit";
import { requireRtaImportAccess, RTA_IMPORT_CAPABILITY } from "@/lib/rta/import-access";

export const dynamic = "force-dynamic";

/**
 * POST /api/rta/sync-mailbox
 *
 * Triggers an immediate on-demand check of the RTA mailback catch-all mailbox.
 * Downloads new CAMS/KFintech mailback attachments, decrypts with firm passwords,
 * and enqueues import jobs.
 *
 * NOTE: the catch-all is PLATFORM-wide — this polls every firm's pending mail
 * (each mail is still routed to its own firm by alias). So the response never
 * reports how many mails were processed: that number is other firms' volume.
 * It reads IMAP only; mail received through Amazon SES is drained by the
 * worker every couple of minutes regardless.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // `requireAny` takes CAPABILITIES, not role names. Gate on the same
    // access as the manual RTA upload and the mailback settings API
    // (lib/rta/import-access: the capability on an un-narrowed book) so the
    // three stay in step.
    requireAny(session.roles, [RTA_IMPORT_CAPABILITY], session.permissions);
    await requireRtaImportAccess(session);

    // Limit manual syncs to 12 per hour per user
    const limited = enforce(req, "rta.sync_mailbox", { limit: 12, windowSec: 3600 }, session.userId);
    if (limited) return limited;

    const result = await pollRtaInboxOnce();

    if (result.error) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          configured: result.configured,
        },
        { status: result.configured ? 502 : 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Mailbox checked. Any new mailback for your firm is now queued — refresh in a moment to see it below.",
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
