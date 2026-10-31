/**
 * /feedback/[token] — the firm's public feedback form, for its website and
 * email signature.
 *
 * Public (PUBLIC_PATH_PREFIXES in middleware.ts): the random token in the link
 * is the firm's, and the page shows only the firm's name and ARN. A response
 * is filed as a closed feedback request in that firm's CRM and counts towards
 * its NPS — see lib/feedback/web-form.ts.
 */

import type { Metadata } from "next";
import { MessageSquareHeart } from "lucide-react";
import { formatArn } from "@/lib/branding/arn";
import { resolveFeedbackForm } from "@/lib/feedback/web-form";
import { PrivacyNoticeLink } from "@/components/privacy/PrivacyNoticeLink";
import { PublicFeedbackForm } from "@/components/public/PublicFeedbackForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Share your feedback",
  robots: { index: false, follow: false },
};

export default async function PublicFirmFeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const form = await resolveFeedbackForm(token);

  if (!form || !form.enabled) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-secondary px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center">
          <h1 className="text-lg font-semibold text-foreground">
            {form ? "This form is not taking feedback right now" : "This link is not valid"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {form ? `Please contact ${form.firmName} directly.` : "Please check the link, or contact the firm directly."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-secondary">
      <header className="bg-white border-b">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquareHeart className="size-5 text-brand-cyan" />
            <span className="font-semibold">{form.firmName}</span>
          </div>
          <div className="text-2xs text-muted-foreground">{formatArn(form.arn)}</div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <PublicFeedbackForm webToken={token} recipientName="" firmName={form.firmName} />
      </main>

      <footer className="max-w-2xl mx-auto px-4 py-6 text-2xs text-muted-foreground text-center">
        Mutual fund investments are subject to market risks. Read all scheme related documents carefully.
        {form.arn ? <> · {form.firmName} · {formatArn(form.arn)}</> : null}
        <PrivacyNoticeLink tenantId={form.tenantId} firmName={form.firmName} className="mt-2" />
      </footer>
    </div>
  );
}
