import Link from "next/link";
import { sql } from "drizzle-orm";
import { ShieldAlert, HeartPulse, Umbrella, IndianRupee, Users } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatINR } from "@/lib/utils";
import { ContactQuickActions } from "@/components/common/ContactQuickActions";

export const dynamic = "force-dynamic";

export default async function ProtectionGapPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const canFirm = can(session.roles, "dashboard.view.owner", (session as any).permissions);
  const sp = await searchParams;
  const mine = sp.mine === "1" || !canFirm;
  const gap = sp.gap === "life" || sp.gap === "health" ? sp.gap : "";

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const own = mine ? sql` AND i.rm_id = ${session.userId}::uuid` : sql``;
      const base = sql`
        SELECT i.id, i.name, i.phone, i.whatsapp_phone, i.email, COALESCE(i.aum,0)::numeric AS aum, i.segment_tag,
          NOT EXISTS(SELECT 1 FROM insurance_policies p WHERE p.tenant_id=i.tenant_id AND p.investor_id=i.id AND p.status='active' AND p.policy_type IN ('term','ulip','endowment','money_back','life_other')) AS life_gap,
          NOT EXISTS(SELECT 1 FROM insurance_policies p WHERE p.tenant_id=i.tenant_id AND p.investor_id=i.id AND p.status='active' AND p.policy_type IN ('health','critical_illness')) AS health_gap
        FROM investors i
        WHERE i.tenant_id = ${session.tenantId}::uuid AND i.status='active' AND i.merged_into_id IS NULL${own}`;
      const rows = (await tx.execute(sql`
        SELECT * FROM (${base}) g
        WHERE (g.life_gap OR g.health_gap)
          ${gap === "life" ? sql`AND g.life_gap` : gap === "health" ? sql`AND g.health_gap` : sql``}
        ORDER BY g.aum DESC NULLS LAST LIMIT 300`)).rows as any[];
      const stats = (await tx.execute(sql`
        SELECT COUNT(*) FILTER (WHERE life_gap)::int AS life, COUNT(*) FILTER (WHERE health_gap)::int AS health,
               COUNT(*) FILTER (WHERE life_gap AND health_gap)::int AS both,
               COALESCE(SUM(aum) FILTER (WHERE life_gap OR health_gap),0)::numeric AS aum_exposed
        FROM (${base}) g`)).rows[0] as any;
      return { rows, stats };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );
  const s = data.stats ?? {};

  const tab = (v: string, label: string, count: number) => (
    <Link href={v ? `/dashboard/insurance/protection-gap?gap=${v}${mine ? "&mine=1" : ""}` : `/dashboard/insurance/protection-gap${mine ? "?mine=1" : ""}`}
      className={`chip ${gap === v ? "bg-brand-cyan text-white" : "bg-secondary"}`}>{label} <strong className="ml-1">{count}</strong></Link>
  );

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><ShieldAlert className="size-6 text-brand-cyan" /> Protection-Gap Radar</h1>
          <p className="text-muted-foreground text-sm">Clients with no active <strong>life</strong> or <strong>health</strong> cover — your warmest insurance leads, biggest first. {!canFirm && "Your book."}</p>
        </div>
        {canFirm && (
          <div className="inline-flex rounded-lg border bg-secondary/40 p-0.5 gap-0.5 text-xs">
            <Link href="/dashboard/insurance/protection-gap" className={`px-2.5 py-1 rounded-md font-medium ${!mine ? "bg-card shadow-sm" : "text-muted-foreground"}`}>Firm-wide</Link>
            <Link href="/dashboard/insurance/protection-gap?mine=1" className={`px-2.5 py-1 rounded-md font-medium ${mine ? "bg-card shadow-sm" : "text-muted-foreground"}`}>My book</Link>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Umbrella} label="No life cover" value={String(s.life ?? 0)} tone="rose" />
        <Kpi icon={HeartPulse} label="No health cover" value={String(s.health ?? 0)} tone="amber" />
        <Kpi icon={Users} label="Both gaps" value={String(s.both ?? 0)} tone="rose" />
        <Kpi icon={IndianRupee} label="AUM exposed" value={formatINR(Number(s.aum_exposed ?? 0))} tone="emerald" />
      </div>

      <div className="flex flex-wrap gap-1.5">{tab("", "All gaps", data.rows.length)}{tab("life", "Life gap", Number(s.life ?? 0))}{tab("health", "Health gap", Number(s.health ?? 0))}</div>

      <div className="card-surface overflow-x-auto">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">No protection gaps {mine ? "in your book" : ""}. Every client is covered. 🛡️</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b"><tr><th className="text-left px-4 py-2 font-medium">Client</th><th className="text-left py-2 font-medium">Gaps</th><th className="text-right py-2 font-medium">AUM</th><th className="text-right py-2 font-medium pr-4">Reach</th></tr></thead>
            <tbody>
              {data.rows.map((r) => {
                const first = String(r.name ?? "").split(" ")[0];
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-secondary/40">
                    <td className="px-4 py-2.5"><Link href={`/dashboard/investors/${r.id}`} className="font-medium hover:underline">{r.name}</Link>{r.segment_tag && <span className="ml-2 chip text-[10px] bg-violet-50 text-violet-700">{r.segment_tag}</span>}</td>
                    <td className="py-2.5">
                      <div className="flex gap-1">
                        {r.life_gap && <span className="chip text-[10px] bg-rose-50 text-rose-700">No life</span>}
                        {r.health_gap && <span className="chip text-[10px] bg-amber-50 text-amber-700">No health</span>}
                      </div>
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{Number(r.aum) > 0 ? formatINR(Number(r.aum)) : "—"}</td>
                    <td className="py-2.5 pr-4 text-right"><ContactQuickActions phone={r.whatsapp_phone || r.phone} email={r.email} message={`Dear ${first}, as your advisor I'd like to make sure your family's protection is adequate. Can we do a quick insurance review?`} subject="Insurance protection review" show={["whatsapp", "call"]} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground italic">A &ldquo;gap&rdquo; means no <em>active</em> policy of that type in the register. Update the register or cross-sell matrix to clear it.</p>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "rose" | "amber" | "emerald" }) {
  const color = tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : tone === "emerald" ? "text-emerald-600" : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><Icon className="size-3.5 text-muted-foreground" /></div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
