/**
 * Deleted leads — restore one deleted by mistake (audit L20).
 *
 * Only the people who may restore (canRestoreLeads: owner, branch heads, lead
 * managers) open it, and they see only the deleted leads in their own lead
 * scope (leadScopeSql). Restore is POST /api/leads/[id]/restore.
 */

import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { Trash2 } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { canRestoreLeads, leadScopeSql, requireLeadView } from "@/lib/leads/access";
import { DeletedLeadsTable, type DeletedLeadRow } from "@/components/leads/DeletedLeadsTable";

export const dynamic = "force-dynamic";

export default async function DeletedLeadsPage() {
  const session = await requireSession();
  requireLeadView(session);
  if (!canRestoreLeads(session)) redirect("/dashboard/leads");

  const rows = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT l.id, l.name, l.phone, l.email, l.source, l.lost_at, u.name AS owner_name
        FROM leads l LEFT JOIN users u ON u.id = l.owner_id
       WHERE l.tenant_id = ${session.tenantId}::uuid
         AND l.lost_reason = '__deleted__'
         AND ${leadScopeSql(session, "l")}
       ORDER BY l.lost_at DESC NULLS LAST
       LIMIT 300
    `);
    return (r.rows as any[]).map((x): DeletedLeadRow => ({
      id: x.id,
      name: x.name,
      phone: x.phone ?? null,
      email: x.email ?? null,
      source: x.source ?? null,
      deletedAt: x.lost_at ? new Date(x.lost_at).toISOString() : null,
      ownerName: x.owner_name ? String(x.owner_name).replace(/\s*\([^)]*\)\s*$/, "") : null,
    }));
  });

  return (
    <div className="space-y-4 max-w-6xl">
      <PageHeaderCard title={<><Trash2 className="size-6 text-muted-foreground" /> Deleted leads</>} />
      <DeletedLeadsTable rows={rows} />
    </div>
  );
}
