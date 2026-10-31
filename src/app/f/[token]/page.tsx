/**
 * Public client-feedback form — accessed via /f/<token>.
 *
 * Mirrors /r/<token> (risk profile): the RM shares the link by email or
 * WhatsApp, the client answers without logging in, and the submit endpoint
 * files it as a closed `feedback` service request.
 *
 * No-auth route — `resolveShareToken` (withSystem) validates the token, then
 * tenant branding and the recipient's name load in the same system context.
 * `/f/` is allow-listed in middleware for exactly this reason.
 */

import { eq } from "drizzle-orm";
import { formatArn } from "@/lib/branding/arn";
import { MessageSquareHeart } from "lucide-react";
import { withSystem } from "@/db/client";
import { tenants, leads, investors } from "@/db/schema";
import { resolveShareToken } from "@/lib/share-tokens";
import { isSampleShareToken } from "@/lib/share-tokens/sample";
import { PrivacyNoticeLink } from "@/components/privacy/PrivacyNoticeLink";
import { PublicFeedbackForm } from "@/components/public/PublicFeedbackForm";

export const dynamic = "force-dynamic";

export default async function PublicFeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (isSampleShareToken(token)) return <SampleScreen what="feedback form" />;

  let info: Awaited<ReturnType<typeof resolveShareToken>>;
  try {
    info = await resolveShareToken(token);
  } catch (e: any) {
    return <ErrorScreen message={e?.message ?? "This link is no longer valid"} />;
  }
  if (info.kind !== "feedback") {
    return <ErrorScreen message="This link is not a feedback form." />;
  }

  const data = await withSystem(async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, info.tenantId));
    let recipientName = "";
    if (info.subjectType === "lead") {
      const [l] = await tx.select().from(leads).where(eq(leads.id, info.subjectId));
      recipientName = l?.name ?? "";
    } else if (info.subjectType === "investor") {
      const [i] = await tx.select().from(investors).where(eq(investors.id, info.subjectId));
      recipientName = i?.name ?? "";
    }
    return { tenant, recipientName };
  });

  const firmName = data.tenant?.displayName ?? data.tenant?.legalName ?? "your advisor";

  return (
    <div className="min-h-screen bg-secondary">
      <header className="bg-white border-b">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquareHeart className="size-5 text-brand-cyan" />
            <span className="font-semibold">{firmName}</span>
          </div>
          <div className="text-2xs text-muted-foreground">
            {formatArn(data.tenant?.arn)}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <PublicFeedbackForm tokenId={info.id} recipientName={data.recipientName} firmName={firmName} />
      </main>

      <footer className="max-w-2xl mx-auto px-4 py-6 text-2xs text-muted-foreground text-center">
        Mutual fund investments are subject to market risks. Read all scheme related documents carefully.
        {data.tenant?.arn ? <> · {firmName} · {formatArn(data.tenant.arn)}</> : null}
        <PrivacyNoticeLink tenantId={info.tenantId} firmName={firmName} className="mt-2" />
      </footer>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-secondary grid place-items-center p-6">
      <div className="max-w-md bg-white rounded-lg shadow p-6 text-center">
        <MessageSquareHeart className="size-10 text-rose-600 mx-auto" />
        <h1 className="text-lg font-semibold mt-3">Link unavailable</h1>
        <p className="text-sm text-muted-foreground mt-2">{message}</p>
        <p className="text-xs text-muted-foreground mt-4">
          Please reach out to your relationship manager for a new link.
        </p>
      </div>
    </div>
  );
}

/**
 * A link from a PREVIEW or TEST email. There is no client behind it, so explain
 * that plainly instead of showing the generic "link unavailable" error, which
 * made a working feature look broken.
 */
function SampleScreen({ what }: { what: string }) {
  return (
    <div className="min-h-screen bg-secondary grid place-items-center p-6">
      <div className="max-w-md bg-white rounded-lg shadow p-6 text-center">
        <MessageSquareHeart className="size-10 text-brand-cyan mx-auto" />
        <h1 className="text-lg font-semibold mt-3">This is a sample link</h1>
        <p className="text-sm text-muted-foreground mt-2">
          You have opened a link from a test or preview email, so there is no {what} to load.
        </p>
        <p className="text-xs text-muted-foreground mt-4">
          Emails sent to a real client carry a personal link that opens their own form.
        </p>
      </div>
    </div>
  );
}
