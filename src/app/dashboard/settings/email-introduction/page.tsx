import { eq } from "drizzle-orm";
import { Mail } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { withTenant } from "@/db/client";
import { tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { readFirmEmailIntro } from "@/lib/firm/email-intro";
import { EmailIntroForm } from "./EmailIntroForm";

export const dynamic = "force-dynamic";

/**
 * Settings → Email introduction: the company intro, services, office timing,
 * mission and founder every client email can carry as {{firm.*}}, plus the
 * firm's own fields (lib/firm/email-intro.ts).
 */
export default async function EmailIntroductionPage() {
  const session = await requireSession();
  if (!can(session.roles, "settings.users", session.permissions)) {
    return (
      <div className="mt-6">
        <EmptyState
          icon={Mail}
          title="Only an administrator can change the firm's email introduction"
          description="It is the company introduction, services and founder details every client email carries. Ask the firm owner if it needs to change."
          primary={{ href: "/dashboard/settings", label: "Back to settings" }}
        />
      </div>
    );
  }
  const intro = await withTenant(session.tenantId, async (tx) => {
    const [t] = await tx.select({ emailIntro: tenants.emailIntro }).from(tenants).where(eq(tenants.id, session.tenantId));
    return readFirmEmailIntro(t?.emailIntro);
  });
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderCard
        title="Email introduction"
        breadcrumb={[{ label: "Settings", href: "/dashboard/settings" }, { label: "Email introduction" }]}
      />
      <EmailIntroForm initial={intro} />
    </div>
  );
}
