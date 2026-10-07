/**
 * Financial Discovery — in-meeting editor. Loads the fact-find and hands it to
 * the live-recalc editor. Gated to lead/client viewers.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { financialDiscoveries } from "@/db/schema";
import { DiscoveryEditor } from "@/components/discovery/DiscoveryEditor";
import { syncDiscoveryPrefill } from "@/lib/discovery/prefill";
import { assertCanEditSubject, discoveryScopeSql } from "@/lib/discovery/access";
import { recordDiffs } from "@/lib/discovery/record-diff";
import { RecordChanges } from "@/components/discovery/RecordChanges";

export const dynamic = "force-dynamic";

export default async function DiscoveryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  requireAny(session.roles, ["investor.view.all", "investor.view.assigned", "lead.view.all", "lead.view.assigned"], session.permissions);
  const { id } = await params;

  const loaded = await withTenant(session.tenantId, async (tx) => {
    // Only a fact-find whose client / lead the viewer can see (lib/discovery/access).
    const d = (await tx.select().from(financialDiscoveries)
      .where(and(eq(financialDiscoveries.id, id), await discoveryScopeSql(tx, session))).limit(1))[0];
    if (!d) return null;
    // Fill any blanks from the client / lead record and refresh the risk
    // profile on record — a draft opened today shows today's record.
    const data = await syncDiscoveryPrefill(tx, d as any);
    // What the client changed that the record does not have yet.
    const diffs = d.status === "submitted" || d.status === "reviewed"
      ? await recordDiffs(tx, session.tenantId, d.subjectType, d.subjectId, data)
      : [];
    const canEdit = diffs.length
      ? await assertCanEditSubject(tx, session, d.subjectType, d.subjectId).then(() => true, () => false)
      : false;
    return { disc: d, data, diffs, canEdit };
  });
  if (!loaded) notFound();
  const { disc, data, diffs, canEdit } = loaded;

  const subjectHref = disc.subjectType === "lead" ? `/dashboard/leads/${disc.subjectId}` : `/dashboard/investors/${disc.subjectId}`;

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Link href="/dashboard/discovery" className="hover:underline inline-flex items-center gap-1">
            <ChevronLeft className="size-3" /> Discovery &amp; Suitability
          </Link>
        </div>
        <h1 className="page-title">{disc.title || "Discovery & Suitability"}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {disc.reviewType ? `${disc.reviewType} · ` : ""}
          <Link href={subjectHref} className="text-primary hover:underline">{disc.subjectType === "lead" ? "Lead" : "Client"} record →</Link>
        </p>
      </div>

      <RecordChanges discoveryId={disc.id} diffs={diffs} subjectType={disc.subjectType} subjectId={disc.subjectId} canEdit={canEdit} />

      <DiscoveryEditor id={disc.id} initialData={data} status={disc.status} subjectType={disc.subjectType} subjectId={disc.subjectId} />
    </div>
  );
}
