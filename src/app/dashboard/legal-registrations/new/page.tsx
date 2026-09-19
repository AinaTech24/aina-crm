import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { tenants } from "@/db/schema";
import { LegalRegistrationForm } from "@/components/legal-registrations/LegalRegistrationForm";

export const dynamic = "force-dynamic";

export default async function NewLegalRegistrationPage() {
  const session = await requireSession();
  requireCap(session.roles, "compliance.edit", session.permissions);

  // Seed "Registered in name of" with the tenant display name so the
  // common case is one click.
  const tenant = await withTenant(session.tenantId, async (tx) => {
    return (
      await tx
        .select({ displayName: tenants.displayName, legalName: tenants.legalName })
        .from(tenants)
        .where(eq(tenants.id, session.tenantId))
        .limit(1)
    )[0];
  });

  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeaderCard title={<>Add a registration</>} />
      <LegalRegistrationForm
        mode="create"
        defaultRegisteredInNameOf={tenant?.displayName ?? tenant?.legalName ?? ""}
      />
    </div>
  );
}
