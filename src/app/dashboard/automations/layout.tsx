/**
 * /dashboard/automations — one page for what used to be three (Automations,
 * Automation Actions, Automation Monitor): a shared header with the one
 * primary action, and tabs Rules · Actions · Run history.
 *
 * The old routes (/dashboard/workflows/rules, /actions, /runs) redirect here.
 * Rule and run DETAIL pages stay where they are.
 */
import { Workflow } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { requirePageSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { canViewMonitor } from "@/lib/automation/control-tower";
import { AutomationTabs, type AutomationTab } from "@/components/automations/AutomationTabs";
import { NewAutomationButton } from "@/components/automations/NewAutomationButton";

export default async function AutomationsLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePageSession();
  const canEdit = can(session.roles, "workflow.edit", session.permissions);
  // Run history carries run errors and record snapshots — the same ops /
  // compliance audience the old monitor had.
  const tabs: AutomationTab[] = [
    { href: "/dashboard/automations", label: "Rules" },
    { href: "/dashboard/automations/actions", label: "Actions" },
    ...(canViewMonitor(session.roles, session.permissions) ? [{ href: "/dashboard/automations/history", label: "Run history" }] : []),
  ];

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeaderCard
        title={<><Workflow className="size-6 text-muted-foreground" /> Automations</>}
        actions={canEdit ? <NewAutomationButton /> : undefined}
      />
      <AutomationTabs tabs={tabs} />
      {children}
    </div>
  );
}
