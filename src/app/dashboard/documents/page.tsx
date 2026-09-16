import Link from "next/link";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Upload, ShieldCheck, ScrollText } from "lucide-react";
import { withTenant } from "@/db/client";
import { complianceDocuments, investors, ddqScores, sops } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { canOpenVault, ownClientDocsOnly, seesWholeVault, vaultScopeFragment } from "@/lib/compliance/document-access";
import { DocumentsFeed } from "@/components/compliance/DocumentsFeed";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const session = await requireSession();

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
  const wholeVault = seesWholeVault(session);
  const scope = ownClientDocsOnly(session);

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
        AND ${vaultScopeFragment(session)}
    `);
    const s = stats.rows[0] as any;
    const rows = await tx
      .select()
      .from(complianceDocuments)
      .where(
        and(
          eq(complianceDocuments.tenantId, session.tenantId),
          isNull(complianceDocuments.supersededById),
          scope
        )
      )
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
    const clientInfo: Record<string, { name: string; email: string | null; phone: string | null; avatarUrl: string | null }> = {};
    if (investorIds.length) {
      const names = await tx
        .select({ id: investors.id, name: investors.name, email: investors.email, phone: investors.phone, avatarUrl: investors.avatarUrl })
        .from(investors)
        .where(inArray(investors.id, investorIds));
      for (const n of names) clientInfo[n.id] = { name: n.name, email: n.email, phone: n.phone, avatarUrl: n.avatarUrl };
    }

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
      rows,
      clientInfo,
    };
  });

  const stats = {
    total: data.total,
    expiringSoon: data.expiringSoon,
    expired: data.expired,
  };

  const initialRows = data.rows.map((row) => {
    const cid = row.relatedEntityType === "investor" && row.relatedEntityId ? (row.relatedEntityId as string) : null;
    const info = cid ? data.clientInfo[cid] : null;
    return {
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
      clientId: cid,
      clientName: info?.name ?? null,
      clientEmail: info?.email ?? null,
      clientPhone: info?.phone ?? null,
      clientAvatar: cid && info?.avatarUrl ? `/api/investors/${cid}/avatar` : null,
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Documents</h1>
          <p className="page-subtitle mt-1">
            {wholeVault
              ? "KYC forms, agreements and statements, filed against the right client."
              : "KYC forms, agreements and statements for the clients you manage."}
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
