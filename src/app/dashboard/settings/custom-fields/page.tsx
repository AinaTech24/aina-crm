import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { CustomFieldsManager } from "@/components/settings/CustomFieldsManager";

export const dynamic = "force-dynamic";

export default async function CustomFieldsPage() {
  const session = await requireSession();
  requireCap(session.roles, "settings.users", session.permissions);
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeaderCard title={<>Custom fields</>} subtitle={<>Define your own fields on leads &amp; clients — they appear on each record's detail page.</>} />
      <CustomFieldsManager />
    </div>
  );
}
