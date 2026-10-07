"use client";

/**
 * Step 2 — the one recommendation list.
 *
 * Mutual fund rows carry their own type — SIP, Lumpsum, SWP or STP — with the
 * fields that type needs. Those used to live on a separate "recommendation
 * worksheet" page whose rows the client never saw; now what the RM plans here
 * is exactly what the PDF and the client's approval page show.
 *
 * Every MF row is checked against the client's risk profile as it is added
 * (lib/proposals/fit.ts), and the footer shows the equity share once this
 * money goes in against the profile's ceiling. A row kept above the band asks
 * for a reason, which goes into the suitability record.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { SchemeAutocomplete } from "@/components/mf/SchemeAutocomplete";
import { AmcSelect } from "@/components/mf/AmcSelect";
import { SelectField } from "@/components/ui/SelectField";
import type { ProposalLineItem, RecommendationType } from "@/db/schema/proposals";
import type { ProposalSnapshot } from "@/lib/proposals/snapshot";
import { equityAfter, lineFit } from "@/lib/proposals/fit";
import { itemKindLabel, recommendationType, totals } from "@/lib/proposals/items";
import { riskometerLevel } from "@/lib/mf/scheme-risk";

export type Item = ProposalLineItem;
type MF = Extract<Item, { kind: "mf" }>;
type Ins = Extract<Item, { kind: "insurance" }>;
type PMS = Extract<Item, { kind: "pms" }>;
type AIF = Extract<Item, { kind: "aif" }>;
type Other = Extract<Item, { kind: "other" }>;

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const ADD: Array<{ label: string; make: () => Item }> = [
  { label: "SIP", make: () => ({ kind: "mf", schemeName: "", recommendationType: "sip" }) },
  { label: "Lumpsum", make: () => ({ kind: "mf", schemeName: "", recommendationType: "lumpsum" }) },
  { label: "SWP", make: () => ({ kind: "mf", schemeName: "", recommendationType: "swp" }) },
  { label: "STP", make: () => ({ kind: "mf", schemeName: "", recommendationType: "stp" }) },
  { label: "Insurance", make: () => ({ kind: "insurance", policyName: "" }) },
  { label: "PMS", make: () => ({ kind: "pms", strategyName: "" }) },
  { label: "AIF", make: () => ({ kind: "aif", fundName: "" }) },
  { label: "Other (FD / bonds)", make: () => ({ kind: "other", productName: "" }) },
];

export function RecommendStep({
  items,
  setItems,
  snapshot,
  locked,
}: {
  items: Item[];
  setItems: (next: Item[]) => void;
  snapshot: ProposalSnapshot | null;
  locked?: boolean;
}) {
  const profile = snapshot?.risk.category ?? null;
  const t = useMemo(() => totals(items), [items]);
  const eq = useMemo(() => equityAfter(items, snapshot), [items, snapshot]);
  const goals = snapshot?.goals.map((g) => g.name) ?? [];

  const patch = (i: number, p: Partial<Item>) => setItems(items.map((it, j) => (j === i ? ({ ...it, ...p } as Item) : it)));
  const remove = (i: number) => setItems(items.filter((_, j) => j !== i));

  return (
    <div className="space-y-3">
      {!locked && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Add a recommendation">
          {ADD.map((a) => (
            // Newest at the top, as the old form did.
            <button key={a.label} type="button" onClick={() => setItems([a.make(), ...items])} className="btn-secondary text-xs">
              <Plus className="size-3.5" /> {a.label}
            </button>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8 rounded-lg bg-secondary/50">
          No recommendations yet. Add a SIP, Lumpsum, SWP or STP — or insurance, PMS, AIF or other products.
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((it, i) => {
            const fit = lineFit(it, profile);
            return (
              <li key={i} className="rounded-xl border border-border/70 bg-background p-4">
                <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Badge tone="accent" raw>{itemKindLabel(it)}</Badge>
                    {it.kind === "mf" &&
                      (fit.status === "fits" ? (
                        <Badge tone="success" raw dot>Fits the profile</Badge>
                      ) : fit.status === "above" ? (
                        <Badge tone="warning" raw dot>Above the risk band</Badge>
                      ) : null)}
                  </div>
                  {!locked && (
                    <button type="button" onClick={() => remove(i)} className="btn-icon hover:text-rose-600" aria-label="Remove this recommendation">
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
                <fieldset disabled={locked} className="contents">
                  {it.kind === "mf" && <MFRow item={it} onPatch={(p) => patch(i, p)} goals={goals} />}
                  {it.kind === "insurance" && <InsRow item={it} onPatch={(p) => patch(i, p)} />}
                  {it.kind === "pms" && <PMSRow item={it} onPatch={(p) => patch(i, p)} />}
                  {it.kind === "aif" && <AIFRow item={it} onPatch={(p) => patch(i, p)} />}
                  {it.kind === "other" && <OtherRow item={it} onPatch={(p) => patch(i, p)} />}
                </fieldset>
                {it.kind === "mf" && fit.status !== "fits" && fit.message && (
                  <p className={`text-2xs mt-2 ${fit.status === "above" ? "text-warning" : "text-muted-foreground"}`}>{fit.message}</p>
                )}
                {it.kind === "mf" && fit.status === "above" && (
                  <label className="block mt-2">
                    <span className="text-2xs font-medium text-muted-foreground">
                      Reason to keep it — saved to the client's suitability record
                    </span>
                    <input
                      value={(it as MF).suitabilityReason ?? ""}
                      onChange={(e) => patch(i, { suitabilityReason: e.target.value } as Partial<MF>)}
                      placeholder="e.g. Client asked for small-cap exposure for a 15-year goal; discussed the risk."
                      className="input-base text-sm mt-1"
                      disabled={locked}
                    />
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {items.length > 0 && (
        <div className="rounded-lg bg-secondary/60 p-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="text-muted-foreground">Monthly SIP <b className="text-foreground tabular-nums">{t.monthly ? inr(t.monthly) : "—"}</b></span>
          <span className="text-muted-foreground">One-time <b className="text-foreground tabular-nums">{t.oneTime ? inr(t.oneTime) : "—"}</b></span>
          {t.transfers > 0 && (
            <span className="text-muted-foreground">Transfers <b className="text-foreground tabular-nums">{inr(t.transfers)}</b></span>
          )}
          <span className="text-muted-foreground">
            Equity after{" "}
            <b className={`tabular-nums ${eq.aboveBand ? "text-warning" : "text-foreground"}`}>{eq.pct != null ? `${Math.round(eq.pct)}%` : "—"}</b>
            {eq.ceiling != null && <span className="text-2xs"> (band up to {eq.ceiling}%)</span>}
          </span>
        </div>
      )}
      {eq.aboveBand && (
        <div className="rounded-lg border border-warning/50 bg-warning/5 text-sm p-3">
          {eq.before != null && eq.before > (eq.ceiling ?? 100) ? (
            <>
              The client's equity share is already {Math.round(eq.before)}%, above the {eq.ceiling}% a {profile?.replace(/_/g, " ")} profile
              allows, and this proposal {eq.pct! > eq.before ? `takes it to about ${Math.round(eq.pct!)}%` : `brings it to about ${Math.round(eq.pct!)}%`}.
              Consider adding debt or hybrid lines to bring it back towards the band.
            </>
          ) : (
            <>
              This proposal takes the client's equity share to about {Math.round(eq.pct!)}%, above the {eq.ceiling}% a{" "}
              {profile?.replace(/_/g, " ")} profile allows. Keep a reason on the rows driving it, or rebalance.
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Row editors ───────────────────────────────────────────────────────────

function Num({ label, unit, value, onChange, step = "1" }: { label: string; unit?: string; value?: number; onChange: (n: number | undefined) => void; step?: string }) {
  return (
    <label className="block">
      <span className="text-2xs font-medium text-muted-foreground">
        {label}
        {unit && <span className="opacity-70 ml-1">({unit})</span>}
      </span>
      <input
        type="number"
        min={0}
        step={step}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        className="input-base text-sm mt-1"
      />
    </label>
  );
}

function Text({ label, value, onChange, placeholder, required }: { label: string; value: string; onChange: (s: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="text-2xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
      </span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="input-base text-sm mt-1" />
    </label>
  );
}

const MF_CATEGORIES = [
  "Large Cap", "Large & Mid Cap", "Mid Cap", "Small Cap", "Flexi Cap", "Multi Cap",
  "ELSS", "Index", "Hybrid", "Balanced Advantage", "Debt", "Liquid", "Gold", "Other",
];

/** Map a raw catalog category onto a clean bucket; most specific first. */
function mapSchemeCategory(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const rules: Array<[RegExp, string]> = [
    [/large\s*&\s*mid|large\s*and\s*mid/i, "Large & Mid Cap"],
    [/flexi\s*cap/i, "Flexi Cap"],
    [/multi\s*cap/i, "Multi Cap"],
    [/large\s*cap/i, "Large Cap"],
    [/mid\s*cap/i, "Mid Cap"],
    [/small\s*cap/i, "Small Cap"],
    [/elss|tax\s*saver/i, "ELSS"],
    [/index|nifty|sensex|etf/i, "Index"],
    [/balanced\s*advantage|dynamic\s*asset/i, "Balanced Advantage"],
    [/hybrid|balanced|arbitrage/i, "Hybrid"],
    [/liquid|overnight|money\s*market/i, "Liquid"],
    [/debt|bond|gilt|duration|credit/i, "Debt"],
    [/gold|silver|commodit/i, "Gold"],
  ];
  for (const [re, cat] of rules) if (re.test(raw)) return cat;
  return undefined;
}

/** Fields that belong to each MF type. Switching type clears the rest, so a
 *  SIP's monthly amount can't linger on a Lumpsum line and inflate totals. */
const TYPE_FIELDS: Record<RecommendationType, Array<keyof MF>> = {
  sip: ["monthlyAmount", "stepUpPct", "lumpsum", "sipTermYears", "expectedReturn", "projectedCorpus"],
  lumpsum: ["lumpsum", "sipTermYears", "expectedReturn", "projectedCorpus"],
  swp: ["corpusRequired", "monthlyWithdrawal", "swpPeriodMonths"],
  stp: ["toSchemeName", "toSchemeCode", "monthlyTransfer", "numInstallments"],
};
const ALL_TYPE_FIELDS = [...new Set(Object.values(TYPE_FIELDS).flat())];

/** Future value: lumpsum compounded annually (as before) + a monthly SIP
 *  that steps up once a year, paid at the start of each month. */
function projectSip(sip: number, lumpsum: number, years: number, ratePct: number, stepUpPct: number): number {
  const fvLump = lumpsum * Math.pow(1 + ratePct / 100, years);
  const m = ratePct / 100 / 12;
  let corpus = 0;
  let monthly = sip;
  for (let k = 0; k < Math.round(years * 12); k++) {
    if (k > 0 && k % 12 === 0) monthly *= 1 + stepUpPct / 100;
    corpus = (corpus + monthly) * (1 + m);
  }
  return Math.round(fvLump + corpus);
}

function MFRow({ item, onPatch, goals }: { item: MF; onPatch: (p: Partial<MF>) => void; goals: string[] }) {
  const rt = recommendationType(item) ?? "sip";
  const [customCat, setCustomCat] = useState(false);

  // Keep the projection current for SIP and Lumpsum lines.
  useEffect(() => {
    const years = Number(item.sipTermYears ?? 0);
    const rate = Number(item.expectedReturn ?? 0);
    if (years <= 0 || rate <= 0) return;
    let next: number | null = null;
    if (rt === "sip") {
      const sip = Number(item.monthlyAmount ?? 0), lump = Number(item.lumpsum ?? 0);
      if (sip > 0 || lump > 0) next = projectSip(sip, lump, years, rate, Number(item.stepUpPct ?? 0));
    } else if (rt === "lumpsum") {
      const lump = Number(item.lumpsum ?? 0);
      if (lump > 0) next = Math.round(lump * Math.pow(1 + rate / 100, years));
    }
    if (next != null && next !== item.projectedCorpus) onPatch({ projectedCorpus: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, item.lumpsum, item.monthlyAmount, item.sipTermYears, item.expectedReturn, item.stepUpPct]);

  function setType(next: RecommendationType) {
    if (next === rt) return;
    const keep = new Set(TYPE_FIELDS[next]);
    const cleared: Partial<MF> = { recommendationType: next };
    for (const f of ALL_TYPE_FIELDS) if (!keep.has(f)) (cleared as any)[f] = undefined;
    onPatch(cleared);
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="sm:col-span-3">
        <span className="text-2xs font-medium text-muted-foreground">How the money goes in</span>
        <div className="mt-1 inline-flex rounded-lg bg-secondary p-0.5 gap-0.5" role="group" aria-label="Recommendation type">
          {(["sip", "lumpsum", "swp", "stp"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={rt === k}
              onClick={() => setType(k)}
              className={`px-3 py-1 text-xs rounded-md ${rt === k ? "bg-background shadow-sm font-semibold" : "text-muted-foreground"}`}
            >
              {{ sip: "SIP", lumpsum: "Lumpsum", swp: "SWP", stp: "STP" }[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="sm:col-span-2">
        <span className="text-2xs font-medium text-muted-foreground">
          {rt === "stp" ? "From scheme" : "Scheme"} <span className="text-rose-500">*</span>
        </span>
        <div className="mt-1">
          {/* Picked from the firm's Scheme Master only (narrowed to the AMC when one is chosen). */}
          {/* Regular plans only: a distributor's proposal recommends the plan it services. */}
          <SchemeAutocomplete
            defaultValue={item.schemeName}
            amc={item.amcName || null}
            plan="regular"
            onClear={() => onPatch({ schemeName: "", schemeCode: undefined })}
            onSelect={(s) =>
              onPatch({
                schemeName: s.schemeName,
                schemeCode: (s as any).schemeCode ?? item.schemeCode,
                amcName: s.amc ?? item.amcName,
                category: mapSchemeCategory(s.category) ?? item.category,
                // The scheme decides these two, so a new pick replaces the old
                // scheme's values (or clears them when it is not known).
                riskRating: riskometerLevel(s.risk?.band),
                planType: s.plan ?? undefined,
              })
            }
            placeholder="Search your Scheme Master…"
          />
        </div>
      </div>
      <label className="block">
        <span className="text-2xs font-medium text-muted-foreground">AMC</span>
        <div className="mt-1">
          <AmcSelect
            value={item.amcName}
            aria-label="AMC"
            // A scheme belongs to one AMC: changing the AMC drops a scheme from another one.
            onChange={(v) => onPatch(v !== (item.amcName ?? "") && item.schemeName
              ? { amcName: v, schemeName: "", schemeCode: undefined }
              : { amcName: v })}
          />
        </div>
      </label>

      <label className="block">
        <span className="text-2xs font-medium text-muted-foreground">Category</span>
        {customCat || (item.category && !MF_CATEGORIES.includes(item.category)) ? (
          <div className="flex items-center gap-1 mt-1">
            <input value={item.category ?? ""} onChange={(e) => onPatch({ category: e.target.value })} placeholder="Type a category" className="input-base text-sm w-full" />
            <button type="button" onClick={() => { setCustomCat(false); onPatch({ category: "" }); }} className="btn-ghost text-xs px-2 shrink-0" aria-label="Back to the list">↩</button>
          </div>
        ) : (
          <select
            value={item.category ?? ""}
            onChange={(e) => (e.target.value === "__custom__" ? (setCustomCat(true), onPatch({ category: "" })) : onPatch({ category: e.target.value }))}
            className="input-base text-sm w-full mt-1"
          >
            <option value="">— Select —</option>
            {MF_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="__custom__">+ Other…</option>
          </select>
        )}
      </label>

      <label className="block">
        <span className="text-2xs font-medium text-muted-foreground">Riskometer</span>
        <SelectField value={item.riskRating ?? ""} onChange={(e) => onPatch({ riskRating: (e.target.value || undefined) as any })} className="input-base text-sm mt-1">
          <option value="">Select…</option>
          <option value="low">Low</option>
          <option value="low_to_moderate">Low to moderate</option>
          <option value="moderate">Moderate</option>
          <option value="moderately_high">Moderately high</option>
          <option value="high">High</option>
          <option value="very_high">Very high</option>
        </SelectField>
      </label>

      <label className="block">
        <span className="text-2xs font-medium text-muted-foreground">Plan</span>
        <SelectField value={item.planType ?? ""} onChange={(e) => onPatch({ planType: (e.target.value || undefined) as any })} className="input-base text-sm mt-1">
          <option value="">—</option>
          <option value="regular">Regular</option>
          <option value="direct">Direct</option>
        </SelectField>
      </label>

      {rt === "sip" && (
        <>
          <Num label="Monthly SIP" unit="₹/mo" value={item.monthlyAmount} onChange={(n) => onPatch({ monthlyAmount: n })} />
          <Num label="Annual step-up" unit="%" value={item.stepUpPct} onChange={(n) => onPatch({ stepUpPct: n })} step="0.5" />
          <Num label="Starting lumpsum" unit="₹, optional" value={item.lumpsum} onChange={(n) => onPatch({ lumpsum: n })} />
          <Num label="Term" unit="yrs" value={item.sipTermYears} onChange={(n) => onPatch({ sipTermYears: n })} />
          <Num label="Expected return" unit="% p.a." value={item.expectedReturn} onChange={(n) => onPatch({ expectedReturn: n })} step="0.1" />
          <Num label="Projected corpus" unit="₹" value={item.projectedCorpus} onChange={(n) => onPatch({ projectedCorpus: n })} />
        </>
      )}
      {rt === "lumpsum" && (
        <>
          <Num label="Amount" unit="₹" value={item.lumpsum} onChange={(n) => onPatch({ lumpsum: n })} />
          <Num label="Horizon" unit="yrs" value={item.sipTermYears} onChange={(n) => onPatch({ sipTermYears: n })} />
          <Num label="Expected return" unit="% p.a." value={item.expectedReturn} onChange={(n) => onPatch({ expectedReturn: n })} step="0.1" />
          <Num label="Projected value" unit="₹" value={item.projectedCorpus} onChange={(n) => onPatch({ projectedCorpus: n })} />
        </>
      )}
      {rt === "swp" && (
        <>
          <Num label="Corpus" unit="₹" value={item.corpusRequired} onChange={(n) => onPatch({ corpusRequired: n })} />
          <Num label="Monthly withdrawal" unit="₹/mo" value={item.monthlyWithdrawal} onChange={(n) => onPatch({ monthlyWithdrawal: n })} />
          <Num label="Period" unit="months" value={item.swpPeriodMonths} onChange={(n) => onPatch({ swpPeriodMonths: n })} />
        </>
      )}
      {rt === "stp" && (
        <>
          <div className="sm:col-span-2">
            <span className="text-2xs font-medium text-muted-foreground">Into scheme</span>
            <div className="mt-1">
              <SchemeAutocomplete
                defaultValue={item.toSchemeName ?? ""}
                plan="regular"
                onClear={() => onPatch({ toSchemeName: "", toSchemeCode: undefined })}
                onSelect={(s) => onPatch({ toSchemeName: s.schemeName, toSchemeCode: (s as any).schemeCode ?? item.toSchemeCode })}
                placeholder="The scheme the money moves into…"
              />
            </div>
          </div>
          <Num label="Monthly transfer" unit="₹/mo" value={item.monthlyTransfer} onChange={(n) => onPatch({ monthlyTransfer: n })} />
          <Num label="Instalments" value={item.numInstallments} onChange={(n) => onPatch({ numInstallments: n })} />
        </>
      )}

      <label className="block">
        <span className="text-2xs font-medium text-muted-foreground">Goal</span>
        <input
          list="proposal-goals"
          value={item.goal ?? ""}
          onChange={(e) => onPatch({ goal: e.target.value || undefined })}
          placeholder={goals[0] ?? "Retirement, child's education…"}
          className="input-base text-sm mt-1"
        />
        <datalist id="proposal-goals">
          {goals.map((g) => <option key={g} value={g} />)}
        </datalist>
      </label>
      <div className="sm:col-span-3">
        <Text label="Notes / rationale" value={item.notes ?? ""} onChange={(v) => onPatch({ notes: v })} placeholder="Why this scheme, in a sentence the client would understand." />
      </div>
    </div>
  );
}

function InsRow({ item, onPatch }: { item: Ins; onPatch: (p: Partial<Ins>) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="sm:col-span-2">
        <Text label="Policy name" required value={item.policyName} onChange={(v) => onPatch({ policyName: v })} placeholder="HDFC Life Click 2 Protect Super" />
      </div>
      <Text label="Insurer" value={item.insurer ?? ""} onChange={(v) => onPatch({ insurer: v })} placeholder="HDFC Life" />
      <label className="block">
        <span className="text-2xs font-medium text-muted-foreground">Policy type</span>
        <SelectField value={item.policyType ?? ""} onChange={(e) => onPatch({ policyType: (e.target.value || undefined) as any })} className="input-base text-sm mt-1">
          <option value="">Select…</option>
          <option value="term">Term</option>
          <option value="ulip">ULIP</option>
          <option value="endowment">Endowment</option>
          <option value="health">Health</option>
          <option value="money_back">Money-back</option>
          <option value="other">Other</option>
        </SelectField>
      </label>
      <Num label="Sum assured" unit="₹" value={item.sumAssured} onChange={(n) => onPatch({ sumAssured: n })} />
      <Num label="Annual premium" unit="₹" value={item.annualPremium} onChange={(n) => onPatch({ annualPremium: n })} />
      <Num label="Term" unit="yrs" value={item.termYears} onChange={(n) => onPatch({ termYears: n })} />
      <div className="sm:col-span-3">
        <Text label="Notes / rationale" value={item.notes ?? ""} onChange={(v) => onPatch({ notes: v })} placeholder="₹1 cr cover at age 35; critical illness rider recommended." />
      </div>
    </div>
  );
}

function PMSRow({ item, onPatch }: { item: PMS; onPatch: (p: Partial<PMS>) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="sm:col-span-2">
        <Text label="Strategy name" required value={item.strategyName} onChange={(v) => onPatch({ strategyName: v })} placeholder="Marcellus Consistent Compounders" />
      </div>
      <Text label="Manager" value={item.manager ?? ""} onChange={(v) => onPatch({ manager: v })} placeholder="Marcellus PMS" />
      <Num label="Min investment" unit="₹" value={item.minInvestment} onChange={(n) => onPatch({ minInvestment: n })} />
      <Num label="Proposed amount" unit="₹" value={item.proposedAmount} onChange={(n) => onPatch({ proposedAmount: n })} />
      <Num label="Expected return" unit="% p.a." value={item.expectedReturn} onChange={(n) => onPatch({ expectedReturn: n })} step="0.1" />
      <Num label="Horizon" unit="yrs" value={item.termYears} onChange={(n) => onPatch({ termYears: n })} />
      <div className="sm:col-span-3">
        <Text label="Notes / rationale" value={item.notes ?? ""} onChange={(v) => onPatch({ notes: v })} placeholder="Suitable for HNI clients with a 5+ year horizon." />
      </div>
    </div>
  );
}

function AIFRow({ item, onPatch }: { item: AIF; onPatch: (p: Partial<AIF>) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="sm:col-span-2">
        <Text label="Fund name" required value={item.fundName} onChange={(v) => onPatch({ fundName: v })} placeholder="ICICI Pru Long-Short Fund Series II" />
      </div>
      <Text label="Manager" value={item.manager ?? ""} onChange={(v) => onPatch({ manager: v })} placeholder="ICICI Prudential AIF" />
      <label className="block">
        <span className="text-2xs font-medium text-muted-foreground">Category</span>
        <SelectField value={item.category ?? ""} onChange={(e) => onPatch({ category: (e.target.value || undefined) as any })} className="input-base text-sm mt-1">
          <option value="">Select…</option>
          <option value="cat1">Cat I</option>
          <option value="cat2">Cat II</option>
          <option value="cat3">Cat III</option>
        </SelectField>
      </label>
      <Num label="Min investment" unit="₹" value={item.minInvestment} onChange={(n) => onPatch({ minInvestment: n })} />
      <Num label="Proposed amount" unit="₹" value={item.proposedAmount} onChange={(n) => onPatch({ proposedAmount: n })} />
      <Num label="Lock-in" unit="yrs" value={item.lockInYears} onChange={(n) => onPatch({ lockInYears: n })} />
      <Num label="Target IRR" unit="% p.a." value={item.targetIrr} onChange={(n) => onPatch({ targetIrr: n })} step="0.1" />
      <div className="sm:col-span-3">
        <Text label="Notes / rationale" value={item.notes ?? ""} onChange={(v) => onPatch({ notes: v })} placeholder="₹1 cr minimum; 3-year lock-in; accredited investors only." />
      </div>
    </div>
  );
}

function OtherRow({ item, onPatch }: { item: Other; onPatch: (p: Partial<Other>) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="sm:col-span-2">
        <Text label="Product name" required value={item.productName} onChange={(v) => onPatch({ productName: v })} placeholder="Bank FD / Sovereign Gold Bond / NPS Tier-I" />
      </div>
      <Text label="Company / issuer" value={item.company ?? ""} onChange={(v) => onPatch({ company: v })} placeholder="SBI / RBI / NSDL" />
      <Num label="Amount" unit="₹" value={item.amount} onChange={(n) => onPatch({ amount: n })} />
      <Num label="Expected return" unit="% p.a." value={item.expectedReturn} onChange={(n) => onPatch({ expectedReturn: n })} step="0.1" />
      <Num label="Term" unit="yrs" value={item.termYears} onChange={(n) => onPatch({ termYears: n })} />
      <div className="sm:col-span-3">
        <Text label="Notes / rationale" value={item.notes ?? ""} onChange={(v) => onPatch({ notes: v })} placeholder="Why this product suits the client." />
      </div>
    </div>
  );
}
