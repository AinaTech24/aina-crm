import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { legalRegistrations } from "@/db/schema";
import { LegalRegistrationForm } from "@/components/legal-registrations/LegalRegistrationForm";
import { RecordProvenance } from "@/components/common/RecordProvenance";

export const dynamic = "force-dynamic";

export default async function LegalRegistrationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  requireCap(session.roles, "compliance.edit", session.permissions);
  const { id } = await params;

  const row = await withTenant(session.tenantId, async (tx) => {
    const [r] = await tx
      .select()
      .from(legalRegistrations)
      .where(eq(legalRegistrations.id, id))
      .limit(1);
    return r;
  });
  if (!row) notFound();

  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeaderCard title={<>{row.registrationFor}</>} subtitle={<>{row.registeredInNameOf}
          {row.registrationNumber && ` · ${row.registrationNumber}`} · {row.status}</>}>
<RecordProvenance
          entityType="legal_registration"
          entityId={row.id}
          createdAt={row.createdAt}
          updatedAt={row.updatedAt}
          className="mt-1"
        />
</PageHeaderCard>
      <LegalRegistrationForm
        mode="edit"
        initial={{
          id: row.id,
          registeredInNameOf: row.registeredInNameOf,
          authority: row.authority,
          authorityOther: row.authorityOther,
          registrationFor: row.registrationFor,
          registrationNumber: row.registrationNumber,
          registrationDate: row.registrationDate
            ? String(row.registrationDate)
            : null,
          expiryAt: row.expiryAt ? String(row.expiryAt) : null,
          renewalFrequency: row.renewalFrequency,
          renewalDetails: row.renewalDetails,
          status: row.status,
          documents: (row.documents ?? []) as any[],
          remarks: row.remarks,
        }}
      />
    </div>
  );
}
