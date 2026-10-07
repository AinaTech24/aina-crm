import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db/client";
import { businessEntries, businessEntryLines } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { isClientVisible } from "@/lib/transactions/client-scope";
import { BusinessEntryForm } from "@/components/business/BusinessEntryForm";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["owner", "branch_head", "rm", "back_office", "ops"];

export default async function EditBusinessEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session.roles.some((r) => MANAGE_ROLES.includes(r))) redirect("/dashboard");
  const { id } = await params;

  const data = await withTenant(session.tenantId, async (tx) => {
    const [entry] = await tx
      .select()
      .from(businessEntries)
      .where(and(eq(businessEntries.id, id), eq(businessEntries.tenantId, session.tenantId)))
      .limit(1);
    if (!entry) return null;
    // Same rule as GET /api/business-entries/[id]: an RM opens only their own
    // bookings, and nobody opens one on a client outside their scope.
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "reports.business", session.permissions);
    if (!seesAll && entry.rmId !== session.userId) return null;
    if (entry.rmId !== session.userId && !(await isClientVisible(tx, session, entry.investorId))) return null;
    const lines = await tx
      .select()
      .from(businessEntryLines)
      .where(eq(businessEntryLines.entryId, id))
      .orderBy(asc(businessEntryLines.sortOrder));
    const r = await tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' ORDER BY name ASC`);
    return { entry, lines, members: (r.rows as any[]).map((m) => ({ id: String(m.id), name: m.name ?? "—" })) };
  });
  if (!data) notFound();

  const e = data.entry;
  return (
    <div className="space-y-5 max-w-5xl">
<PageHeaderCard title={<>Edit business entry</>} />
<BusinessEntryForm
        initial={{
          id: e.id,
          investorId: e.investorId,
          clientName: e.clientName,
          productType: e.productType,
          businessDate: String(e.businessDate),
          status: e.status,
          rmId: e.rmId,
          amcName: e.amcName,
          folioNo: e.folioNo,
          notes: e.notes,
        }}
        initialLines={data.lines}
        members={data.members}
        currentUserId={session.userId}
      />
</div>
  );
}
