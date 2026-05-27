import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db/client";
import { templates, templateVersions } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-50 text-gray-700",
  pending_approval: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
  paused: "bg-slate-50 text-slate-700",
};

export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const tpl = (await tx.select().from(templates).where(eq(templates.id, id)).limit(1))[0];
    if (!tpl) return null;
    const ver = tpl.currentVersionId
      ? (await tx.select().from(templateVersions).where(eq(templateVersions.id, tpl.currentVersionId)).limit(1))[0]
      : null;
    return { tpl, ver };
  });
  if (!data) notFound();
  const { tpl, ver } = data;

  return (
    <div className="space-y-6 max-w-4xl">
      <Link href="/dashboard/templates" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to templates
      </Link>

      <div className="border rounded-lg bg-card p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{tpl.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm">
              <span className="font-mono text-muted-foreground">{tpl.key}</span>
              <span className="text-xs uppercase text-muted-foreground">{tpl.channel}</span>
              <span className="text-xs uppercase text-muted-foreground">{tpl.category}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[tpl.status] ?? ""}`}>
                {tpl.status.replace(/_/g, " ")}
              </span>
            </div>
          </div>
          <div className="text-xs text-muted-foreground text-right">
            Version {ver?.versionNumber ?? "—"}<br />
            Compliance: {ver?.complianceScore ?? "—"}/100
          </div>
        </div>
      </div>

      {ver && (
        <>
          <div className="border rounded-lg bg-card p-5">
            <h2 className="font-semibold mb-3">Body</h2>
            <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap font-mono">
              {JSON.stringify(ver.body, null, 2)}
            </pre>
          </div>

          {ver.variables && (ver.variables as any[]).length > 0 && (
            <div className="border rounded-lg bg-card p-5">
              <h2 className="font-semibold mb-3">Variables ({(ver.variables as any[]).length})</h2>
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 font-medium">Key</th>
                    <th className="text-left py-2 font-medium">Type</th>
                    <th className="text-left py-2 font-medium">Source</th>
                    <th className="text-left py-2 font-medium">Required</th>
                  </tr>
                </thead>
                <tbody>
                  {(ver.variables as any[]).map((v: any) => (
                    <tr key={v.key} className="border-b last:border-0">
                      <td className="py-2 font-mono">{v.key}</td>
                      <td className="py-2 text-xs uppercase text-muted-foreground">{v.type}</td>
                      <td className="py-2 font-mono text-xs">{v.source ?? "—"}</td>
                      <td className="py-2 text-xs">{v.required ? "yes" : "no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {ver.complianceChecks && (
            <div className="border rounded-lg bg-card p-5">
              <h2 className="font-semibold mb-3">Compliance findings</h2>
              <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                {JSON.stringify(ver.complianceChecks, null, 2)}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
