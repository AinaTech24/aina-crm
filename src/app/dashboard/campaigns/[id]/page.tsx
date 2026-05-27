import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ChevronLeft, Send, MessageCircle, Mail, MessageSquare } from "lucide-react";
import { withTenant } from "@/db/client";
import { campaigns, segments, templates } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-50 text-gray-700",
  scheduled: "bg-blue-50 text-blue-700",
  sending: "bg-amber-50 text-amber-700",
  sent: "bg-emerald-50 text-emerald-700",
  paused: "bg-slate-50 text-slate-700",
  cancelled: "bg-rose-50 text-rose-700",
};
const ICONS = { whatsapp: MessageCircle, email: Mail, sms: MessageSquare } as any;

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const c = (await tx.select().from(campaigns).where(eq(campaigns.id, id)).limit(1))[0];
    if (!c) return null;
    const seg = c.segmentId
      ? (await tx.select().from(segments).where(eq(segments.id, c.segmentId)).limit(1))[0]
      : null;
    const tpl = c.templateId
      ? (await tx.select().from(templates).where(eq(templates.id, c.templateId)).limit(1))[0]
      : null;
    return { c, seg, tpl };
  });
  if (!data) notFound();
  const { c, seg, tpl } = data;
  const Icon = ICONS[c.channel] ?? Send;

  return (
    <div className="space-y-6 max-w-5xl">
      <Link href="/dashboard/campaigns" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to broadcasts
      </Link>

      <div className="border rounded-lg bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="size-12 rounded-lg bg-primary/10 grid place-items-center">
            <Icon className="size-6 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">{c.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm">
              <span className="capitalize">{c.channel}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[c.status]}`}>{c.status}</span>
              {c.scheduledAt && <span className="text-muted-foreground">scheduled {formatDate(c.scheduledAt)}</span>}
              {c.startedAt && <span className="text-muted-foreground">sent {formatDate(c.startedAt)}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3">
        <Stat label="Recipients" value={c.totalRecipients ?? 0} />
        <Stat label="Sent" value={c.sentCount ?? 0} />
        <Stat label="Delivered" value={c.deliveredCount ?? 0} tone="emerald" />
        <Stat label="Read" value={c.readCount ?? 0} tone="blue" />
        <Stat label="Failed" value={c.failedCount ?? 0} tone={Number(c.failedCount ?? 0) > 0 ? "rose" : "muted"} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold mb-3">Template</h2>
          {tpl ? (
            <Link href={`/dashboard/templates/${tpl.id}`} className="block">
              <div className="font-medium hover:underline">{tpl.name}</div>
              <div className="text-xs text-muted-foreground mt-1 font-mono">{tpl.key}</div>
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">No template attached.</p>
          )}
        </div>
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold mb-3">Audience</h2>
          {seg ? (
            <Link href={`/dashboard/segments/${seg.id}`} className="block">
              <div className="font-medium hover:underline">{seg.name}</div>
              <div className="text-xs text-muted-foreground mt-1">{seg.memberCount ?? 0} members at last refresh</div>
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">No segment attached.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "rose" | "emerald" | "blue" | "muted" }) {
  const color = { rose: "text-rose-600", emerald: "text-emerald-600", blue: "text-blue-600", muted: "text-foreground" }[tone ?? "muted"];
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
