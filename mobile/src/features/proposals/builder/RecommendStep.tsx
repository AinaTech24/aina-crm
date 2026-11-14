/**
 * Step 2 — the one recommendation list (web builder/RecommendStep).
 *
 * Mutual fund rows carry their own type — SIP, Lumpsum, SWP or STP — with the
 * fields that type needs; switching type clears the rest. Every MF scheme is
 * picked from the firm's Scheme Master (Regular plans only). Each MF row is
 * checked against the client's risk profile as it is added (shared/fit), and
 * the footer shows the equity share once this money goes in against the
 * profile's ceiling. A row kept above the band asks for a reason, which goes
 * into the suitability record.
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../../components/ui/Text";
import { TextField } from "../../../components/ui/TextField";
import { SelectField } from "../../../components/ui/SelectField";
import { Segmented } from "../../../components/ui/Segmented";
import { StatusPill } from "../../../components/ui/StatusPill";
import { useAmcs, riskometerLevel, INSURERS, type ProposalLine, type MfLine, type InsuranceLine, type PmsLine, type AifLine, type OtherLine, type RecommendationType, type ProposalSnapshot, type SchemeHit } from "../api";
import { equityAfter, lineFit } from "../shared/fit";
import { itemKindLabel, recommendationType, totals } from "../shared/items";
import { NumField, Pair, SchemeButton, SchemePicker, Banner } from "../ui";
import { spacing, palette, radius, fontWeight } from "../../../theme/tokens";

type Items = ProposalLine[];
type SetItems = React.Dispatch<React.SetStateAction<Items>>;

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const ADD: Array<{ label: string; make: () => ProposalLine }> = [
  // The firm distributes Regular plans only (2026-10-07), so every MF line starts Regular.
  { label: "SIP", make: () => ({ kind: "mf", schemeName: "", recommendationType: "sip", planType: "regular" }) },
  { label: "Lumpsum", make: () => ({ kind: "mf", schemeName: "", recommendationType: "lumpsum", planType: "regular" }) },
  { label: "SWP", make: () => ({ kind: "mf", schemeName: "", recommendationType: "swp", planType: "regular" }) },
  { label: "STP", make: () => ({ kind: "mf", schemeName: "", recommendationType: "stp", planType: "regular" }) },
  { label: "Insurance", make: () => ({ kind: "insurance", policyName: "" }) },
  { label: "PMS", make: () => ({ kind: "pms", strategyName: "" }) },
  { label: "AIF", make: () => ({ kind: "aif", fundName: "" }) },
  { label: "Other (FD / bonds)", make: () => ({ kind: "other", productName: "" }) },
];

let seq = 0;
const newKey = () => `l${++seq}`;

export function RecommendStep({ items, setItems, snapshot, locked }: { items: Items; setItems: SetItems; snapshot: ProposalSnapshot | null | undefined; locked?: boolean }) {
  const profile = snapshot?.risk.category ?? null;
  const t = totals(items);
  const eq = equityAfter(items, snapshot ?? null);
  const goals = snapshot?.goals.map((g) => g.name) ?? [];
  const [schemeFor, setSchemeFor] = React.useState<null | { index: number; target: "from" | "to" }>(null);
  const amcs = useAmcs();

  // Stable row keys, so a row added at the top doesn't hand its neighbours' typing state around.
  const keys = React.useRef<string[]>([]);
  if (keys.current.length !== items.length) keys.current = items.map(() => newKey());

  const patch = (i: number, p: Partial<ProposalLine>) => setItems((prev) => prev.map((it, j) => (j === i ? ({ ...it, ...p } as ProposalLine) : it)));
  const add = (make: () => ProposalLine) => { keys.current = [newKey(), ...keys.current]; setItems((prev) => [make(), ...prev]); };
  const remove = (i: number) => { keys.current = keys.current.filter((_, j) => j !== i); setItems((prev) => prev.filter((_, j) => j !== i)); };
  const amcCode = (name?: string) => {
    if (!name) return null;
    const v = name.toLowerCase();
    return amcs.data?.amcs.find((a) => a.code.toLowerCase() === v || a.name.toLowerCase() === v)?.code ?? null;
  };

  const pickScheme = (s: SchemeHit) => {
    if (!schemeFor) return;
    const { index, target } = schemeFor;
    const cur = items[index] as MfLine | undefined;
    if (target === "to") patch(index, { toSchemeName: s.schemeName, toSchemeCode: s.schemeCode } as Partial<MfLine>);
    else patch(index, {
      schemeName: s.schemeName,
      schemeCode: s.schemeCode ?? cur?.schemeCode,
      amcName: s.amc ?? cur?.amcName,
      category: mapSchemeCategory(s.category) ?? cur?.category,
      // The scheme decides the riskometer, so a new pick replaces the old one (or clears it when unknown).
      riskRating: riskometerLevel(s.risk?.band),
      planType: "regular",
    } as Partial<MfLine>);
    setSchemeFor(null);
  };

  return (
    <View style={{ gap: spacing.md }}>
      {!locked ? (
        <View style={styles.addRow} accessibilityLabel="Add a recommendation">
          {ADD.map((a) => (
            <Pressable key={a.label} onPress={() => add(a.make)} style={styles.addBtn} accessibilityRole="button">
              <Feather name="plus" size={14} color={palette.ink} />
              <Text variant="label" style={{ color: palette.ink }}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text variant="caption" tone="muted" center>No recommendations yet. Add a SIP, Lumpsum, SWP or STP — or insurance, PMS, AIF or other products.</Text>
        </View>
      ) : (
        items.map((it, i) => {
          const fit = lineFit(it, profile);
          return (
            <View key={keys.current[i]} style={styles.row}>
              <View style={styles.rowHead}>
                <View style={styles.kind}><Text variant="caption" style={{ color: palette.brandDark, fontWeight: fontWeight.semibold }}>{itemKindLabel(it)}</Text></View>
                {it.kind === "mf" && fit.status === "fits" ? <StatusPill size="sm" tone="success" label="Fits the profile" /> : null}
                {it.kind === "mf" && fit.status === "above" ? <StatusPill size="sm" tone="warning" label="Above the risk band" /> : null}
                <View style={{ flex: 1 }} />
                {!locked ? (
                  <Pressable onPress={() => remove(i)} hitSlop={8} style={styles.icon} accessibilityRole="button" accessibilityLabel="Remove this recommendation">
                    <Feather name="trash-2" size={16} color={palette.muted} />
                  </Pressable>
                ) : null}
              </View>
              {it.kind === "mf" ? (
                <MFRow item={it} onPatch={(p) => patch(i, p)} goals={goals} locked={locked} amcs={amcs.data?.amcs ?? []}
                  onPickScheme={(target) => setSchemeFor({ index: i, target })} />
              ) : null}
              {it.kind === "insurance" ? <InsRow item={it} onPatch={(p) => patch(i, p)} locked={locked} /> : null}
              {it.kind === "pms" ? <PMSRow item={it} onPatch={(p) => patch(i, p)} locked={locked} /> : null}
              {it.kind === "aif" ? <AIFRow item={it} onPatch={(p) => patch(i, p)} locked={locked} /> : null}
              {it.kind === "other" ? <OtherRow item={it} onPatch={(p) => patch(i, p)} locked={locked} /> : null}
              {it.kind === "mf" && fit.status !== "fits" && fit.message ? (
                <Text variant="caption" style={{ color: fit.status === "above" ? palette.warning : palette.muted, marginBottom: spacing.sm }}>{fit.message}</Text>
              ) : null}
              {it.kind === "mf" && fit.status === "above" ? (
                <TextField
                  label="Reason to keep it — saved to the client's suitability record"
                  value={it.suitabilityReason ?? ""}
                  onChangeText={(v) => patch(i, { suitabilityReason: v.slice(0, 1000) || undefined } as Partial<MfLine>)}
                  placeholder="e.g. Client asked for small-cap exposure for a 15-year goal; discussed the risk."
                  disabled={locked}
                  multiline
                />
              ) : null}
            </View>
          );
        })
      )}

      {items.length > 0 ? (
        <View style={styles.totals}>
          <Fact label="Monthly SIP" value={t.monthly ? rupees(t.monthly) : "—"} />
          <Fact label="One-time" value={t.oneTime ? rupees(t.oneTime) : "—"} />
          {t.transfers > 0 ? <Fact label="Transfers" value={rupees(t.transfers)} /> : null}
          <Fact label={`Equity after${eq.ceiling != null ? ` (band up to ${eq.ceiling}%)` : ""}`} value={eq.pct != null ? `${Math.round(eq.pct)}%` : "—"} warn={eq.aboveBand} />
        </View>
      ) : null}
      {eq.aboveBand ? (
        <Banner tone="warning">
          <Text variant="caption" style={{ color: palette.ink }}>
            {eq.before != null && eq.before > (eq.ceiling ?? 100)
              ? `The client's equity share is already ${Math.round(eq.before)}%, above the ${eq.ceiling}% a ${profile?.replace(/_/g, " ")} profile allows, and this proposal ${eq.pct! > eq.before ? `takes it to about ${Math.round(eq.pct!)}%` : `brings it to about ${Math.round(eq.pct!)}%`}. Consider adding debt or hybrid lines to bring it back towards the band.`
              : `This proposal takes the client's equity share to about ${Math.round(eq.pct!)}%, above the ${eq.ceiling}% a ${profile?.replace(/_/g, " ")} profile allows. Keep a reason on the rows driving it, or rebalance.`}
          </Text>
        </Banner>
      ) : null}

      {schemeFor ? (
        <SchemePicker
          amc={schemeFor.target === "from" ? amcCode((items[schemeFor.index] as MfLine | undefined)?.amcName) : null}
          onClose={() => setSchemeFor(null)}
          onPick={pickScheme}
        />
      ) : null}
    </View>
  );
}

function Fact({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={{ minWidth: "45%", flexGrow: 1 }}>
      <Text variant="caption" tone="muted">{label}</Text>
      <Text style={{ fontWeight: fontWeight.semibold, color: warn ? palette.warning : palette.ink }}>{value}</Text>
    </View>
  );
}

// ─── Row editors ───────────────────────────────────────────────────────────

const MF_CATEGORIES = [
  "Large Cap", "Large & Mid Cap", "Mid Cap", "Small Cap", "Flexi Cap", "Multi Cap",
  "ELSS", "Index", "Hybrid", "Balanced Advantage", "Debt", "Liquid", "Gold", "Other",
];

/** Map a raw catalog category onto a clean bucket; most specific first (web RecommendStep). */
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
const TYPE_FIELDS: Record<RecommendationType, Array<keyof MfLine>> = {
  sip: ["monthlyAmount", "stepUpPct", "lumpsum", "sipTermYears", "expectedReturn", "projectedCorpus"],
  lumpsum: ["lumpsum", "sipTermYears", "expectedReturn", "projectedCorpus"],
  swp: ["corpusRequired", "monthlyWithdrawal", "swpPeriodMonths"],
  stp: ["toSchemeName", "toSchemeCode", "monthlyTransfer", "numInstallments"],
};
const ALL_TYPE_FIELDS = [...new Set(Object.values(TYPE_FIELDS).flat())];

/** Future value: lumpsum compounded annually + a monthly SIP that steps up once a year, paid at the start of each month. */
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

const RISKOMETER = [
  { value: "", label: "Select…" }, { value: "low", label: "Low" }, { value: "low_to_moderate", label: "Low to moderate" },
  { value: "moderate", label: "Moderate" }, { value: "moderately_high", label: "Moderately high" }, { value: "high", label: "High" }, { value: "very_high", label: "Very high" },
];

function MFRow({ item, onPatch, goals, locked, amcs, onPickScheme }: {
  item: MfLine; onPatch: (p: Partial<MfLine>) => void; goals: string[]; locked?: boolean;
  amcs: Array<{ code: string; name: string }>; onPickScheme: (target: "from" | "to") => void;
}) {
  const rt = recommendationType(item) ?? "sip";
  const [customCat, setCustomCat] = React.useState(false);

  // Keep the projection current for SIP and Lumpsum lines.
  React.useEffect(() => {
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

  const setType = (next: RecommendationType) => {
    if (locked || next === rt) return;
    const keep = new Set(TYPE_FIELDS[next]);
    const cleared: Partial<MfLine> = { recommendationType: next };
    for (const f of ALL_TYPE_FIELDS) if (!keep.has(f)) (cleared as any)[f] = undefined;
    onPatch(cleared);
  };

  const v = (item.amcName ?? "").toLowerCase();
  const amcMatch = amcs.find((a) => a.code.toLowerCase() === v || a.name.toLowerCase() === v);
  const amcOptions = [
    { value: "", label: "Select AMC…" },
    ...(item.amcName && !amcMatch ? [{ value: item.amcName, label: `${item.amcName} (not in AMC master)` }] : []),
    ...amcs.map((a) => ({ value: a.code, label: a.name })),
  ];
  const typedCat = customCat || (!!item.category && !MF_CATEGORIES.includes(item.category));

  return (
    <View>
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>How the money goes in</Text>
      <Segmented options={[{ key: "sip", label: "SIP" }, { key: "lumpsum", label: "Lumpsum" }, { key: "swp", label: "SWP" }, { key: "stp", label: "STP" }]} value={rt} onChange={(k) => setType(k as RecommendationType)} />
      <View style={{ height: spacing.md }} />
      <SchemeButton
        label={rt === "stp" ? "From scheme" : "Scheme"}
        required
        value={item.schemeName}
        sub={[item.amcName, item.category].filter(Boolean).join(" · ")}
        placeholder="Search your Scheme Master…"
        onPress={() => onPickScheme("from")}
        disabled={locked}
      />
      <SelectField
        label="AMC"
        value={amcMatch ? amcMatch.code : item.amcName ?? ""}
        options={amcOptions}
        disabled={locked}
        // A scheme belongs to one AMC: changing the AMC drops a scheme from another one.
        onChange={(code) => {
          const next = code || undefined;
          onPatch(next !== (item.amcName || undefined) && amcMatch?.code !== code && item.schemeName
            ? { amcName: next, schemeName: "", schemeCode: undefined }
            : { amcName: next });
        }}
      />
      {typedCat ? (
        <View>
          <TextField label="Category" value={item.category ?? ""} onChangeText={(c) => onPatch({ category: c || undefined })} placeholder="Type a category" disabled={locked} />
          {!locked ? <Text variant="caption" tone="brand" onPress={() => { setCustomCat(false); onPatch({ category: undefined }); }} style={{ marginTop: -spacing.md, marginBottom: spacing.md }}>Back to the list</Text> : null}
        </View>
      ) : (
        <SelectField
          label="Category"
          value={item.category ?? ""}
          options={[{ value: "", label: "— Select —" }, ...MF_CATEGORIES.map((c) => ({ value: c, label: c })), { value: "__custom__", label: "+ Other…" }]}
          disabled={locked}
          onChange={(c) => (c === "__custom__" ? (setCustomCat(true), onPatch({ category: undefined })) : onPatch({ category: c || undefined }))}
        />
      )}
      <Pair>
        <SelectField label="Riskometer" value={item.riskRating ?? ""} options={RISKOMETER} disabled={locked} onChange={(r) => onPatch({ riskRating: (r || undefined) as MfLine["riskRating"] })} />
        {item.planType === "direct" ? (
          // Regular only (the firm's rule, 2026-10-07). A line saved as Direct before that still says so until changed.
          <SelectField label="Plan" value="direct" options={[{ value: "regular", label: "Regular" }, { value: "direct", label: "Direct" }]} disabled={locked} onChange={(p) => onPatch({ planType: p as MfLine["planType"] })} />
        ) : (
          <View style={{ marginBottom: spacing.lg }}>
            <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Plan</Text>
            <View style={styles.readonly}><Text style={{ color: palette.ink }}>Regular</Text></View>
          </View>
        )}
      </Pair>

      {rt === "sip" ? (
        <>
          <Pair>
            <NumField label="Monthly SIP" unit="₹/mo" value={item.monthlyAmount} onChange={(n) => onPatch({ monthlyAmount: n })} disabled={locked} />
            <NumField label="Annual step-up" unit="%" value={item.stepUpPct} onChange={(n) => onPatch({ stepUpPct: n })} max={100} disabled={locked} />
          </Pair>
          <Pair>
            <NumField label="Starting lumpsum" unit="₹, optional" value={item.lumpsum} onChange={(n) => onPatch({ lumpsum: n })} disabled={locked} />
            <NumField label="Term" unit="yrs" value={item.sipTermYears} onChange={(n) => onPatch({ sipTermYears: n })} max={50} disabled={locked} />
          </Pair>
          <Pair>
            <NumField label="Expected return" unit="% p.a." value={item.expectedReturn} onChange={(n) => onPatch({ expectedReturn: n })} max={60} disabled={locked} />
            <NumField label="Projected corpus" unit="₹" value={item.projectedCorpus} onChange={(n) => onPatch({ projectedCorpus: n })} disabled={locked} />
          </Pair>
        </>
      ) : null}
      {rt === "lumpsum" ? (
        <>
          <Pair>
            <NumField label="Amount" unit="₹" value={item.lumpsum} onChange={(n) => onPatch({ lumpsum: n })} disabled={locked} />
            <NumField label="Horizon" unit="yrs" value={item.sipTermYears} onChange={(n) => onPatch({ sipTermYears: n })} max={50} disabled={locked} />
          </Pair>
          <Pair>
            <NumField label="Expected return" unit="% p.a." value={item.expectedReturn} onChange={(n) => onPatch({ expectedReturn: n })} max={60} disabled={locked} />
            <NumField label="Projected value" unit="₹" value={item.projectedCorpus} onChange={(n) => onPatch({ projectedCorpus: n })} disabled={locked} />
          </Pair>
        </>
      ) : null}
      {rt === "swp" ? (
        <>
          <Pair>
            <NumField label="Corpus" unit="₹" value={item.corpusRequired} onChange={(n) => onPatch({ corpusRequired: n })} disabled={locked} />
            <NumField label="Monthly withdrawal" unit="₹/mo" value={item.monthlyWithdrawal} onChange={(n) => onPatch({ monthlyWithdrawal: n })} disabled={locked} />
          </Pair>
          <NumField label="Period" unit="months" value={item.swpPeriodMonths} onChange={(n) => onPatch({ swpPeriodMonths: n })} max={600} int disabled={locked} />
        </>
      ) : null}
      {rt === "stp" ? (
        <>
          <SchemeButton label="Into scheme" value={item.toSchemeName} placeholder="The scheme the money moves into…" onPress={() => onPickScheme("to")} disabled={locked} />
          <Pair>
            <NumField label="Monthly transfer" unit="₹/mo" value={item.monthlyTransfer} onChange={(n) => onPatch({ monthlyTransfer: n })} disabled={locked} />
            <NumField label="Instalments" value={item.numInstallments} onChange={(n) => onPatch({ numInstallments: n })} max={600} int disabled={locked} />
          </Pair>
        </>
      ) : null}

      <TextField label="Goal" value={item.goal ?? ""} onChangeText={(g) => onPatch({ goal: g.slice(0, 120) || undefined })} placeholder={goals[0] ?? "Retirement, child's education…"} disabled={locked} />
      {!locked && goals.length > 0 ? (
        <View style={styles.goalChips}>
          {goals.filter((g) => g !== item.goal).slice(0, 4).map((g) => (
            <Pressable key={g} onPress={() => onPatch({ goal: g.slice(0, 120) })} style={styles.goalChip} accessibilityRole="button" accessibilityLabel={`Goal: ${g}`}>
              <Text variant="caption" style={{ color: palette.ink70 }}>{g}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <TextField label="Notes / rationale" value={item.notes ?? ""} onChangeText={(n) => onPatch({ notes: n.slice(0, 500) || undefined })} placeholder="Why this scheme, in a sentence the client would understand." disabled={locked} />
    </View>
  );
}

/** The insurer, from the list of Indian insurers; "Other insurer…" types one the list lacks. */
function InsurerField({ value, onChange, locked }: { value: string; onChange: (v: string) => void; locked?: boolean }) {
  const listed = INSURERS.includes(value);
  const [typing, setTyping] = React.useState(!!value && !listed);
  if (typing) {
    return (
      <View>
        <TextField label="Insurer" value={value} onChangeText={onChange} placeholder="Insurer name" disabled={locked} />
        {!locked ? <Text variant="caption" tone="brand" onPress={() => { setTyping(false); if (!listed) onChange(""); }} style={{ marginTop: -spacing.md, marginBottom: spacing.md }}>Pick from the list</Text> : null}
      </View>
    );
  }
  return (
    <SelectField
      label="Insurer"
      value={listed ? value : ""}
      disabled={locked}
      options={[{ value: "", label: "Select…" }, ...INSURERS.map((n) => ({ value: n, label: n })), { value: "__other", label: "Other insurer…" }]}
      onChange={(v) => { if (v === "__other") { setTyping(true); onChange(""); } else onChange(v); }}
    />
  );
}

function Name({ label, value, onChange, placeholder, locked }: { label: string; value: string; onChange: (s: string) => void; placeholder: string; locked?: boolean }) {
  return <TextField label={label} required value={value} onChangeText={(s) => onChange(s.slice(0, 200))} placeholder={placeholder} disabled={locked} />;
}
function Plain({ label, value, onChange, placeholder, locked, max = 120 }: { label: string; value?: string; onChange: (s: string | undefined) => void; placeholder?: string; locked?: boolean; max?: number }) {
  return <TextField label={label} value={value ?? ""} onChangeText={(s) => onChange(s.slice(0, max) || undefined)} placeholder={placeholder} disabled={locked} />;
}

function InsRow({ item, onPatch, locked }: { item: InsuranceLine; onPatch: (p: Partial<InsuranceLine>) => void; locked?: boolean }) {
  return (
    <View>
      <Name label="Policy name" value={item.policyName} onChange={(v) => onPatch({ policyName: v })} placeholder="HDFC Life Click 2 Protect Super" locked={locked} />
      <InsurerField value={item.insurer ?? ""} onChange={(v) => onPatch({ insurer: v || undefined })} locked={locked} />
      <SelectField
        label="Policy type"
        value={item.policyType ?? ""}
        disabled={locked}
        options={[{ value: "", label: "Select…" }, { value: "term", label: "Term" }, { value: "ulip", label: "ULIP" }, { value: "endowment", label: "Endowment" }, { value: "health", label: "Health" }, { value: "money_back", label: "Money-back" }, { value: "other", label: "Other" }]}
        onChange={(v) => onPatch({ policyType: (v || undefined) as InsuranceLine["policyType"] })}
      />
      <Pair>
        <NumField label="Sum assured" unit="₹" value={item.sumAssured} onChange={(n) => onPatch({ sumAssured: n })} disabled={locked} />
        <NumField label="Annual premium" unit="₹" value={item.annualPremium} onChange={(n) => onPatch({ annualPremium: n })} disabled={locked} />
      </Pair>
      <NumField label="Term" unit="yrs" value={item.termYears} onChange={(n) => onPatch({ termYears: n })} max={99} disabled={locked} />
      <Plain label="Notes / rationale" value={item.notes} onChange={(v) => onPatch({ notes: v })} placeholder="₹1 cr cover at age 35; critical illness rider recommended." locked={locked} max={500} />
    </View>
  );
}

function PMSRow({ item, onPatch, locked }: { item: PmsLine; onPatch: (p: Partial<PmsLine>) => void; locked?: boolean }) {
  return (
    <View>
      <Name label="Strategy name" value={item.strategyName} onChange={(v) => onPatch({ strategyName: v })} placeholder="Marcellus Consistent Compounders" locked={locked} />
      <Plain label="Manager" value={item.manager} onChange={(v) => onPatch({ manager: v })} placeholder="Marcellus PMS" locked={locked} />
      <Pair>
        <NumField label="Min investment" unit="₹" value={item.minInvestment} onChange={(n) => onPatch({ minInvestment: n })} disabled={locked} />
        <NumField label="Proposed amount" unit="₹" value={item.proposedAmount} onChange={(n) => onPatch({ proposedAmount: n })} disabled={locked} />
      </Pair>
      <Pair>
        <NumField label="Expected return" unit="% p.a." value={item.expectedReturn} onChange={(n) => onPatch({ expectedReturn: n })} max={60} disabled={locked} />
        <NumField label="Horizon" unit="yrs" value={item.termYears} onChange={(n) => onPatch({ termYears: n })} max={50} disabled={locked} />
      </Pair>
      <Plain label="Notes / rationale" value={item.notes} onChange={(v) => onPatch({ notes: v })} placeholder="Suitable for HNI clients with a 5+ year horizon." locked={locked} max={500} />
    </View>
  );
}

function AIFRow({ item, onPatch, locked }: { item: AifLine; onPatch: (p: Partial<AifLine>) => void; locked?: boolean }) {
  return (
    <View>
      <Name label="Fund name" value={item.fundName} onChange={(v) => onPatch({ fundName: v })} placeholder="ICICI Pru Long-Short Fund Series II" locked={locked} />
      <Plain label="Manager" value={item.manager} onChange={(v) => onPatch({ manager: v })} placeholder="ICICI Prudential AIF" locked={locked} />
      <SelectField
        label="Category"
        value={item.category ?? ""}
        disabled={locked}
        options={[{ value: "", label: "Select…" }, { value: "cat1", label: "Cat I" }, { value: "cat2", label: "Cat II" }, { value: "cat3", label: "Cat III" }]}
        onChange={(v) => onPatch({ category: (v || undefined) as AifLine["category"] })}
      />
      <Pair>
        <NumField label="Min investment" unit="₹" value={item.minInvestment} onChange={(n) => onPatch({ minInvestment: n })} disabled={locked} />
        <NumField label="Proposed amount" unit="₹" value={item.proposedAmount} onChange={(n) => onPatch({ proposedAmount: n })} disabled={locked} />
      </Pair>
      <Pair>
        <NumField label="Lock-in" unit="yrs" value={item.lockInYears} onChange={(n) => onPatch({ lockInYears: n })} max={20} disabled={locked} />
        <NumField label="Target IRR" unit="% p.a." value={item.targetIrr} onChange={(n) => onPatch({ targetIrr: n })} max={60} disabled={locked} />
      </Pair>
      <Plain label="Notes / rationale" value={item.notes} onChange={(v) => onPatch({ notes: v })} placeholder="₹1 cr minimum; 3-year lock-in; accredited investors only." locked={locked} max={500} />
    </View>
  );
}

function OtherRow({ item, onPatch, locked }: { item: OtherLine; onPatch: (p: Partial<OtherLine>) => void; locked?: boolean }) {
  return (
    <View>
      <Name label="Product name" value={item.productName} onChange={(v) => onPatch({ productName: v })} placeholder="Bank FD / Sovereign Gold Bond / NPS Tier-I" locked={locked} />
      <Plain label="Company / issuer" value={item.company} onChange={(v) => onPatch({ company: v })} placeholder="SBI / RBI / NSDL" locked={locked} />
      <Pair>
        <NumField label="Amount" unit="₹" value={item.amount} onChange={(n) => onPatch({ amount: n })} disabled={locked} />
        <NumField label="Expected return" unit="% p.a." value={item.expectedReturn} onChange={(n) => onPatch({ expectedReturn: n })} max={60} disabled={locked} />
      </Pair>
      <NumField label="Term" unit="yrs" value={item.termYears} onChange={(n) => onPatch({ termYears: n })} max={99} disabled={locked} />
      <Plain label="Notes / rationale" value={item.notes} onChange={(v) => onPatch({ notes: v })} placeholder="Why this product suits the client." locked={locked} max={500} />
    </View>
  );
}

const styles = StyleSheet.create({
  addRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface, borderRadius: radius.pill, paddingHorizontal: spacing.md, minHeight: 36 },
  empty: { borderRadius: radius.md, backgroundColor: palette.surfaceSunken, padding: spacing.xl },
  row: { borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, backgroundColor: palette.surface, padding: spacing.lg },
  rowHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md, flexWrap: "wrap" },
  kind: { backgroundColor: palette.brandLight, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  icon: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  totals: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, borderRadius: radius.md, backgroundColor: palette.surfaceSunken, padding: spacing.md },
  readonly: { height: 48, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: spacing.lg, justifyContent: "center", backgroundColor: palette.surfaceSunken },
  goalChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: -spacing.sm, marginBottom: spacing.lg },
  goalChip: { borderRadius: radius.pill, backgroundColor: palette.surfaceSunken, paddingHorizontal: spacing.md, paddingVertical: 6 },
});
