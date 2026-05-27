import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db/client";
import { segments, segmentMemberships } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SegmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const seg = (await tx.select().from(segments).where(eq(segments.id, id)).limit(1))[0];
    if (!seg) return null;
    const members = await tx.execute(sql`
      SELECT i.id, i.name, i.pan, i.segment_tag, i.aum, sm.added_at
      FROM segment_memberships sm
      JOIN investors i ON i.id = sm.subject_id
      WHERE sm.segment_id = ${id} AND sm.removed_at IS NULL
      ORDER BY sm.added_at DESC LIMIT 200
    `);
    return { seg, members: members.rows as any[] };
  });
  if (!data) notFound();

  return (
    <div className="space-y-6 max-w-5xl">
      <Link href="/dashboard/segments" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to segments
      </Link>

      <div className="border rounded-lg bg-card p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{data.seg.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">{data.seg.description ?? "No description."}</p>
            <div className="flex items-center gap-3 mt-2 text-xs">
              <span className="px-2 py-0.5 rounded-full bg-muted">{data.seg.kind}</span>
              <span className="text-muted-foreground">{data.seg.subjectType}</span>
              {data.seg.lastMaterializedAt && (
                <span className="text-muted-foreground">refreshed {formatRelative(data.seg.lastMaterializedAt)}</span>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold tabular-nums">{data.seg.memberCount ?? 0}</div>
            <div className="text-xs text-muted-foreground">members</div>
          </div>
        </div>
      </div>

      <div className="border rounded-lg bg-card p-5">
        <h2 className="font-semibold mb-3">Criteria (AST)</h2>
        <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">{JSON.stringify(data.seg.ast, null, 2)}</pre>
      </div>

      <div className="border rounded-lg bg-card">
        <div className="border-b px-4 py-2.5 font-medium">Members</div>
        {data.members.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No members yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left py-2 font-medium">PAN</th>
                <th className="text-left py-2 font-medium">Segment</th>
                <th className="text-right py-2 font-medium pr-4">Added</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m: any) => (
                <tr key={m.id} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/investors/${m.id}`} className="hover:underline">{m.name}</Link>
                  </td>
                  <td className="py-3 font-mono text-xs">{m.pan}</td>
                  <td className="py-3 text-xs">{m.segment_tag ?? "—"}</td>
                  <td className="py-3 text-right pr-4 text-xs text-muted-foreground">{formatRelative(m.added_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
