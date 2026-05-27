import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { ChevronLeft, ScrollText } from "lucide-react";
import { withTenant } from "@/db/client";
import { sops, sopVersions, sopAcknowledgements } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SopDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const sop = (await tx.select().from(sops).where(eq(sops.id, id)).limit(1))[0];
    if (!sop) return null;
    const versions = await tx
      .select()
      .from(sopVersions)
      .where(eq(sopVersions.sopId, id))
      .orderBy(desc(sopVersions.createdAt));
    const current = versions.find((v) => v.id === sop.currentVersionId);
    const acks = current
      ? await tx
          .select()
          .from(sopAcknowledgements)
          .where(eq(sopAcknowledgements.sopVersionId, current.id))
      : [];
    return { sop, versions, current, acks };
  });
  if (!data) notFound();

  return (
    <div className="space-y-6 max-w-4xl">
      <Link href="/dashboard/sops" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to SOPs
      </Link>

      <div className="border rounded-lg bg-card p-6">
        <div className="flex items-start gap-4">
          <ScrollText className="size-8 text-muted-foreground mt-1" />
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">{data.sop.title}</h1>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span className="font-mono">{data.sop.key}</span>
              {data.sop.category && <span>· {data.sop.category}</span>}
              {data.current && <span>· v{data.current.versionNumber}</span>}
              <span>· {data.acks.length} acknowledged</span>
            </div>
            {(data.sop.requiredRoles ?? []).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(data.sop.requiredRoles ?? []).map((r: string) => (
                  <span key={r} className="text-xs px-1.5 py-0.5 rounded bg-muted">{r}</span>
                ))}
              </div>
            )}
          </div>
          <button className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium">
            Acknowledge
          </button>
        </div>
      </div>

      {data.current && (
        <div className="border rounded-lg bg-card p-6">
          <h2 className="font-semibold mb-3">Current version (v{data.current.versionNumber})</h2>
          <p className="text-xs text-muted-foreground">
            Published {data.current.publishedAt ? formatDate(data.current.publishedAt) : "—"}
          </p>
          <div className="prose prose-sm max-w-none mt-3 whitespace-pre-wrap">
            {(data.current.body as any)?.markdown ?? JSON.stringify(data.current.body, null, 2)}
          </div>
        </div>
      )}

      {data.versions.length > 1 && (
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold mb-3">Version history</h2>
          <ul className="divide-y text-sm">
            {data.versions.map((v) => (
              <li key={v.id} className="py-2 flex items-center justify-between">
                <span>v{v.versionNumber}</span>
                <span className="text-xs text-muted-foreground">
                  {v.publishedAt ? formatDate(v.publishedAt) : "draft"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
