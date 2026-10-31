/**
 * /service-request/[token] — the firm's public service request form.
 *
 * Public (PUBLIC_PATH_PREFIXES in middleware.ts): the random token in the link
 * is the firm's, and the page shows only the firm's name, logo and ARN. What is
 * sent from here opens service requests in that firm's CRM — see
 * lib/service-requests/web-form.ts.
 */

import type { Metadata } from "next";
import { resolveServiceForm } from "@/lib/service-requests/web-form";
import { WEB_SERVICES } from "@/lib/service-requests/web-submission";
import { PublicServiceRequestForm } from "@/components/service-requests/PublicServiceRequestForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Request a service",
  robots: { index: false, follow: false },
};

export default async function PublicServiceRequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const form = await resolveServiceForm(token);

  if (!form || !form.enabled) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-secondary px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center">
          <h1 className="text-lg font-semibold text-foreground">
            {form ? "This form is not taking requests right now" : "This link is not valid"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {form ? `Please contact ${form.firmName} directly.` : "Please check the link, or contact the firm directly."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <PublicServiceRequestForm
      token={token}
      firm={{ name: form.firmName, logoUrl: form.logoUrl, primaryColor: form.primaryColor, arn: form.arn, tenantId: form.tenantId }}
      services={WEB_SERVICES.map((s) => ({ value: s.value, label: s.label }))}
    />
  );
}
