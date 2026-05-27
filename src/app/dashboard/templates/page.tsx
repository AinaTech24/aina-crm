import Link from "next/link";
import { desc } from "drizzle-orm";
import { Plus, MessageSquare, Mail, MessageCircle } from "lucide-react";
import { withTenant } from "@/db/client";
import { templates, templateVersions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { RowActions } from "@/components/common/RowActions";

const channelIcons = { whatsapp: MessageCircle, email: Mail, sms: MessageSquare, inapp: MessageSquare };
const statusColors: Record<string, string> = {
  approved: "bg-emerald-50 text-emerald-700",
  pending_approval: "bg-amber-50 text-amber-700",
  rejected: "bg-rose-50 text-rose-700",
  draft: "bg-gray-50 text-gray-700",
  paused: "bg-slate-50 text-slate-700",
  archived: "bg-zinc-50 text-zinc-700",
};

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const session = await requireSession();
  const rows = await withTenant(session.tenantId, async (tx) => {
    return tx
      .select({
        tpl: templates,
        score: templateVersions.complianceScore,
      })
      .from(templates)
      .leftJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
      .orderBy(desc(templates.updatedAt));
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Templates</h1>
          <p className="text-muted-foreground text-sm">
            Channel-agnostic logical templates. Versioned. Compliance-checked before approval.
          </p>
        </div>
        <Link
          href="/dashboard/templates/new"
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
        >
          <Plus className="size-4" /> New template
        </Link>
      </div>

      <div className="border rounded-lg bg-card">
        <div className="border-b px-4 py-2.5 flex gap-2">
          <button className="text-xs rounded-md bg-accent px-2.5 py-1 font-medium">All</button>
          <button className="text-xs rounded-md px-2.5 py-1 text-muted-foreground hover:bg-accent">WhatsApp</button>
          <button className="text-xs rounded-md px-2.5 py-1 text-muted-foreground hover:bg-accent">Email</button>
          <button className="text-xs rounded-md px-2.5 py-1 text-muted-foreground hover:bg-accent">SMS</button>
        </div>
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No templates yet.{" "}
            <Link href="/dashboard/templates/new" className="text-primary hover:underline">
              Create your first
            </Link>
            .
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left py-2 font-medium">Channel</th>
                <th className="text-left py-2 font-medium">Category</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="text-left py-2 font-medium">Compliance</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ tpl, score }) => {
                const Icon = channelIcons[tpl.channel as keyof typeof channelIcons] ?? MessageSquare;
                return (
                  <tr key={tpl.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/templates/${tpl.id}`}
                        className="font-medium hover:underline"
                      >
                        {tpl.name}
                      </Link>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">{tpl.key}</div>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-1.5">
                        <Icon className="size-3.5 text-muted-foreground" />
                        <span className="capitalize text-xs">{tpl.channel}</span>
                      </div>
                    </td>
                    <td className="py-3">
                      <span className="text-xs uppercase font-medium text-muted-foreground">{tpl.category}</span>
                    </td>
                    <td className="py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[tpl.status] ?? ""}`}>
                        {tpl.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="py-3">
                      <ScoreBar score={Number(score ?? 0)} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RowActions
                        editHref={`/dashboard/templates/${tpl.id}`}
                        deleteUrl={`/api/templates/${tpl.id}`}
                        itemLabel="template"
                        itemName={tpl.name}
                        verb="Archive"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  if (!score) return <span className="text-xs text-muted-foreground">—</span>;
  const color = score >= 90 ? "bg-emerald-500" : score >= 70 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2 max-w-[120px]">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{score}</span>
    </div>
  );
}
