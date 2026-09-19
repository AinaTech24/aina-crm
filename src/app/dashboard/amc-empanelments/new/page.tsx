import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { AmcEmpanelmentForm } from "@/components/amc-empanelments/AmcEmpanelmentForm";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function NewAmcEmpanelmentPage() {
  const session = await requireSession();
  requireCap(session.roles, "compliance.edit", session.permissions);

  // Load AMC catalog (amc_master) for the dropdown — display name +
  // code. Tenant-scoped query in case some tenants prune the catalog.
  const amcs = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT code, name FROM amc_master
      ORDER BY name ASC LIMIT 200
    `);
    return r.rows as Array<{ code: string; name: string }>;
  });

  return (
    <div className="space-y-5 w-full max-w-3xl">
      <PageHeaderCard title={<>Add an empanelment</>} />
      <AmcEmpanelmentForm mode="create" amcCatalog={amcs} />
    </div>
  );
}
