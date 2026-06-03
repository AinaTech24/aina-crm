import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { Upload } from "lucide-react";
import { withTenant } from "@/db/client";
import { complianceDocuments } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { DocumentsFeed } from "@/components/compliance/DocumentsFeed";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const stats = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE expires_on IS NOT NULL
          AND expires_on <= current_date + interval '30 days'
          AND expires_on >= current_date)::int AS expiring_soon,
        COUNT(*) FILTER (WHERE expires_on IS NOT NULL
          AND expires_on < current_date)::int AS expired
      FROM compliance_documents
    `);
    const s = stats.rows[0] as any;
    const rows = await tx.select().from(complianceDocuments).orderBy(desc(complianceDocuments.createdAt)).limit(100);
    return {
      total: Number(s.total),
      expiringSoon: Number(s.expiring_soon),
      expired: Number(s.expired),
      rows,
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
