import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { GraduationCap } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { SIDEBAR_REGISTRY } from "@/lib/nav/sidebar-registry";
import { InductionManager } from "@/components/induction/InductionManager";

export const dynamic = "force-dynamic";

export default async function InductionSettingsPage() {
  const session = await requireSession();
  requireCap(session.roles, "induction.manage", session.permissions);

  // The unlockable set is exactly the sidebar registry — the engine rejects
  // anything outside it, so the picker and the validator agree.
  const moduleOptions = SIDEBAR_REGISTRY.map((e) => ({
    href: e.href,
    label: e.label,
    group: e.group,
  }));

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <PageHeaderCard title={<><GraduationCap className="size-6 text-muted-foreground" /> Induction</>} />

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <strong>Module unlocking controls what a member SEES, not what they can access.</strong> The
        sidebar hides locked modules, but permissions still come from the member's role — use roles
        to withhold data, and induction to keep a new joiner's first week uncluttered.
      </div>

      <InductionManager moduleOptions={moduleOptions} />
    </div>
  );
}
