import { sql } from "drizzle-orm";
import { Workflow } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { SalesOpsManager } from "@/components/sales-ops/SalesOpsManager";

export const dynamic = "force-dynamic";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head", "compliance"].includes(r));

export default async function SalesOpsPage() {
  const session = await requireSession();
  if (!isManager(session.roles)) {
    return <div className="max-w-2xl card-surface p-8 text-center text-sm text-muted-foreground">Sales-Ops automation is configured by owners / branch heads / compliance.</div>;
  }

  const data = await withTenant(session.tenantId, async (tx) => {
    const t = session.tenantId;
    const users = (await tx.execute(sql`SELECT id, name FROM users WHERE tenant_id=${t}::uuid AND status='active' AND ('rm' = ANY(roles) OR 'branch_head' = ANY(roles)) ORDER BY name`)).rows;
    const assignment = (await tx.execute(sql`SELECT * FROM assignment_rules WHERE tenant_id=${t}::uuid ORDER BY priority, created_at DESC`)).rows;
    const macros = (await tx.execute(sql`SELECT * FROM macros WHERE tenant_id=${t}::uuid ORDER BY created_at DESC`)).rows;
    const validation = (await tx.execute(sql`SELECT * FROM validation_rules WHERE tenant_id=${t}::uuid ORDER BY created_at DESC`)).rows;
    const cadences = (await tx.execute(sql`SELECT * FROM cadences WHERE tenant_id=${t}::uuid ORDER BY created_at DESC`)).rows;
    return { users, assignment, macros, validation, cadences };
  }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Workflow className="size-6 text-brand-cyan" /> Sales-Ops Automation</h1>
        <p className="text-muted-foreground text-sm">Zoho-style platform rules for your MFD CRM: auto-assign leads, one-click macros, data-quality gates, and nurture cadences.</p>
      </div>
      <SalesOpsManager
        users={data.users as any}
        assignment={data.assignment as any}
        macros={data.macros as any}
        validation={data.validation as any}
        cadences={data.cadences as any}
      />
    </div>
  );
}
