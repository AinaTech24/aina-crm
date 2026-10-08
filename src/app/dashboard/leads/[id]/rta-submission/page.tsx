/**
 * Submitted to RTA — the physical route's submission page (journey step
 * "Submitted to RTA" / "Resubmit to RTA"). `back` is where Cancel and Save return.
 */

import { notFound, redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { loadEditableLead } from "@/lib/leads/access";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { RtaSubmissionForm } from "@/components/leads/RtaSubmissionForm";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RtaSubmissionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { id } = await params;
  const { back } = await searchParams;
  if (!UUID_RE.test(id)) redirect("/dashboard/leads");
  // Only an in-app path — never another site.
  const backHref = back && back.startsWith("/dashboard/") && !back.startsWith("//") ? back : `/dashboard/leads/${id}`;

  const session = await requireSession();
  if (!can(session.roles, "lead.edit.all", session.permissions) && !can(session.roles, "lead.edit.assigned", session.permissions)) {
    redirect(backHref);
  }
  const found = await withTenant(session.tenantId, async (tx) => {
    const lead = await loadEditableLead(tx, session, id).catch(() => null);
    if (!lead) return null;
    const stage = ((await tx.execute(sql`
      SELECT current_stage_key FROM lead_blueprint_instances WHERE tenant_id = ${session.tenantId}::uuid AND lead_id = ${id}::uuid
    `)).rows[0] as { current_stage_key?: string } | undefined)?.current_stage_key ?? null;
    return { lead, stage };
  }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });
  if (!found) notFound();
  const { lead, stage } = found;
  const prev = ((lead as any).rtaSubmission ?? null) as { rta?: string; amcName?: string; centre?: string } | null;
  const resubmit = stage === "rta_rejected";

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeaderCard
        title={resubmit ? "Resubmit to RTA" : "Submitted to RTA"}
        subtitle={lead.name}
        breadcrumb={[{ label: lead.name, href: backHref }, { label: resubmit ? "Resubmit to RTA" : "Submitted to RTA" }]}
      />
      <RtaSubmissionForm leadId={id} backHref={backHref} prev={prev} resubmit={resubmit} />
    </div>
  );
}
