import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { EmptyState } from "@/components/common/EmptyState";
import { BellRing } from "lucide-react";
import { loadLadder } from "@/lib/tasks/escalation-ladder";
import { EscalationForm } from "./EscalationForm";

export const dynamic = "force-dynamic";

/**
 * Settings → Escalation (lib/tasks/escalation-ladder.ts): how many hours an
 * overdue task waits before it reaches the assignee's manager, the branch
 * head and the owner — per department, task type or priority.
 */
export default async function EscalationSettingsPage() {
  const session = await requireSession();
  if (!can(session.roles, "settings.dashboard", session.permissions)) {
    return (
      <div className="mt-6">
        <EmptyState
          icon={BellRing}
          title="Only an administrator can change the escalation ladder"
          description="It decides who hears about overdue work across the firm. Ask the firm owner if it needs to change."
          primary={{ href: "/dashboard/settings", label: "Back to settings" }}
        />
      </div>
    );
  }

  const { ladder, types } = await withTenant(session.tenantId, async (tx) => ({
    ladder: await loadLadder(tx, session.tenantId),
    // The task types this firm actually uses, most used first.
    types: ((await tx.execute(sql`
      SELECT type FROM tasks WHERE tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL AND type IS NOT NULL
       GROUP BY type ORDER BY count(*) DESC LIMIT 60
    `)).rows as Array<{ type: string }>).map((r) => r.type),
  }));

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeaderCard
        title="Escalation"
        breadcrumb={[{ label: "Settings", href: "/dashboard/settings" }, { label: "Escalation" }]}
      />
      <EscalationForm initial={ladder} types={types} />
    </div>
  );
}
