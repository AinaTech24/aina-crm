/** Edit a client's details — the full-page form behind the client page's pencil. */

import { notFound, redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { loadTenantLicense } from "@/lib/auth/license";
import { isFieldAllowed } from "@/lib/auth/field-gate";
import { loadViewableInvestor } from "@/lib/investors/access";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { ClientDetailsForm } from "@/components/investors/ClientDetailsForm";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditClientDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) redirect("/dashboard/investors");
  const session = await requireSession();
  const clientHref = `/dashboard/investors/${id}`;

  // The same rule PATCH /api/investors/[id] applies, so nobody fills in a form
  // that cannot be saved: edit.all edits any client they can see; edit.assigned
  // edits their branch's (branch head) or their own.
  const editsAll = can(session.roles, "investor.edit.all", session.permissions);
  if (!editsAll && !can(session.roles, "investor.edit.assigned", session.permissions)) redirect(clientHref);

  const inv = await withTenant(session.tenantId, (tx) => loadViewableInvestor(tx, session, id),
    { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });
  if (!inv) notFound();
  if (!editsAll) {
    const branchScoped = !session.roles.includes("owner") && session.roles.includes("branch_head") && !!session.branchId;
    if (branchScoped ? inv.branchId !== session.branchId : inv.rmId !== session.userId) redirect(clientHref);
  }

  const license = await loadTenantLicense(session.tenantId, session.roles);
  const allowed = (...fields: string[]) => fields.some((f) => isFieldAllowed(license, "investor", f));
  const flags = {
    showPan: allowed("pan"),
    showDob: allowed("dob"),
    showPhone: allowed("phone"),
    showEmail: allowed("email"),
    showAddress: allowed("address", "city", "state", "pincode"),
    showSegment: allowed("segment_tag", "segment"),
    showKyc: allowed("kyc_status", "kyc"),
    showRisk: allowed("risk_profile", "risk"),
    showNominee: allowed("nominee_name", "nominee"),
    showBank: allowed("bank_account_number_masked", "bank"),
    showStatus: allowed("status"),
    showRm: allowed("rm_id", "rm"),
    showAum: allowed("aum"),
    showSip: allowed("active_sip_amount", "sip"),
    showInflow: allowed("lifetime_inflow"),
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeaderCard
        title="Edit client details"
        subtitle={inv.name}
        breadcrumb={[{ label: "Clients", href: "/dashboard/investors" }, { label: inv.name, href: clientHref }, { label: "Edit" }]}
      />
      <ClientDetailsForm investor={JSON.parse(JSON.stringify(inv))} flags={flags} />
    </div>
  );
}
