/**
 * /onboarding/setup — the post-payment setup wizard (owner's addition C).
 * A firm that bought online lands here after paying and is sent back here by
 * the dashboard until it finishes; a firm with a new Terms / NDA version to
 * accept comes here for just those steps. Billing, Support and sign-out stay
 * reachable throughout.
 */
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requirePageSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { loadTenantLicense } from "@/lib/auth/license";
import { currentDocuments, onboardingGate } from "@/lib/legal/documents";
import { wizardState } from "@/lib/onboarding/wizard";
import { ToastProvider } from "@/components/ui/Toast";
import { ConfirmProvider } from "@/components/ui/ConfirmProvider";
import { SetupWizard, type SetupFirm } from "@/components/onboarding/SetupWizard";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const session = await requirePageSession();
  if (session.isPlatformAdmin) redirect("/super-admin");
  const license = await loadTenantLicense(session.tenantId, session.roles);
  if (license.isRestricted) redirect("/dashboard/billing");
  const gate = await onboardingGate(session.tenantId);
  if (!gate.mode) redirect("/dashboard");

  const canManage = can(session.roles, "settings.billing", session.permissions);
  const data = await withTenant(session.tenantId, async (tx) => {
    const t = (await tx.execute(sql`
      SELECT legal_name, display_name, arn, arn_expiry_at::text AS arn_expiry_at, principal_euin, pan_number, gst_registered, gst_number,
             address, email, phone, billing_email, logo_url
        FROM tenants WHERE id = ${session.tenantId}::uuid
    `)).rows[0] as Record<string, any>;
    const u = (await tx.execute(sql`SELECT email_verified_at FROM users WHERE id = ${session.userId}::uuid`)).rows[0] as { email_verified_at: string | null } | undefined;
    const docs = await currentDocuments(tx);
    return { t, verified: !!u?.email_verified_at, docs };
  });
  const state = await wizardState(session.tenantId, gate.mode === "setup");
  const a = (data.t.address ?? {}) as Record<string, string | undefined>;
  const firm: SetupFirm = {
    legalName: data.t.legal_name ?? "",
    displayName: data.t.display_name ?? "",
    arn: data.t.arn ?? "",
    arnExpiry: data.t.arn_expiry_at ?? "",
    principalEuin: data.t.principal_euin ?? "",
    pan: data.t.pan_number ?? "",
    gstRegistered: data.t.gst_registered !== false,
    gstin: data.t.gst_number ?? "",
    addressLine1: a.line1 ?? "",
    addressLine2: a.line2 ?? "",
    city: a.city ?? "",
    state: a.state ?? "",
    pincode: a.pincode ?? "",
    email: data.t.email ?? session.email ?? "",
    phone: data.t.phone ?? "",
    billingEmail: data.t.billing_email ?? "",
  };

  return (
    <ToastProvider>
      <ConfirmProvider>
        <main className="min-h-screen bg-secondary/40">
          <SetupWizard
            mode={gate.mode}
            canManage={canManage}
            firm={firm}
            firmComplete={state.firmComplete}
            logoUrl={state.logoUrl}
            pending={state.pending}
            emailVerified={data.verified}
            signerName={session.name}
            signerEmail={session.email}
            docs={data.docs.map((d) => ({ id: d.id, kind: d.kind, version: d.version, title: d.title, body: d.body }))}
          />
        </main>
      </ConfirmProvider>
    </ToastProvider>
  );
}
