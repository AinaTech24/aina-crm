import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
/**
 * Proposal Conversion — proposed vs accepted vs actually invested.
 *
 * Answers the question the CRM could not before: of what we propose, how much
 * gets invested? Accepted is the client's own answer on their link (or the
 * RM's record of it); invested is matched from the RTA feed nightly
 * (lib/proposals/execution.ts). Rupees are first-year values: a year of SIPs
 * plus one-time money.
 *
 * Managers see the firm; everyone else the proposals they prepared — the same
 * rule as the proposal pages.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { FileSignature, CheckCircle2, IndianRupee, Clock } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { summariseConversion, type ConversionRow } from "@/lib/proposals/conversion";

export const dynamic = "force-dynamic";

const WINDOWS: Record<string, { label: string; days: number | null }> = {
  "30": { label: "Last 30 days", days: 30 },
  "90": { label: "Last 90 days", days: 90 },
  "180": { label: "Last 6 months", days: 180 },
  "365": { label: "Last 12 months", days: 365 },
  all: { label: "All time", days: null },
};

const money = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

export default async function ProposalConversionPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  requireCap(session.roles, "proposal.view", session.permissions);
  await assertActiveLicense(session.tenantId, session.roles);
  const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);

  const wKey = sp.w && WINDOWS[sp.w] ? sp.w : "90";
  const days = WINDOWS[wKey].days;

  const rows = await withTenant(session.tenantId, async (tx) =>
    (
      await tx.execute(sql`
        SELECT p.id, p.status, u.name AS prepared_by, p.products, p.accepted_items,
               p.executed_amount::numeric AS executed_amount, p.sent_at, p.accepted_at, p.executed_at
          FROM proposals p
          LEFT JOIN users u ON u.id = p.prepared_by_user_id
         WHERE p.tenant_id = ${session.tenantId}::uuid
           AND p.status <> 'superseded'
           AND p.sent_at IS NOT NULL
           ${days ? sql`AND p.sent_at >= now() - make_interval(days => ${days})` : sql``}
           ${seesAll ? sql`` : sql`AND p.prepared_by_user_id = ${session.userId}::uuid`}
         ORDER BY p.sent_at DESC
         LIMIT 5000
      `)
    ).rows as ConversionRow[]
  );

  const c = summariseConversion(rows);
  const t = c.total;

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeaderCard
        title={<><FileSignature className="size-6 text-muted-foreground" /> Proposal Conversion</>}
        actions={
          <nav className="inline-flex flex-wrap rounded-lg bg-secondary p-0.5 gap-0.5" aria-label="Period">
            {Object.entries(WINDOWS).map(([k, w]) => (
              <Link
                key={k}
                href={k === "90" ? "/dashboard/reports/proposal-conversion" : `/dashboard/reports/proposal-conversion?w=${k}`}
                aria-current={k === wKey ? "page" : undefined}
                className={`px-3 py-1.5 text-sm rounded-md ${k === wKey ? "bg-card shadow-sm font-medium" : "text-muted-foreground"}`}
              >
                {w.label}
              </Link>
            ))}
          </nav>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Proposals sent" value={t.sent.toLocaleString("en-IN")} sub={money(t.proposedValue) + " proposed"} icon={FileSignature} />
        <Kpi label="Accepted" value={`${t.accepted} · ${pct(t.accepted, t.sent)}`} sub={money(t.acceptedValue) + " accepted"} icon={CheckCircle2} />
        <Kpi label="Invested" value={money(t.executedValue)} sub={`${pct(t.executedValue, t.acceptedValue)} of accepted · ${t.executed} proposals`} icon={IndianRupee} tone={t.executedValue > 0 ? "emerald" : undefined} />
        <Kpi
          label="Typical time"
          value={c.daysToAccept == null ? "—" : c.daysToAccept < 1 ? "Same day" : `${Math.round(c.daysToAccept)} days`}
          sub={c.daysToAccept == null ? "nothing accepted yet" : `to accept${c.daysToExecute != null ? `, then ${Math.round(c.daysToExecute)} d to invest` : " · none invested yet"}`}
          icon={Clock}
        />
      </div>

      {t.sent === 0 ? (
        <div className="card-surface p-8 text-center text-sm text-muted-foreground">No proposals were sent in this period.</div>
      ) : (
        <>
          <Section title="By RM" hint="Rupees are first-year values: a year of SIPs plus one-time money. Invested is matched nightly from the RTA feed.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left">RM</th>
                    <th className="text-right">Sent</th>
                    <th className="text-right">Accepted</th>
                    <th className="text-right">Proposed</th>
                    <th className="text-right">Accepted ₹</th>
                    <th className="text-right">Invested</th>
                    <th className="text-right">Invested / accepted</th>
                  </tr>
                </thead>
                <tbody>
                  {c.byRm.map((r) => (
                    <tr key={r.rm}>
                      <td>{r.rm}</td>
                      <td className="text-right tabular-nums">{r.sent}</td>
                      <td className="text-right tabular-nums">{r.accepted} <span className="text-muted-foreground text-2xs">{pct(r.accepted, r.sent)}</span></td>
                      <td className="text-right tabular-nums">{money(r.proposedValue)}</td>
                      <td className="text-right tabular-nums">{money(r.acceptedValue)}</td>
                      <td className="text-right tabular-nums font-medium">{money(r.executedValue)}</td>
                      <td className="text-right tabular-nums">{pct(r.executedValue, r.acceptedValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Most proposed schemes" hint="How often each scheme was recommended, and how often the client took it.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left">Scheme / product</th>
                    <th className="text-right">Proposed</th>
                    <th className="text-right">Taken</th>
                    <th className="text-right">Take-up</th>
                  </tr>
                </thead>
                <tbody>
                  {c.bySchemes.map((s) => (
                    <tr key={s.scheme}>
                      <td className="max-w-md truncate">{s.scheme}</td>
                      <td className="text-right tabular-nums">{s.proposed}</td>
                      <td className="text-right tabular-nums">{s.accepted}</td>
                      <td className="text-right tabular-nums">{pct(s.accepted, s.proposed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, icon: Icon, tone }: { label: string; value: string; sub?: string; icon: any; tone?: "emerald" }) {
  return (
    <div className="card-surface p-4 h-full">
      <div className="flex items-center justify-between">
        <span className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className={`text-xl font-bold mt-2 tabular-nums tracking-tight ${tone === "emerald" ? "text-emerald-600" : "text-foreground"}`}>{value}</div>
      {sub && <div className="text-2xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border rounded-lg bg-card p-5">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}
