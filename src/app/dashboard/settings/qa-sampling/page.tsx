import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { EmptyState } from "@/components/common/EmptyState";
import { ClipboardCheck } from "lucide-react";
import { QA_CORRECTION_TYPE, QA_REVIEW_TYPE, loadQaSettings } from "@/lib/qa/sampling";
import { QaSamplingForm } from "./QaSamplingForm";

export const dynamic = "force-dynamic";

/** Settings → QA sampling (lib/qa/sampling.ts): what share of each person's completed work is checked each week. */
export default async function QaSamplingSettingsPage() {
  const session = await requireSession();
  if (!can(session.roles, "settings.dashboard", session.permissions)) {
    return (
      <div className="mt-6">
        <EmptyState
          icon={ClipboardCheck}
          title="Only an administrator can change QA sampling"
          description="It decides how much of the team's completed work is checked each week. Ask the firm owner if it needs to change."
          primary={{ href: "/dashboard/settings", label: "Back to settings" }}
        />
      </div>
    );
  }

  const { qa, types } = await withTenant(session.tenantId, async (tx) => ({
    qa: await loadQaSettings(tx, session.tenantId),
    types: ((await tx.execute(sql`
      SELECT type FROM tasks
       WHERE tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL AND status = 'completed'
         AND type NOT IN (${QA_REVIEW_TYPE}, ${QA_CORRECTION_TYPE})
       GROUP BY type ORDER BY count(*) DESC LIMIT 60
    `)).rows as Array<{ type: string }>).map((r) => r.type),
  }));

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeaderCard
        title="QA sampling"
        breadcrumb={[{ label: "Settings", href: "/dashboard/settings" }, { label: "QA sampling" }]}
      />
      <QaSamplingForm initial={qa} types={types} />
    </div>
  );
}
