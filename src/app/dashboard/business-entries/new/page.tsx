import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { BusinessEntryForm } from "@/components/business/BusinessEntryForm";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["owner", "branch_head", "rm", "back_office", "ops"];

export default async function NewBusinessEntryPage() {
  const session = await requireSession();
  if (!session.roles.some((r) => MANAGE_ROLES.includes(r))) redirect("/dashboard");

  const members = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' ORDER BY name ASC`);
    return (r.rows as any[]).map((m) => ({ id: String(m.id), name: m.name ?? "—" }));
  });

  return (
    <div className="space-y-5 max-w-5xl">
      <Link href="/dashboard/business-entries" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to entries
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">New business closing entry</h1>
      <BusinessEntryForm members={members} currentUserId={session.userId} />
    </div>
  );
}
