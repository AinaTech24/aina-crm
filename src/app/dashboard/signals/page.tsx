import Link from "next/link";
import { sql } from "drizzle-orm";
import { Radio, MessageCircle, PhoneIncoming, MapPin, Sparkles, ArrowRight } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { ContactQuickActions } from "@/components/common/ContactQuickActions";

export const dynamic = "force-dynamic";

type Signal = { kind: string; ts: string; name: string | null; phone: string | null; subjectType: string; subjectId: string; detail: string };
const META: Record<string, { icon: any; tone: string; label: string }> = {
  engaged: { icon: PhoneIncoming, tone: "bg-emerald-50 text-emerald-700", label: "Engaged" },
  visit: { icon: MapPin, tone: "bg-emerald-50 text-emerald-700", label: "Visit" },
  reply: { icon: MessageCircle, tone: "bg-sky-50 text-sky-700", label: "Reply" },
  new_lead: { icon: Sparkles, tone: "bg-violet-50 text-violet-700", label: "New lead" },
};

export default async function SignalsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const canFirm = can(session.roles, "dashboard.view.owner", (session as any).permissions);
  const sp = await searchParams;
  const mine = sp.mine === "1" || !canFirm;
  const t = session.tenantId;

  const signals = await withTenant(
    session.tenantId,
    async (tx) => {
      const own = mine ? sql` AND a.owner_user_id = ${session.userId}::uuid` : sql``;
      const ownLead = mine ? sql` AND l.owner_id = ${session.userId}::uuid` : sql``;
      const ownInv = mine ? sql` AND i.rm_id = ${session.userId}::uuid` : sql``;

      const a = (await tx.execute(sql`
        SELECT (CASE WHEN a.kind='visit' THEN 'visit' ELSE 'engaged' END) AS kind, a.occurred_at AS ts, a.subject_name AS name, a.subject_phone AS phone, a.subject_type, a.subject_id,
          (CASE WHEN a.direction='inbound' THEN 'Reached out to you' WHEN a.kind='call' AND a.status='answered' THEN 'Answered your call' WHEN a.kind='visit' THEN 'Met in person' ELSE 'Engaged' END) AS detail
        FROM activities a WHERE a.tenant_id=${t}::uuid AND a.occurred_at >= now() - interval '14 days'
          AND (a.direction='inbound' OR (a.kind='call' AND a.status='answered') OR a.kind='visit')${own}
        ORDER BY a.occurred_at DESC LIMIT 40`)).rows as any[];

      const c = (await tx.execute(sql`
        SELECT 'reply' AS kind, c.created_at AS ts, i.name, i.phone, 'investor' AS subject_type, c.investor_id AS subject_id,
          ('Replied on ' || c.channel) AS detail
        FROM communications c JOIN investors i ON i.id=c.investor_id
        WHERE c.tenant_id=${t}::uuid AND c.created_at >= now() - interval '14 days' AND (c.direction='inbound' OR c.status='replied')${ownInv}
        ORDER BY c.created_at DESC LIMIT 40`)).rows as any[];

      const l = (await tx.execute(sql`
        SELECT 'new_lead' AS kind, l.created_at AS ts, l.name, l.phone, 'lead' AS subject_type, l.id AS subject_id,
          ('New lead · ' || COALESCE(l.source,'—')) AS detail
        FROM leads l WHERE l.tenant_id=${t}::uuid AND l.created_at >= now() - interval '14 days'${ownLead}
        ORDER BY l.created_at DESC LIMIT 40`)).rows as any[];

      return [...a, ...c, ...l].map((r) => ({ ...r, ts: r.ts })).sort((x, y) => new Date(y.ts).getTime() - new Date(x.ts).getTime()).slice(0, 80) as Signal[];
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const href = (s: Signal) => (s.subjectType === "lead" ? `/dashboard/leads/${s.subjectId}` : `/dashboard/investors/${s.subjectId}`);
  const rel = (ts: string) => {
    const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
    if (m < 60) return `${m}m ago`; if (m < 1440) return `${Math.floor(m / 60)}h ago`; return `${Math.floor(m / 1440)}d ago`;
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Radio className="size-6 text-brand-cyan" /> Sales Signals</h1>
          <p className="text-muted-foreground text-sm">Live engagement stream — who reached out, replied, or just came in. Act while it&apos;s warm. {!canFirm && "Your book."}</p>
        </div>
        {canFirm && (
          <div className="inline-flex rounded-lg border bg-secondary/40 p-0.5 gap-0.5 text-xs">
            <Link href="/dashboard/signals" className={`px-2.5 py-1 rounded-md font-medium ${!mine ? "bg-card shadow-sm" : "text-muted-foreground"}`}>Firm-wide</Link>
            <Link href="/dashboard/signals?mine=1" className={`px-2.5 py-1 rounded-md font-medium ${mine ? "bg-card shadow-sm" : "text-muted-foreground"}`}>My book</Link>
          </div>
        )}
      </div>

      {signals.length === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground"><Radio className="size-8 mx-auto text-muted-foreground/40" /><div className="mt-2">No signals in the last 14 days.</div></div>
      ) : (
        <ol className="space-y-2">
          {signals.map((s, i) => {
            const m = META[s.kind] ?? META.engaged; const Icon = m.icon;
            return (
              <li key={i} className="card-surface p-3 flex items-center gap-3">
                <div className={`size-8 rounded-lg grid place-items-center shrink-0 ${m.tone}`}><Icon className="size-4" /></div>
                <div className="min-w-0 flex-1">
                  <Link href={href(s)} className="font-medium text-sm hover:underline">{s.name ?? "Unknown"}</Link>
                  <div className="text-xs text-muted-foreground">{s.detail} · {rel(s.ts)}</div>
                </div>
                <ContactQuickActions phone={s.phone} show={["whatsapp", "call"]} size={15} />
                <Link href={href(s)} className="text-muted-foreground"><ArrowRight className="size-4" /></Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
