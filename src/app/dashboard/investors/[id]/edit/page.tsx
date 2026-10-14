/** Edit a client's details — the full-page form behind the client page's pencil. */

import { notFound, redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { loadTenantLicense } from "@/lib/auth/license";
import { isFieldAllowed } from "@/lib/auth/field-gate";
import { loadViewableInvestor } from "@/lib/investors/access";
import { guardianForViewer, redactHiddenGuardianRisk } from "@/lib/investors/guardian-link";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { ClientDetailsForm, type ClientFamilyContext } from "@/components/investors/ClientDetailsForm";
import { sql } from "drizzle-orm";
import { familySharedDetails } from "@/lib/families/shared-details";

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

  // The client, their family (what the family owns is shown, not asked:
  // lib/families/shared-details.ts) and, for a minor, the guardian's record.
  const loaded = await withTenant(session.tenantId, async (tx) => {
    const inv = await loadViewableInvestor(tx, session, id);
    if (!inv) return null;
    let family: ClientFamilyContext | null = null;
    if ((inv as any).familyId) {
      const shared = await familySharedDetails(tx, (inv as any).familyId);
      const f = (await tx.execute(sql`
        SELECT f.id, COALESCE(f.family_name, f.head_name) AS name, h.name AS head_name
          FROM families f LEFT JOIN investors h ON h.id = f.primary_investor_id AND h.tenant_id = f.tenant_id
         WHERE f.id = ${(inv as any).familyId}::uuid AND f.tenant_id = ${session.tenantId}::uuid LIMIT 1`)).rows[0] as { id: string; name: string; head_name: string | null } | undefined;
      if (f) {
        family = {
          id: f.id, name: f.name, headName: f.head_name, isHead: shared.headId === id,
          headHasAddress: !!shared.address, reviewFrequency: shared.reviewFrequency,
        };
      }
    }
    // The guardian's record only when this user may open it (G-1): otherwise
    // the form learns that a guardian is linked, never who, and the minor's
    // own risk fields — the guardian's copy (migration 0234) — are blanked.
    const guardian = await guardianForViewer(tx, session, inv.guardianInvestorId);
    const shown = guardian?.hidden ? await redactHiddenGuardianRisk(tx, session, inv) : inv;
    return { inv: shown as typeof inv, family, guardian };
  }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });
  if (!loaded) notFound();
  const { inv, family, guardian } = loaded;
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
      <ClientDetailsForm investor={JSON.parse(JSON.stringify(inv))} flags={flags} family={family} guardian={guardian} />
    </div>
  );
}
