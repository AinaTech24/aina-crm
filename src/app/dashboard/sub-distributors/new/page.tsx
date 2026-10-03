import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { SubDistributorForm } from "@/components/sub-distributors/SubDistributorForm";

export const dynamic = "force-dynamic";

export default async function NewSubDistributorPage() {
  const session = await requireSession();
  requireCap(session.roles, "compliance.edit", session.permissions);

  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeaderCard title={<>Register a sub-distributor</>} />
      <SubDistributorForm mode="create" />
    </div>
  );
}
