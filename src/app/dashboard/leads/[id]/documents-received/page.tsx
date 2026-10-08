/**
 * Confirm documents received — the full-page form behind the journey's
 * "Documents Received" step, opened from the lead page or the client page.
 * `back` is where Cancel and Save return to.
 */

import { notFound, redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { loadEditableLead } from "@/lib/leads/access";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { CollectDetailsForm } from "@/components/leads/CollectDetailsForm";
import { LeadAttachments } from "@/components/leads/LeadAttachments";
import { InvestorDocumentsSection } from "@/components/investors/InvestorDocumentsSection";
import { investors } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DocumentsReceivedPage({
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
  const found = await withTenant(session.tenantId, async (tx) => {
    const lead = await loadEditableLead(tx, session, id).catch(() => null);
    if (!lead) return null;
    // Once converted, documents belong to the client record.
    const [client] = lead.convertedInvestorId
      ? await tx.select({ id: investors.id, name: investors.name, phone: investors.phone, email: investors.email })
          .from(investors).where(eq(investors.id, lead.convertedInvestorId)).limit(1)
      : [];
    return { lead, client: client ?? null };
  }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });
  if (!found) notFound();
  const { lead, client } = found;

  return (
    <div className="space-y-5">
      <PageHeaderCard
        title="Confirm documents received — fill the client's details"
        subtitle={lead.name}
        breadcrumb={[{ label: lead.name, href: backHref }, { label: "Documents received" }]}
      />
      {client ? (
        <InvestorDocumentsSection investorId={client.id} investorName={client.name} investorPhone={client.phone} investorEmail={client.email} />
      ) : (
        <LeadAttachments leadId={id} leadName={lead.name} />
      )}
      <CollectDetailsForm leadId={id} backHref={backHref} />
    </div>
  );
}
