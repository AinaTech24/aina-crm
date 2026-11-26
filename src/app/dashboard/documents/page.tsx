import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { ExportButton } from "@/components/export/ExportButton";
import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { Upload, ShieldCheck, ScrollText } from "lucide-react";
import { withTenant } from "@/db/client";
import { ddqScores, sops } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { canOpenVault, vaultScopeFragment } from "@/lib/compliance/document-access";
import { loadVaultFolders } from "@/lib/compliance/vault-folders";
import { FOLDERS_PER_PAGE, parsePage, parseVaultFilter } from "@/lib/compliance/vault-view";
import { DocumentsFeed } from "@/components/compliance/DocumentsFeed";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const filter = parseVaultFilter(sp.q, sp.category);

  // Compliance / back-office / owner see the whole vault; an RM or branch head
  // sees documents filed against their own clients. Anyone else is told so
  // plainly -- and no longer shown the sidebar link in the first place.
  if (!canOpenVault(session)) {
    return (
      <div className="max-w-2xl mx-auto card-surface p-8 text-center text-sm text-muted-foreground">
        The document vault is available to the compliance and back-office team, and to relationship
        managers for their own clients.
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
        AND superseded_by_id IS NULL
        AND ${await vaultScopeFragment(tx, session)}
    `);
    const s = stats.rows[0] as any;
    // Every folder the viewer may see, a page at a time (nothing is capped to the newest few).
    const vault = await loadVaultFolders(tx, session, filter, parsePage(sp.page));

    // Compliance-readiness signals: latest DDQ score + SOP library size.
    const [ddq] = await tx
      .select({ score: ddqScores.overallScore })
      .from(ddqScores)
      .where(eq(ddqScores.tenantId, session.tenantId))
      .orderBy(desc(ddqScores.computedAt))
      .limit(1);
    const [sopCountRow] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(sops)
      .where(eq(sops.tenantId, session.tenantId));

    return {
      total: Number(s.total),
      expiringSoon: Number(s.expiring_soon),
      expired: Number(s.expired),
      ddqScore: ddq?.score != null ? Number(ddq.score) : null,
      sopCount: Number(sopCountRow?.n ?? 0),
      vault,
    };
  });

  const stats = {
    total: data.total,
    expiringSoon: data.expiringSoon,
    expired: data.expired,
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard title={<>Documents</>} actions={<><ExportButton module="documents" /><Link
          href="/dashboard/documents/upload"
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-primary/95 transition-colors print:hidden"
        >
          <Upload className="size-4" /> Upload document
        </Link></>} />

      <DocumentsFeed
        folders={data.vault.folders}
        totalFolders={data.vault.total}
        page={data.vault.page}
        pageSize={FOLDERS_PER_PAGE}
        q={filter.q}
        category={filter.category}
        stats={stats}
      />
    </div>
  );
}
