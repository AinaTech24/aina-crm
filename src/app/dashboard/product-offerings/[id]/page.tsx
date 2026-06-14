import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { eq, and, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { productOfferings, users, legalRegistrations } from "@/db/schema";
import { ProductOfferingForm } from "@/components/product-offerings/ProductOfferingForm";
import { RecordProvenance } from "@/components/common/RecordProvenance";

export const dynamic = "force-dynamic";

export default async function ProductOfferingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  requireCap(session.roles, "compliance.edit");
  const { id } = await params;

  const { row, team, registrations } = await withTenant(
    session.tenantId,
    async (tx) => {
      const [row] = await tx
        .select()
        .from(productOfferings)
        .where(eq(productOfferings.id, id))
        .limit(1);
      const team = await tx
        .select({ id: users.id, name: users.name, roles: users.roles })
        .from(users)
        .where(
          and(
            eq(users.tenantId, session.tenantId),
            inArray(users.status, ["active", "offboarding"])
          )
        )
        .orderBy(users.name);
      const registrations = await tx
        .select({
          id: legalRegistrations.id,
          registrationFor: legalRegistrations.registrationFor,
          authority: legalRegistrations.authority,
        })
        .from(legalRegistrations)
        .where(
          and(
            eq(legalRegistrations.tenantId, session.tenantId),
            inArray(legalRegistrations.status, ["active", "pending_renewal"])
          )
        )
        .orderBy(legalRegistrations.registrationFor);
      return { row, team, registrations };
    }
  );
  if (!row) notFound();

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <Link
          href="/dashboard/product-offerings"
          className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
        >
          <ChevronLeft className="size-3" /> Products &amp; services
        </Link>
        <h1 className="text-2xl font-semibold mt-1">{row.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {row.category} · {row.regulator} · {row.status}
        </p>
        <RecordProvenance
          entityType="product_offering"
          entityId={row.id}
          createdAt={row.createdAt}
          updatedAt={row.updatedAt}
          className="mt-1"
        />
      </div>
      <ProductOfferingForm
        mode="edit"
        teamCatalog={team.map((t) => ({
          id: t.id,
          name: t.name,
          roles: (t.roles ?? []) as string[],
        }))}
        registrationCatalog={registrations}
        initial={{
          id: row.id,
          name: row.name,
          category: row.category,
          providers: (row.providers ?? []) as string[],
          regulator: row.regulator,
          linkedRegistrationIds: (row.linkedRegistrationIds ?? []) as string[],
          requiredExams: (row.requiredExams ?? []) as string[],
          teamMemberIds: (row.teamMemberIds ?? []) as string[],
          status: row.status,
          launchedAt: row.launchedAt ? String(row.launchedAt) : null,
          discontinuedAt: row.discontinuedAt
            ? String(row.discontinuedAt)
            : null,
          documents: (row.documents ?? []) as any[],
          remarks: row.remarks,
        }}
      />
    </div>
  );
}
