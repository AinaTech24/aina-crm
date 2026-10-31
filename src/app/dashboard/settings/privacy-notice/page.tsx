import { eq } from "drizzle-orm";
import { ShieldCheck } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { withTenant } from "@/db/client";
import { tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { privacyNoticePath, readPrivacyNotice } from "@/lib/privacy/notice";
import { PrivacyNoticeForm } from "./PrivacyNoticeForm";

export const dynamic = "force-dynamic";

/**
 * Settings → Privacy notice: the firm's DPDP notice (lib/privacy/notice.ts) —
 * its privacy contact, its own purposes and recipients — public at
 * /privacy/<tenant id> and linked from every public form and email footer.
 */
export default async function PrivacyNoticeSettingsPage() {
  const session = await requireSession();
  if (!can(session.roles, "settings.users", session.permissions)) {
    return (
      <div className="mt-6">
        <EmptyState
          icon={ShieldCheck}
          title="Only an administrator can change the firm's privacy notice"
          description="It tells clients and leads how the firm uses their personal data. Ask the firm owner if it needs to change."
          primary={{ href: "/dashboard/settings", label: "Back to settings" }}
        />
      </div>
    );
  }
  const data = await withTenant(session.tenantId, async (tx) => {
    const [t] = await tx
      .select({ privacyNotice: tenants.privacyNotice, dpo: tenants.dataProtectionOfficer })
      .from(tenants)
      .where(eq(tenants.id, session.tenantId));
    return { notice: readPrivacyNotice(t?.privacyNotice), contact: t?.dpo ?? {} };
  });
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderCard
        title="Privacy notice"
        breadcrumb={[{ label: "Settings", href: "/dashboard/settings" }, { label: "Privacy notice" }]}
      />
      <PrivacyNoticeForm
        initial={data.notice}
        initialContact={{ name: data.contact.name ?? "", email: data.contact.email ?? "", phone: data.contact.phone ?? "" }}
        noticeHref={privacyNoticePath(session.tenantId)}
      />
    </div>
  );
}
