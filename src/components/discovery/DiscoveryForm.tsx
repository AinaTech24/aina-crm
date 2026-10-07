"use client";

/**
 * Financial Discovery form — the shared fact-find UI used both in-meeting (RM,
 * full form) and by the client via the public link (clientMode). Every keystroke recomputes the live
 * Financial Health Snapshot. Adapted from the workbook's five sections.
 *
 * What the CRM already knows is filled in before anyone types (see
 * lib/discovery/prefill): identity, goals, insurance, holdings — each section
 * that was says so, so the client checks rather than re-keys. The risk profile
 * on record in the Risk Profiles module IS the risk profile here; when there is
 * one, section 10 shows it and asks nothing more, instead of a second
 * questionnaire that could disagree with it.
 *
 * Each amount is entered once: income per its own frequency, loan EMIs in
 * Liabilities, premiums in the insurance sections. Section 4 only reads them
 * back (lib/discovery/calc) — it used to ask for them again, and an RM who
 * filled both counted every EMI twice.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Trash2, Loader2, ShieldCheck, Database, Check } from "lucide-react";
import { computeDiscovery, FREQUENCY_PER_YEAR, goalReturnPct, type DiscoveryData, type IncomeRow } from "@/lib/discovery/calc";
import { checkDiscovery, type DiscoveryErrors } from "@/lib/discovery/checks";
import { formatDate, humanise } from "@/lib/format";
import { RISK_QUESTIONS } from "@/lib/discovery/risk";
import { HealthSnapshot } from "./HealthSnapshot";
import * as O from "@/lib/discovery/options";
import { DateField } from "@/components/ui/DateField";

type ColType = "text" | "num" | "money" | { select: readonly string[] };
type Col = { key: string; label: string; type: ColType; w?: string };

const SECTIONS = [
  ["identity", "Identity"], ["income", "Income"], ["expenses", "Expenses"], ["surplus", "Surplus"],
  ["assets", "Assets"], ["liabilities", "Loans"], ["life", "Life cover"], ["health", "Health cover"],
  ["goals", "Goals"], ["risk", "Risk"],
] as const;
type SectionKey = (typeof SECTIONS)[number][0];

/** ₹12.50 L / ₹1.20 Cr — under the box, so a missing zero is visible. */
function inWords(v: unknown): string | null {
  const x = Number(v);
  if (!Number.isFinite(x) || Math.abs(x) < 1e5) return null;
  return Math.abs(x) >= 1e7 ? `₹${(x / 1e7).toFixed(2)} Cr` : `₹${(x / 1e5).toFixed(2)} L`;
}
const rupees = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

/**
 * Rows saved before income had a per-frequency amount carry a yearly
 * `annualAmount`. Shown as the same yearly total in the row's own frequency.
 */
function upgradeIncome(rows: IncomeRow[] | undefined): IncomeRow[] | undefined {
  if (!rows) return rows;
  return rows.map((r) => {
    if ((r.amount != null && r.amount !== "") || r.annualAmount == null || r.annualAmount === "") return r;
    const per = FREQUENCY_PER_YEAR[String(r.frequency ?? "")] ?? 1;
    const { annualAmount, ...rest } = r;
    const amount = Math.round((Number(annualAmount) || 0) / per);
    return { ...rest, amount, frequency: r.frequency || "Annually" };
  });
}

export function DiscoveryForm({
  initialData,
  clientMode = false,
  saving = false,
  onSave,
  onSubmit,
  onChange,
  onSaveRisk,
  submitLabel = "Submit",
  subject,
}: {
  initialData: DiscoveryData;
  /** The lead / client this fact-find is for — links to their record (RM view only). */
  subject?: { type: string; id: string };
  clientMode?: boolean;
  saving?: boolean;
  onSave?: (d: DiscoveryData) => void;
  onSubmit?: (d: DiscoveryData) => void;
  /** Every edit, for autosave. Not called for the initial data. */
  onChange?: (d: DiscoveryData) => void;
  /** Save the completed questionnaire as a provisional risk profile (RM, client subject, none on record). */
  onSaveRisk?: () => Promise<void>;
  submitLabel?: string;
}) {
  const [data, setData] = useState<DiscoveryData>(() => ({ ...initialData, income: upgradeIncome(initialData.income) }));
  const c = useMemo(() => computeDiscovery(data), [data]);
  const errors = useMemo(() => checkDiscovery(data), [data]);
  const errorCount = Object.keys(errors).length;
  const [blocked, setBlocked] = useState(false);
  const [riskSaving, setRiskSaving] = useState(false);

  // Autosave hook — skip the first render (nothing has changed yet).
  const first = useRef(true);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    onChangeRef.current?.(data);
  }, [data]);
  useEffect(() => { if (!errorCount) setBlocked(false); }, [errorCount]);

  const set = (patch: Partial<DiscoveryData>) => setData((d) => ({ ...d, ...patch }));
  const setId = (k: string, v: any) => setData((d) => ({ ...d, identification: { ...(d.identification ?? {}), [k]: v } }));
  const setExp = (k: string, v: any) => setData((d) => ({ ...d, expenses: { ...(d.expenses ?? {}), [k]: v } }));
  const setSurp = (k: string, v: any) => setData((d) => ({ ...d, surplusInputs: { ...(d.surplusInputs ?? {}), [k]: v } }));
  const setRisk = (k: string, v: any) => setData((d) => ({ ...d, riskProfile: { ...(d.riskProfile ?? {}), [k]: v } }));

  // What came from the CRM record, to say so on each section.
  const from = new Set(data.prefilledFromRecord ?? []);
  const identityFromRecord = [...from].some((k) => k.startsWith("identification."));
  const who = clientMode ? "your details with us" : subject?.type === "lead" ? "the lead record" : "the client record";
  const note = (on: boolean) => (on ? `Filled in from ${who} — check and correct if anything has changed.` : undefined);
  const rec = data.recordedRisk;
  // A risk profile on record means the questionnaire is not asked again — not
  // even its horizon / lump-sum / liquidity questions (the firm's call,
  // 2026-10-02). Without one, the full questionnaire is the profile.
  const riskQuestions = rec ? [] : RISK_QUESTIONS;

  const ident = (data.identification ?? {}) as Record<string, any>;
  const filled: Record<SectionKey, boolean | null> = {
    identity: !!(ident.fullName && ident.dob && ident.mobile),
    income: c.grossAnnualIncome > 0,
    expenses: c.monthlyExpenses > 0,
    surplus: null, // read-outs; nothing to fill
    assets: (data.assets ?? []).length > 0,
    liabilities: (data.liabilities ?? []).length > 0,
    life: (data.lifeInsurance ?? []).length > 0,
    health: (data.healthInsurance ?? []).length > 0,
    goals: (data.goals ?? []).length > 0,
    risk: !!rec || c.risk.complete,
  };
  const countable = SECTIONS.filter(([k]) => filled[k] !== null);
  const done = countable.filter(([k]) => filled[k]).length;

  /** Refuse to send with a highlighted problem; take the user to the first. */
  function guarded(fn?: (d: DiscoveryData) => void) {
    if (!fn) return undefined;
    return () => {
      if (errorCount) {
        setBlocked(true);
        document.querySelector("[data-field-error]")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      fn(data);
    };
  }

  const surplusLegacy = data.surplusInputs ?? {};
  const expenseLabels: Array<[string, string]> = [
    ["rent", "Rent"], ["groceries", "Groceries & household"], ["education", "Children's education"],
    ["vehicle", "Vehicle / transport"], ["utilities", "Utilities, internet"], ["medical", "Medical / healthcare"],
    ["entertainment", "Entertainment & dining"], ["clothing", "Clothing & personal"], ["other", "Other regular"],
  ];
  // Premiums belong in sections 7–8. An older fact-find may still carry one
  // here; it is shown (and counted only when no policy is listed) until cleared.
  if (Number((data.expenses as any)?.insurance) > 0) expenseLabels.push(["insurance", "Insurance premiums (old entry)"]);

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
      <div className="space-y-5 min-w-0">
        {/* Progress + jump links */}
        <nav aria-label="Fact-find sections" className="sticky top-0 z-10 -mx-1 rounded-lg border border-border bg-card/95 px-2 py-2 backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="shrink-0 px-1 text-2xs font-semibold text-muted-foreground tabular-nums">{done}/{countable.length} filled</span>
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
              {SECTIONS.map(([k, label], i) => (
                <a
                  key={k}
                  href={`#fd-${k}`}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-2xs font-medium ${filled[k] ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60"}`}
                >
                  {filled[k] ? <Check className="size-3 text-emerald-600" aria-hidden /> : <span className="tabular-nums">{i + 1}</span>}
                  {label}
                </a>
              ))}
            </div>
          </div>
        </nav>

        {/* 1 · Identity */}
        <Section id="identity" title="1 · Client identity" note={note(identityFromRecord)}>
          <Grid>
            <F label="Full name (as per PAN)"><T v={ident.fullName} on={(x) => setId("fullName", x)} /></F>
            <F label="Date of birth" error={errors["identification.dob"]}><DateField className="input-base text-sm w-full" value={ident.dob ?? ""} onChange={(e) => setId("dob", e.target.value)} /></F>
            <F label="PAN" error={errors["identification.pan"]}><T v={ident.pan} on={(x) => setId("pan", x.toUpperCase())} mono /></F>
            <F label="Mobile" error={errors["identification.mobile"]}><T v={ident.mobile} on={(x) => setId("mobile", x)} inputMode="tel" /></F>
            <F label="Email" error={errors["identification.email"]}><T v={ident.email} on={(x) => setId("email", x)} inputMode="email" /></F>
            <F label="City"><T v={ident.city} on={(x) => setId("city", x)} /></F>
            <F label="Residency"><S v={ident.residency} on={(x) => setId("residency", x)} opts={O.RESIDENCY} /></F>
            <F label="Occupation"><T v={ident.occupation} on={(x) => setId("occupation", x)} /></F>
            <F label="Tax slab"><S v={ident.taxSlab} on={(x) => setId("taxSlab", x)} opts={O.TAX_SLABS} /></F>
            <F label="Dependents" error={errors["identification.dependents"]}><N v={ident.dependents} on={(x) => setId("dependents", x)} /></F>
            <F label="Nominee name"><T v={ident.nomineeName} on={(x) => setId("nomineeName", x)} /></F>
            <F label="Nominee relation"><S v={ident.nomineeRelation} on={(x) => setId("nomineeRelation", x)} opts={O.RELATIONS} /></F>
          </Grid>
        </Section>

        {/* 2 · Income */}
        <Section id="income" title="2 · Income & cash flow" subtitle={`Total gross annual income: ${rupees(c.grossAnnualIncome)}`}>
          <Repeat
            list="income"
            errors={errors}
            rows={data.income ?? []}
            on={(rows) => set({ income: rows })}
            cols={[
              { key: "source", label: "Income source", type: "text", w: "minmax(8rem,1.5fr)" },
              { key: "amount", label: "Amount ₹", type: "money", w: "8rem" },
              { key: "frequency", label: "Every", type: { select: O.FREQUENCY }, w: "7rem" },
              { key: "taxable", label: "Taxable?", type: { select: O.YES_NO }, w: "6rem" },
            ]}
            addLabel="Add income source"
          />
          <p className="text-2xs text-muted-foreground">Enter each amount as it is received — a monthly salary per month — and pick how often.</p>
        </Section>

        {/* 3 · Monthly expenses */}
        <Section id="expenses" title="3 · Monthly household expenses" subtitle={`Total: ${rupees(c.monthlyExpenses)}/mo · ${rupees(c.annualExpenses)}/yr`}>
          <Grid>
            {expenseLabels.map(([k, label]) => (
              <F key={k} label={label} error={errors[`expenses.${k}`]}><N v={(data.expenses as any)?.[k]} on={(x) => setExp(k, x)} money /></F>
            ))}
          </Grid>
          <p className="text-2xs text-muted-foreground">Loan EMIs go in Liabilities and premiums in Insurance — they are counted from there.</p>
        </Section>

        {/* 4 · Surplus — read back from the sections that hold each figure */}
        <Section id="surplus" title="4 · Investable surplus" subtitle={`Net annual surplus: ${rupees(c.netInvestableSurplus)} · ~${rupees(c.monthlySipCapacity)}/mo`}>
          <div className="grid gap-2 sm:grid-cols-2">
            <ReadOut
              label="Loan EMIs a year"
              value={rupees(c.annualLoanEmis)}
              source={c.emiSource === "liabilities" ? "From Liabilities (section 6)" : c.emiSource === "typed" ? "Typed earlier — add the loans in section 6 instead" : "No loans listed"}
            />
            <ReadOut
              label="Insurance premiums a year"
              value={rupees(c.annualInsurancePremiums)}
              source={c.premiumSource === "policies" ? "From the policies in sections 7–8" : c.premiumSource === "typed" ? "Typed earlier — add the policies in sections 7–8 instead" : "No policies listed"}
            />
          </div>
          <Grid>
            <F label="Estimated annual tax" error={errors["surplusInputs.estimatedTax"]}><N v={surplusLegacy.estimatedTax} on={(x) => setSurp("estimatedTax", x)} money /></F>
            {c.emiSource === "typed" && (
              <F label="Annual loan EMIs (old entry)" error={errors["surplusInputs.annualLoanEmis"]}><N v={surplusLegacy.annualLoanEmis} on={(x) => setSurp("annualLoanEmis", x)} money /></F>
            )}
            {c.premiumSource === "typed" && (
              <F label="Annual premiums (old entry)" error={errors["surplusInputs.annualInsurancePremiums"]}><N v={surplusLegacy.annualInsurancePremiums} on={(x) => setSurp("annualInsurancePremiums", x)} money /></F>
            )}
          </Grid>
          {Number(data.existingSipMonthly) > 0 && (
            <p className="rounded-md bg-secondary/70 px-3 py-2 text-xs text-muted-foreground">
              {clientMode ? "You already invest" : "Already investing with us:"} <span className="font-semibold text-foreground tabular-nums">{rupees(Number(data.existingSipMonthly))}/mo</span> in SIPs
              {clientMode ? " with us." : " — part of this surplus may already be committed."}
            </p>
          )}
        </Section>

        {/* 5 · Assets */}
        <Section id="assets" title="5 · Assets" subtitle={`Total assets: ${rupees(c.totalAssets)}`} note={note(from.has("assets"))}>
          <Repeat
            list="assets"
            errors={errors}
            rows={data.assets ?? []}
            on={(rows) => set({ assets: rows })}
            cols={[
              { key: "description", label: "Description", type: "text", w: "minmax(7rem,1.3fr)" },
              { key: "category", label: "Type", type: { select: O.ASSET_TYPES }, w: "9rem" },
              { key: "currentValue", label: "Value ₹", type: "money", w: "7rem" },
              { key: "invested", label: "Invested ₹", type: "money", w: "7rem" },
              { key: "liquid", label: "Liquid?", type: { select: O.YES_NO }, w: "5.5rem" },
            ]}
            addLabel="Add asset"
          />
        </Section>

        {/* 6 · Liabilities */}
        <Section id="liabilities" title="6 · Liabilities" subtitle={`Total: ${rupees(c.totalLiabilities)} · Net worth ${rupees(c.netWorth)} · Debt/Asset ${c.debtToAssetRatio.toFixed(0)}%`}>
          <Repeat
            list="liabilities"
            errors={errors}
            rows={data.liabilities ?? []}
            on={(rows) => set({ liabilities: rows })}
            cols={[
              { key: "description", label: "Description", type: "text", w: "minmax(7rem,1.3fr)" },
              { key: "type", label: "Type", type: { select: O.LIABILITY_TYPES }, w: "8rem" },
              { key: "outstanding", label: "Outstanding ₹", type: "money", w: "8rem" },
              { key: "emi", label: "EMI ₹ / mo", type: "money", w: "6.5rem" },
              { key: "ratePct", label: "Rate %", type: "num", w: "5rem" },
            ]}
            addLabel="Add liability"
          />
        </Section>

        {/* 7 · Life insurance */}
        <Section id="life" title="7 · Life insurance" subtitle={`Cover ${rupees(c.totalLifeCover)} · Recommended ${rupees(c.recommendedLifeCover)} · ${c.lifeCoverGap > 0 ? `Gap ${rupees(c.lifeCoverGap)}` : "Adequately covered"}`} note={note(from.has("lifeInsurance"))}>
          <Repeat
            list="lifeInsurance"
            errors={errors}
            rows={data.lifeInsurance ?? []}
            on={(rows) => set({ lifeInsurance: rows })}
            cols={[
              { key: "policy", label: "Policy / insurer", type: "text", w: "minmax(7rem,1.3fr)" },
              { key: "type", label: "Type", type: { select: O.LIFE_INSURANCE_TYPES }, w: "7.5rem" },
              { key: "sumAssured", label: "Sum assured ₹", type: "money", w: "8rem" },
              { key: "premium", label: "Premium ₹ / yr", type: "money", w: "7rem" },
            ]}
            addLabel="Add life policy"
          />
        </Section>

        {/* 8 · Health insurance */}
        <Section id="health" title="8 · Health & general insurance" subtitle={`Total health cover ${rupees(c.totalHealthCover)}`} note={note(from.has("healthInsurance"))}>
          <Repeat
            list="healthInsurance"
            errors={errors}
            rows={data.healthInsurance ?? []}
            on={(rows) => set({ healthInsurance: rows })}
            cols={[
              { key: "insurer", label: "Insurer / plan", type: "text", w: "minmax(7rem,1.3fr)" },
              { key: "type", label: "Type", type: { select: O.HEALTH_INSURANCE_TYPES }, w: "9rem" },
              { key: "sumInsured", label: "Sum insured ₹", type: "money", w: "8rem" },
              { key: "premium", label: "Premium ₹ / yr", type: "money", w: "7rem" },
            ]}
            addLabel="Add health policy"
          />
        </Section>

        {/* 9 · Goals */}
        <Section id="goals" title="9 · Financial goals" subtitle={`Target corpus ${rupees(c.totalCorpusTarget)} · SIP needed ~${rupees(c.totalSipNeeded)}/mo`} note={note(from.has("goals"))}>
          <Repeat
            list="goals"
            errors={errors}
            rows={data.goals ?? []}
            on={(rows) => set({ goals: rows })}
            cols={[
              { key: "description", label: "Goal", type: "text", w: "minmax(7rem,1.3fr)" },
              { key: "type", label: "Type", type: { select: O.GOAL_TYPES }, w: "8rem" },
              { key: "targetYear", label: "Target yr", type: "num", w: "5.5rem" },
              { key: "targetCorpus", label: "Needed then ₹", type: "money", w: "7.5rem" },
              { key: "alreadySaved", label: "Saved ₹", type: "money", w: "7rem" },
              { key: "priority", label: "Priority", type: { select: O.PRIORITY }, w: "6.5rem" },
            ]}
            addLabel="Add goal"
          />
          <p className="text-2xs text-muted-foreground">
            Enter what the goal will cost in its target year. The SIP assumes {goalReturnPct(1)}% a year for goals under 3 years,{" "}
            {goalReturnPct(3)}% for 3–5 years and {goalReturnPct(5)}% beyond.
          </p>
        </Section>

        {/* 10 · Risk profile — the one on record, or (with none) the questionnaire */}
        <Section
          id="risk"
          title="10 · Risk profile & suitability"
          subtitle={
            rec
              ? undefined
              : c.risk.complete
                ? `${c.risk.bandLabel} · score ${c.risk.score}/${c.risk.max}`
                : c.risk.answered > 0
                  ? `${c.risk.answered}/${c.risk.total} answered — still needed: ${c.risk.missing.join(", ")}`
                  : "Answer the questions — risk score & product suitability auto-calculate →"
          }
        >
          {rec ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-secondary/40 px-4 py-3">
              <ShieldCheck className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-sm">
                  <span className="text-muted-foreground">Risk profile on record: </span>
                  <span className="font-semibold text-foreground">{humanise(rec.category)}</span>
                  {rec.provisional && (
                    <span className="ml-2 rounded-full bg-warning/10 px-2 py-0.5 text-2xs font-semibold text-warning-foreground">Provisional</span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {[
                    rec.date ? `Completed ${formatDate(rec.date)}` : null,
                    rec.score != null ? `score ${rec.score}` : null,
                    clientMode ? "from your risk profile with us" : "from the Risk Profiles module — not asked again here",
                  ].filter(Boolean).join(" · ")}
                </div>
              </div>
              {!clientMode && subject && (
                <div className="flex items-center gap-3 text-xs font-medium">
                  <Link
                    href={subject.type === "lead" ? `/dashboard/leads/${subject.id}` : `/dashboard/investors/${subject.id}#rel-risk`}
                    className="text-primary hover:underline"
                  >
                    View
                  </Link>
                  {subject.type !== "lead" && (
                    <Link href={`/dashboard/risk-profiles/new?investorId=${subject.id}`} className="text-primary hover:underline">
                      Re-assess
                    </Link>
                  )}
                </div>
              )}
            </div>
          ) : (
            !clientMode && (
              <p className="text-xs text-muted-foreground">
                No risk profile on record yet. Answer below, or{" "}
                {subject && subject.type !== "lead" ? (
                  <Link href={`/dashboard/risk-profiles/new?investorId=${subject.id}`} className="font-medium text-primary hover:underline">
                    complete one in Risk Profiles
                  </Link>
                ) : (
                  "complete one in Risk Profiles"
                )}{" "}
                so every screen shows the same profile.
              </p>
            )
          )}
          {riskQuestions.length > 0 && (
            <Grid>
              {riskQuestions.map((q) => (
                <F key={q.key} label={q.label}>
                  <S v={data.riskProfile?.[q.key]} on={(x) => setRisk(q.key, x)} opts={q.options.map((o) => o.value)} />
                </F>
              ))}
            </Grid>
          )}
          {!rec && (
            <p className="text-2xs text-muted-foreground">Age, annual income &amp; net worth are taken automatically from the fact-find above — no need to re-enter.</p>
          )}
          {!rec && !clientMode && onSaveRisk && subject?.type === "investor" && c.risk.complete && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-secondary/70 px-3 py-2">
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                Save <span className="font-semibold text-foreground">{c.risk.bandLabel}</span> as this client&apos;s risk profile — provisional until they confirm it.
              </span>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={riskSaving}
                onClick={async () => { setRiskSaving(true); try { await onSaveRisk(); } finally { setRiskSaving(false); } }}
              >
                {riskSaving ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} Save as provisional risk profile
              </button>
            </div>
          )}
        </Section>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          {blocked && errorCount > 0 && (
            <span className="mr-auto text-xs font-medium text-destructive">
              Fix the {errorCount === 1 ? "highlighted field" : `${errorCount} highlighted fields`} first.
            </span>
          )}
          {onSave && (
            <button onClick={() => onSave(data)} disabled={saving} className="btn-secondary text-sm">
              {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save draft
            </button>
          )}
          {onSubmit && (
            <button onClick={guarded(onSubmit)} disabled={saving} className="btn-primary text-sm">
              {saving ? <Loader2 className="size-4 animate-spin" /> : null} {submitLabel}
            </button>
          )}
        </div>
      </div>

      <HealthSnapshot c={c} sticky />
    </div>
  );
}

/* ── primitives ─────────────────────────────────────────────────────────── */
function Section({ id, title, subtitle, note, children }: { id: SectionKey; title: string; subtitle?: string; note?: string; children: React.ReactNode }) {
  return (
    <section id={`fd-${id}`} className="card-surface p-5 space-y-3 scroll-mt-16">
      <div>
        <h2 className="font-semibold text-sm">{title}</h2>
        {subtitle && <p className="text-2xs text-muted-foreground mt-0.5 tabular-nums">{subtitle}</p>}
        {note && (
          <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-2xs text-muted-foreground">
            <Database className="size-3 shrink-0" aria-hidden /> {note}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{children}</div>;
}
function F({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-2xs font-medium text-muted-foreground mb-1">{label}</div>
      {children}
      {error && <div data-field-error className="mt-1 text-2xs font-medium text-destructive">{error}</div>}
    </label>
  );
}
function ReadOut({ label, value, source }: { label: string; value: string; source: string }) {
  return (
    <div className="rounded-lg bg-secondary/70 px-3 py-2">
      <div className="text-2xs font-medium text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-2xs text-muted-foreground">{source}</div>
    </div>
  );
}
function T({ v, on, mono, inputMode }: { v: any; on: (x: string) => void; mono?: boolean; inputMode?: "tel" | "email" }) {
  return <input className={`input-base text-sm w-full ${mono ? "font-mono" : ""}`} inputMode={inputMode} value={v ?? ""} onChange={(e) => on(e.target.value)} />;
}
function N({ v, on, money }: { v: any; on: (x: string) => void; money?: boolean }) {
  const words = money ? inWords(v) : null;
  return (
    <>
      <input type="number" min={0} inputMode="decimal" className="input-base text-sm w-full tabular-nums" value={v ?? ""} onChange={(e) => on(e.target.value)} />
      {words && <div className="mt-0.5 text-2xs text-muted-foreground tabular-nums">{words}</div>}
    </>
  );
}
function S({ v, on, opts }: { v: any; on: (x: string) => void; opts: readonly string[] }) {
  return (
    <select className="input-base text-sm w-full" value={v ?? ""} onChange={(e) => on(e.target.value)}>
      <option value="">Select…</option>
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Cell({ col, value, on }: { col: Col; value: any; on: (x: any) => void }) {
  if (col.type === "text") return <T v={value} on={on} />;
  if (col.type === "num") return <N v={value} on={on} />;
  if (col.type === "money") return <N v={value} on={on} money />;
  return <S v={value} on={on} opts={col.type.select} />;
}

function Repeat({ list, errors, rows, on, cols, addLabel }: { list: string; errors: DiscoveryErrors; rows: any[]; on: (rows: any[]) => void; cols: Col[]; addLabel: string }) {
  const update = (i: number, key: string, val: any) => on(rows.map((r, j) => (j === i ? { ...r, [key]: val } : r)));
  const add = () => on([...rows, {}]);
  const remove = (i: number) => on(rows.filter((_, j) => j !== i));
  const template = cols.map((cc) => cc.w ?? "1fr").join(" ") + " 2rem";
  const err = (i: number, key: string) => errors[`${list}.${i}.${key}`];
  const removeBtn = (i: number) => (
    <button onClick={() => remove(i)} className="btn-icon text-muted-foreground hover:text-destructive" aria-label="Remove row" type="button">
      <Trash2 className="size-3.5" />
    </button>
  );
  return (
    <div className="space-y-2">
      {rows.length === 0 && <div className="text-xs text-muted-foreground px-1 py-2">None added yet.</div>}

      {/* Phones: one card per row, every box labelled. */}
      <div className="space-y-2 sm:hidden">
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg border border-border p-3">
            <div className="grid grid-cols-2 gap-2">
              {cols.map((cc, k) => (
                <div key={cc.key} className={k === 0 ? "col-span-2" : undefined}>
                  <F label={cc.label} error={err(i, cc.key)}><Cell col={cc} value={r[cc.key]} on={(x) => update(i, cc.key, x)} /></F>
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-end">{removeBtn(i)}</div>
          </div>
        ))}
      </div>

      {/* Wider screens: a table-like grid. */}
      {rows.length > 0 && (
        <div className="hidden overflow-x-auto sm:block">
          <div className="min-w-[36rem]">
            <div className="grid gap-2 text-2xs uppercase tracking-wider text-muted-foreground px-1" style={{ gridTemplateColumns: template }}>
              {cols.map((cc) => <div key={cc.key}>{cc.label}</div>)}
              <div />
            </div>
            {rows.map((r, i) => (
              <div key={i} className="grid gap-2 mt-1.5 items-start" style={{ gridTemplateColumns: template }}>
                {cols.map((cc) => (
                  <div key={cc.key}>
                    <Cell col={cc} value={r[cc.key]} on={(x) => update(i, cc.key, x)} />
                    {err(i, cc.key) && <div data-field-error className="mt-0.5 text-2xs font-medium text-destructive">{err(i, cc.key)}</div>}
                  </div>
                ))}
                {removeBtn(i)}
              </div>
            ))}
          </div>
        </div>
      )}
      <button onClick={add} type="button" className="inline-flex items-center gap-1 text-xs text-brand-cyan-deep hover:underline">
        <Plus className="size-3.5" /> {addLabel}
      </button>
    </div>
  );
}
