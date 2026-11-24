import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  ChevronLeft,
  Shield,
  IndianRupee,
  Calendar,
  Users,
  AlertTriangle,
  CalendarClock,
  Pencil,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { families, investors } from "@/db/schema";
import { requireFamilyView } from "@/lib/families/access";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { dataWallAppliesFor } from "@/lib/investors/access";
import { seesWholeInsuranceBook } from "@/lib/dashboard/insurance/access";
import { loadViewablePolicy } from "@/lib/insurance/register-access";
import { formatDate, formatINR } from "@/lib/utils";
import { eachPeriod, installmentOf } from "@/lib/insurance/premium";
import { RecordProvenance } from "@/components/common/RecordProvenance";
import { cellText, policyDetailLines, policyDetailTables } from "@/lib/insurance/extra-fields";
import { insuranceExtraFieldsOn } from "@/lib/insurance/extra-fields-server";

const TYPE_LABEL: Record<string, string> = {
  term: "Term Life",
  ulip: "ULIP",
  endowment: "Endowment",
  money_back: "Money-back",
  health: "Health",
  critical_illness: "Critical Illness",
  personal_accident: "Personal Accident",
  motor: "Motor",
  travel: "Travel",
  home: "Home",
  life_other: "Life — Other",
  general_other: "General — Other",
};

const STATUS_TONE: Record<string, string> = {
  proposed: "bg-blue-50 text-blue-700",
  in_underwriting: "bg-amber-50 text-amber-700",
  active: "bg-emerald-50 text-emerald-700",
  lapsed: "bg-rose-50 text-rose-700",
  matured: "bg-secondary text-foreground",
  surrendered: "bg-secondary text-foreground",
  cancelled: "bg-secondary text-foreground",
  claim_filed: "bg-amber-50 text-amber-700",
  claim_settled: "bg-cyan-50 text-cyan-700",
};

export const dynamic = "force-dynamic";

export default async function InsuranceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  // Under the data wall, the same gate and book as the register (the page had
  // neither): own book unless a manager (a branch-locked head: their branch),
  // and the client in the viewer's scope — else 404, never a thrown 403.
  if (!can(session.roles, "insurance.view", session.permissions) && (await dataWallAppliesFor(session))) notFound();
  const data = await withTenant(session.tenantId, async (tx) => {
    const p = await loadViewablePolicy(tx, session, id, { seesAll: seesWholeInsuranceBook(session) });
    if (!p) return null;
    const inv = (
      await tx.select().from(investors).where(eq(investors.id, p.investorId)).limit(1)
    )[0];
    // The household the policyholder belongs to ("Panchal Family"), so a policy reads as the family's.
    const fam = inv?.familyId
      ? (await tx.select({ id: families.id, name: families.familyName, head: families.headName }).from(families).where(eq(families.id, inv.familyId)).limit(1))[0]
      : undefined;
    return { p, inv, fam };
  });
  if (!data) notFound();
  const { p, inv, fam } = data;
  // The firm's extra per-line fields (insuranceExtraFields): the policy's details, readable here.
  const extra = await insuranceExtraFieldsOn(session.tenantId, session.roles);
  const pd = (p.details ?? {}) as Record<string, unknown>;
  const detailLines = extra ? policyDetailLines(p.policyType, pd) : [];
  const detailTables = extra
    ? policyDetailTables(p.policyType)
        .map((t) => {
          const rows = (Array.isArray(pd[t.key]) ? (pd[t.key] as Record<string, unknown>[]) : []).filter((r) =>
            t.columns.some((c) => cellText(r?.[c.key]).trim() !== ""),
          );
          // Only the columns some row fills.
          const columns = t.columns.filter((c) => rows.some((r) => cellText(r[c.key]).trim() !== ""));
          return { ...t, rows, columns };
        })
        .filter((t) => t.rows.length > 0)
    : [];
  let familyLink = false;
  try { requireFamilyView(session); familyLink = true; } catch { /* no access to the Families pages: show the name only */ }
  const familyName = fam ? (fam.name || (fam.head ? `${fam.head} Family` : "Family")) : null;
  const dueSoon =
    p.status === "active" &&
    p.nextPremiumDueDate &&
    new Date(p.nextPremiumDueDate).getTime() < Date.now() + 30 * 24 * 60 * 60 * 1000;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap">
        <Link
          href="/dashboard/insurance"
          className="text-sm text-muted-foreground hover:underline hover:text-foreground flex items-center gap-1 transition-colors"
        >
          <ChevronLeft className="size-4" /> Back to policies
        </Link>
        <Link
          href={`/dashboard/insurance/new?edit=${p.id}`}
          className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5"
        >
          <Pencil className="size-3.5" /> Edit Policy
        </Link>
        <RecordProvenance
          entityType="insurance_policy"
          entityId={p.id}
          createdAt={p.createdAt}
          updatedAt={p.updatedAt}
          className="basis-full mt-1"
        />
      </div>

      {/* Hero */}
      <div className="card-elevated overflow-hidden">
        <div className="brand-mesh px-6 py-5 text-white">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <div className="text-2xs uppercase tracking-[0.18em] text-white/70 font-semibold">
                {TYPE_LABEL[p.policyType] ?? p.policyType}
              </div>
              <h1 className="page-title mt-1">{p.planName}</h1>
              <div className="text-white/80 text-sm mt-1 flex items-center gap-3 flex-wrap">
                <span>{p.insurer}</span>
                {p.policyNumber && (
                  <>
                    <span className="text-white/40">·</span>
                    <span className="font-mono">{p.policyNumber}</span>
                  </>
                )}
                <span className="text-white/40">·</span>
                <Link
                  href={`/dashboard/investors/${inv?.id}`}
                  className="hover:underline"
                >
                  {inv?.name}
                </Link>
                {fam && familyName && (
                  <>
                    <span className="text-white/40">·</span>
                    {familyLink ? (
                      <Link href={`/dashboard/families/${fam.id}`} className="hover:underline" title="The family this policyholder belongs to">
                        {familyName}
                      </Link>
                    ) : (
                      <span title="The family this policyholder belongs to">{familyName}</span>
                    )}
                  </>
                )}
              </div>
            </div>
            <span
              className={`chip ${STATUS_TONE[p.status] ?? ""} font-semibold capitalize`}
            >
              {p.status.replace(/_/g, " ")}
            </span>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3">
        <Tile
          icon={IndianRupee}
          label="Sum assured"
          value={p.sumAssured ? formatINR(Number(p.sumAssured)) : "—"}
          accent="cyan"
        />
        <Tile
          icon={IndianRupee}
          label="Annual premium"
          value={p.annualPremium ? formatINR(Number(p.annualPremium)) : "—"}
          sub={p.annualPremium && eachPeriod(p.premiumFrequency)
            ? `${formatINR(installmentOf(Number(p.annualPremium), p.premiumFrequency))} ${eachPeriod(p.premiumFrequency)}`
            : undefined}
          accent="emerald"
        />
        <Tile
          icon={Users}
          label="Lives covered"
          value={String(p.livesCovered ?? 1)}
        />
        <Tile
          icon={CalendarClock}
          label="Next premium"
          value={p.nextPremiumDueDate ? formatDate(p.nextPremiumDueDate) : "—"}
          accent={dueSoon ? "amber" : "muted"}
        />
      </div>

      {/* Premium due banner */}
      {dueSoon && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3 text-sm">
          <div className="size-9 rounded-lg bg-amber-100 grid place-items-center">
            <AlertTriangle className="size-4 text-amber-700" />
          </div>
          <div className="flex-1">
            <span className="font-semibold text-amber-900">
              Premium due {formatDate(p.nextPremiumDueDate!)}.
            </span>{" "}
            <span className="text-amber-800/80">
              Notify the client + log the payment once received.
            </span>
          </div>
        </div>
      )}

      {/* Schedule */}
      <div className="card-surface p-5">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="size-4 text-muted-foreground" />
          <h2 className="section-title">Schedule</h2>
        </div>
        <div className="grid grid-cols-4 gap-3 text-xs">
          <KV label="Policy start" value={p.policyStartDate ? formatDate(p.policyStartDate) : "—"} />
          <KV
            label="Policy term"
            value={p.policyTermYears != null ? `${p.policyTermYears} yrs` : "—"}
          />
          <KV
            label="Premium paying term"
            value={
              p.premiumPayingTermYears != null ? `${p.premiumPayingTermYears} yrs` : "—"
            }
          />
          <KV
            label="Premium frequency"
            value={String(p.premiumFrequency).replace(/_/g, " ")}
          />
          <KV label="Maturity" value={p.maturityDate ? formatDate(p.maturityDate) : "—"} />
          <KV
            label="Last premium"
            value={p.lastPremiumDate ? formatDate(p.lastPremiumDate) : "—"}
          />
          <KV
            label="Next premium"
            value={p.nextPremiumDueDate ? formatDate(p.nextPremiumDueDate) : "—"}
          />
          <KV label="Grace period" value={`${p.gracePeriodDays ?? 30} days`} />
        </div>
      </div>

      {/* Cover details — the policy's own fields per line (insuranceExtraFields) */}
      {detailLines.length > 0 && (
        <div className="card-surface p-5">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="size-4 text-muted-foreground" />
            <h2 className="section-title">Cover details</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {detailLines.map((l) => (
              <KV
                key={l.label}
                label={l.label}
                value={
                  l.type === "date" && /^\d{4}-\d{2}-\d{2}/.test(l.value)
                    ? formatDate(l.value)
                    : l.type === "number" && /₹/.test(l.label) && Number.isFinite(Number(l.value))
                      ? formatINR(Number(l.value))
                      : l.value
                }
              />
            ))}
          </div>
        </div>
      )}

      {detailTables.map((t) => (
        <div key={t.key} className="card-surface p-5">
          <h2 className="section-title mb-3">
            {t.label} ({t.rows.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {t.columns.map((c) => (
                    <th key={c.key} className="text-left">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r, i) => (
                  <tr key={i}>
                    {t.columns.map((c) => {
                      const v = cellText(r[c.key]);
                      return (
                        <td key={c.key} className={/₹/.test(c.label) ? "tabular-nums" : undefined}>
                          {/₹/.test(c.label) && v !== "" && Number.isFinite(Number(v)) ? formatINR(Number(v)) : v || "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Nominee */}
      {(p.nomineeName || p.nomineeRelation) && (
        <div className="card-surface p-5">
          <div className="flex items-center gap-2 mb-3">
            <Users className="size-4 text-muted-foreground" />
            <h2 className="section-title">Nominee</h2>
          </div>
          <div className="grid grid-cols-4 gap-3 text-xs">
            <KV label="Name" value={p.nomineeName ?? "—"} />
            <KV label="Relation" value={p.nomineeRelation ?? "—"} />
            <KV label="Share" value={`${p.nomineeShare ?? 100}%`} />
            <KV label="DOB" value={p.nomineeDob ? formatDate(p.nomineeDob) : "—"} />
          </div>
        </div>
      )}

      {/* Riders */}
      {Array.isArray(p.riders) && p.riders.length > 0 && (
        <div className="card-surface p-5">
          <h2 className="section-title mb-3">Riders ({p.riders.length})</h2>
          <ul className="space-y-2">
            {(p.riders as any[]).map((r, i) => (
              <li key={i} className="rounded-lg border border-border/70 bg-background p-3 text-xs">
                <div className="font-semibold">{r.name}</div>
                {(r.sumAssured || r.premium) && (
                  <div className="text-muted-foreground mt-1">
                    {r.sumAssured && (
                      <>
                        Sum assured {formatINR(Number(r.sumAssured))}
                      </>
                    )}
                    {r.sumAssured && r.premium && " · "}
                    {r.premium && <>Premium {formatINR(Number(r.premium))}</>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Remarks */}
      {p.remarks && (
        <div className="card-surface p-5">
          <h2 className="section-title mb-2">Remarks</h2>
          <p className="text-sm whitespace-pre-line leading-relaxed">{p.remarks}</p>
        </div>
      )}
    </div>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: any;
  label: string;
  value: string;
  /** A second line under the value (what is paid each time). */
  sub?: string;
  accent?: "cyan" | "emerald" | "amber" | "rose" | "muted";
}) {
  const bg: Record<string, string> = {
    cyan: "bg-brand-cyan-light text-brand-cyan-deep",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
    muted: "bg-secondary text-foreground",
  };
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        <div className={`size-7 rounded-lg grid place-items-center ${bg[accent ?? "muted"]}`}>
          <Icon className="size-3.5" />
        </div>
      </div>
      <div className="text-xl font-bold mt-2 tabular-nums tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-secondary/40 rounded-lg px-3 py-2">
      <div className="text-2xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-semibold mt-0.5 capitalize">{value}</div>
    </div>
  );
}
