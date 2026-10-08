/**
 * Update client information — the journey's "Update Client Information" step:
 * the required details still missing from the client master, on one page.
 * `back` is where Cancel and Save return to.
 */

import { notFound, redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { loadEditableLead } from "@/lib/leads/access";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { CollectDetailsForm } from "@/components/leads/CollectDetailsForm";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function UpdateInformationPage({
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
  // The same rule /api/leads/[id]/capture-kyc applies.
  if (!can(session.roles, "lead.edit.all", session.permissions) && !can(session.roles, "lead.edit.assigned", session.permissions)) {
    redirect(backHref);
  }
  const lead = await withTenant(session.tenantId, (tx) => loadEditableLead(tx, session, id).catch(() => null),
    { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });
  if (!lead) notFound();

  return (
    <div className="space-y-5">
      <PageHeaderCard
        title="Update client information"
        subtitle={lead.name}
        breadcrumb={[{ label: lead.name, href: backHref }, { label: "Update information" }]}
      />
      <CollectDetailsForm leadId={id} backHref={backHref} mode="update" />
    </div>
  );
}
