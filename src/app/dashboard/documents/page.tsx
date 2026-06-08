import Link from "next/link";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { Upload } from "lucide-react";
import { withTenant } from "@/db/client";
import { complianceDocuments, investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { DocumentsFeed } from "@/components/compliance/DocumentsFeed";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const session = await requireSession();

  // The compliance vault is restricted to the compliance + back-office team
  // (owner wins via can()). Matches the API gate on /api/compliance/documents.
  const canView =
    can(session.roles, "compliance.view", session.permissions) ||
    can(session.roles, "kyc.manage", session.permissions);
  if (!canView) {
    return (
      <div className="max-w-2xl mx-auto card-surface p-8 text-center text-sm text-muted-foreground">
        The document vault is available to the compliance and back-office team.
      </div>
    );
  }

  const data = await withTenant(session.tenantId, async (tx) => {
    // Tenant predicate is mandatory under the superuser/RLS-bypass model — without
    // it both queries return EVERY tenant's compliance documents.
    const stats = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE expires_on IS NOT NULL
          AND expires_on <= current_date + interval '30 days'
          AND expires_on >= current_date)::int AS expiring_soon,
        COUNT(*) FILTER (WHERE expires_on IS NOT NULL
          AND expires_on < current_date)::int AS expired
      FROM compliance_documents
      WHERE tenant_id = ${session.tenantId}::uuid
    `);
    const s = stats.rows[0] as any;
    const rows = await tx
      .select()
      .from(complianceDocuments)
      .where(eq(complianceDocuments.tenantId, session.tenantId))
      .orderBy(desc(complianceDocuments.createdAt))
      .limit(100);

    // Resolve the linked client (investor) name for any doc tagged to one, so
    // the vault shows "which document for which client".
    const investorIds = Array.from(
      new Set(
        rows
          .filter((r) => r.relatedEntityType === "investor" && r.relatedEntityId)
          .map((r) => r.relatedEntityId as string)
      )
    );
    const clientNames: Record<string, string> = {};
    if (investorIds.length) {
      const names = await tx
        .select({ id: investors.id, name: investors.name })
        .from(investors)
        .where(inArray(investors.id, investorIds));
      for (const n of names) clientNames[n.id] = n.name;
    }

    return {
      total: Number(s.total),
      expiringSoon: Number(s.expiring_soon),
      expired: Number(s.expired),
      rows,
      clientNames,
    };
  });

  const stats = {
    total: data.total,
    expiringSoon: data.expiringSoon,
    expired: data.expired,
  };

  const initialRows = data.rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    issuedOn: row.issuedOn,
    expiresOn: row.expiresOn,
    createdAt: row.createdAt,
    clientName:
      row.relatedEntityType === "investor" && row.relatedEntityId
        ? data.clientNames[row.relatedEntityId] ?? null
        : null,
  }));

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
          <p className="text-muted-foreground text-sm">
            Encrypted vault — KYC, mandates, AMC empanelment, DDQ, SOPs, complaints.
          </p>
        </div>
        <Link
          href="/dashboard/documents/upload"
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-primary/95 transition-colors print:hidden"
        >
          <Upload className="size-4" /> Upload document
        </Link>
      </div>

      <DocumentsFeed initialRows={initialRows} stats={stats} />
    </div>
  );
}
