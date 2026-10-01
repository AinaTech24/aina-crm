/**
 * /complaint/[token] — the firm's public complaint form.
 *
 * Public (PUBLIC_PATH_PREFIXES in middleware.ts): the random token in the link
 * is the firm's, and the page shows only the firm's name, logo and ARN. A
 * complaint sent from here opens a service request in that firm's CRM — see
 * lib/complaints/web-form.ts.
 */

import type { Metadata } from "next";
import { SEBI_COMPLAINT_CATEGORIES } from "@/db/schema/service_requests";
import { resolveComplaintForm } from "@/lib/complaints/web-form";
import { PublicComplaintForm } from "@/components/complaints/PublicComplaintForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Register a complaint",
  robots: { index: false, follow: false },
};

export default async function PublicComplaintPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const form = await resolveComplaintForm(token);

  if (!form || !form.enabled) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-secondary px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center">
          <h1 className="text-lg font-semibold text-foreground">
            {form ? "This form is not taking complaints right now" : "This link is not valid"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {form ? `Please contact ${form.firmName} directly.` : "Please check the link, or contact the firm directly."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <PublicComplaintForm
      token={token}
      firm={{ name: form.firmName, logoUrl: form.logoUrl, primaryColor: form.primaryColor, arn: form.arn }}
      categories={SEBI_COMPLAINT_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
    />
  );
}
