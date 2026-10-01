import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Users } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatINR } from "@/lib/utils";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { InlineEmpty } from "@/components/common/EmptyState";
import { InfoTip } from "@/components/dashboards/my/Shared";
import { familyScopeSql, requireFamilyView } from "@/lib/families/access";
import { LIVE_MEMBER_JOIN } from "@/lib/families/live";

/**
 * Next generation view — families with ₹50 L+ whose wealth is likely to change
 * hands: someone in the family is 60+, or nobody is under 35. For each, whether
 * a younger member already invests with their own SIP — the best predictor of
 * keeping the relationship after the transfer.
 *
 * Visibility is the families rule (lib/families/access); this page used to list
 * every ₹50 L+ household in the firm to anyone signed in. Members are LIVE
 * members, so a deleted or merged-away record no longer adds AUM or an age.
 */
export const dynamic = "force-dynamic";

type Level = { label: string; tone: BadgeTone; advice: string; rank: number };

function riskLevel(row: any): Level {
  const aum = Number(row.family_aum);
  const has60Plus = Number(row.members_60_plus) > 0;
  const youngOnboarded = Number(row.young_with_sip) > 0;
  if (has60Plus && !youngOnboarded && aum > 20_000_000) {
    return { label: "High", tone: "danger", rank: 0, advice: "A member is 60+, no one younger invests yet, ₹2 Cr+ at stake. Schedule a family review." };
  }
  if (has60Plus && !youngOnboarded) {
    return { label: "Medium", tone: "warning", rank: 1, advice: "Onboard children or heirs with their own SIPs before the wealth moves." };
  }
  if (has60Plus && youngOnboarded) {
    return { label: "Covered", tone: "neutral", rank: 3, advice: "A younger member already invests — keep them engaged." };
  }
  return { label: "Watch", tone: "neutral", rank: 2, advice: "No member under 35 yet — a chance to introduce the next generation." };
}

export default async function NextGenerationPage() {
  const session = await requireSession();
  requireFamilyView(session);
  const data = await withTenant(session.tenantId, async (tx) => {
    const scope = await familyScopeSql(tx, session, "f");
    const rows = await tx.execute(sql`
      WITH fam_stats AS (
        SELECT
          f.id, COALESCE(f.family_name, f.head_name) AS name,
          COUNT(i.id) AS member_count,
          COUNT(i.id) FILTER (WHERE i.dob IS NOT NULL AND date_part('year', age(i.dob)) >= 60) AS members_60_plus,
          COUNT(i.id) FILTER (WHERE i.dob IS NOT NULL AND date_part('year', age(i.dob)) < 35) AS members_under_35,
          COUNT(i.id) FILTER (WHERE i.active_sip_amount::numeric > 0
            AND i.dob IS NOT NULL AND date_part('year', age(i.dob)) < 40) AS young_with_sip,
          COALESCE(SUM(i.aum::numeric), 0) AS family_aum,
          MAX(date_part('year', age(i.dob))) FILTER (WHERE i.dob IS NOT NULL) AS eldest_age,
          MIN(date_part('year', age(i.dob))) FILTER (WHERE i.dob IS NOT NULL) AS youngest_age
        FROM families f
        LEFT JOIN investors i ON ${LIVE_MEMBER_JOIN}
        WHERE f.tenant_id = ${session.tenantId}::uuid AND ${scope}
        GROUP BY f.id
      )
      SELECT * FROM fam_stats
      WHERE family_aum >= 5000000
        AND (members_60_plus > 0 OR members_under_35 = 0)
      ORDER BY family_aum DESC
    `);
    return rows.rows as any[];
  });

  const rows = data.map((r) => ({ ...r, risk: riskLevel(r) })).sort((a, b) => a.risk.rank - b.risk.rank || Number(b.family_aum) - Number(a.family_aum));
  const high = rows.filter((r) => r.risk.label === "High").length;
  const medium = rows.filter((r) => r.risk.label === "Medium").length;
  const needsAction = high + medium;

  return (
    <div className="max-w-7xl space-y-6">
      <PageHeaderCard
        breadcrumb={[{ label: "Families", href: "/dashboard/families" }, { label: "Next generation view" }]}
        title={<>Next generation view</>}
        subtitle={<>Families of ₹50 L or more where someone is 60+ or no one is under 35 — and whether the next generation already invests with you.</>}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Families listed" value={rows.length} />
        <Stat label="High — act now" value={high} tone={high > 0 ? "danger" : undefined} />
        <Stat label="Medium" value={medium} tone={medium > 0 ? "warning" : undefined} />
      </div>

      <div className="card-surface overflow-hidden">
        <div className="flex items-center gap-1 border-b border-border px-5 py-3">
          <h2 className="section-title">Families</h2>
          <InfoTip>
            Onboarding heirs as their own investors, with their own SIPs, is the single best predictor of keeping a
            family after wealth changes hands. For each High or Medium family: schedule a family review, open the
            children&apos;s own accounts with a first SIP, and cover wills and nominees in the annual family review.
          </InfoTip>
          {needsAction > 0 && <span className="ml-auto text-xs text-muted-foreground">{needsAction} need action</span>}
        </div>
        {rows.length === 0 ? (
          <InlineEmpty
            icon={Users}
            message="No family over ₹50 L is flagged. Map your top clients into families to see this signal."
            action={{ href: "/dashboard/families/unmapped", label: "Map clients into families" }}
          />
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Family</th>
                  <th className="py-2 text-left font-medium">Priority</th>
                  <th className="py-2 text-right font-medium">Combined AUM</th>
                  <th className="py-2 text-right font-medium">Members</th>
                  <th className="py-2 text-right font-medium">Ages</th>
                  <th className="py-2 pl-4 text-left font-medium">Next step</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/families/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                    </td>
                    <td className="py-3"><Badge raw tone={r.risk.tone}>{r.risk.label}</Badge></td>
                    <td className="py-3 text-right tabular-nums">{formatINR(Number(r.family_aum))}</td>
                    <td className="py-3 text-right tabular-nums">{r.member_count}</td>
                    <td className="py-3 text-right text-xs text-muted-foreground">
                      {r.youngest_age != null && r.eldest_age != null
                        ? `${Math.round(Number(r.youngest_age))}–${Math.round(Number(r.eldest_age))} yrs`
                        : "—"}
                    </td>
                    <td className="max-w-md py-3 pl-4 text-xs text-muted-foreground">{r.risk.advice}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" | "warning" }) {
  const color = tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning-foreground" : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
