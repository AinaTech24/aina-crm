import { Wallet } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { canManagePayroll, canViewPayroll } from "@/lib/payroll/access";
import { loadPayrollSettings } from "@/lib/payroll/run";
import { PayrollTabs } from "@/components/payroll/PayrollShared";
import { PayrollSettingsForm } from "./PayrollSettingsForm";

export const dynamic = "force-dynamic";

export default async function PayrollSettingsPage() {
  const session = await requireSession();
  if (!canViewPayroll(session)) {
    return <div className="mt-6"><EmptyState icon={Wallet} title="Payroll is kept by the owner" description="Your own payslips are in My pay." primary={{ href: "/dashboard/my-pay", label: "Open My pay" }} /></div>;
  }
  const settings = await withTenant(session.tenantId, (tx) => loadPayrollSettings(tx, session.tenantId));
  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeaderCard title="Payroll" />
      <PayrollTabs active="settings" />
      <PayrollSettingsForm initial={settings} canManage={canManagePayroll(session)} />
    </div>
  );
}
