import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { Settings2 } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { loadCalcAssumptions } from "@/lib/calculators/assumptions";
import { CalcAssumptionsForm } from "@/components/calculators/CalcAssumptionsForm";

export const dynamic = "force-dynamic";

export default async function CalculatorSettingsPage() {
  const session = await requireSession();
  const canManage = session.roles.some((r) => ["owner", "branch_head"].includes(r));

  const settings = await withTenant(session.tenantId, async (tx) => {
    return loadCalcAssumptions(tx, session.tenantId);
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeaderCard title={<><Settings2 className="size-6 text-muted-foreground" /> Calculator assumptions</>} />

      <CalcAssumptionsForm initial={settings} canManage={canManage} />
    </div>
  );
}
