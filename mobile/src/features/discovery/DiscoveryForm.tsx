/**
 * The fact-find's ten sections — the app's copy of the CRM's
 * components/discovery/DiscoveryForm.tsx (RM view): the same sections, fields,
 * option lists, computed sub-lines and "filled in from the record" notes.
 *
 * What the CRM already knows is prefilled by the server when the fact-find is
 * started. The risk profile on record IS the risk profile here: when there is
 * one, section 10 shows it and asks nothing more (the firm's call, 2026-10-02).
 * Each amount is entered once — EMIs on the loan, premiums on the policy;
 * section 4 only reads them back (calc.ts).
 *
 * Controlled: the editor screen owns the data, the live computation and the
 * checks, so the snapshot, the progress bar and the buttons share one state.
 */

import React, { useCallback } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { DateField } from "../../components/form/DateField";
import { confirmDelete } from "../../lib/confirm";
import { fmtDate, inrFull, titleCase } from "../../lib/format";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";
import { FREQUENCY_PER_YEAR, goalReturnPct, type DiscoveryComputed, type DiscoveryData, type IncomeRow } from "./calc";
import type { DiscoveryErrors } from "./checks";
import { RISK_QUESTIONS } from "./risk";
import * as O from "./options";
import { NumBox, SelectBox, TextBox } from "./fields";

export const SECTIONS = [
  ["identity", "Identity"], ["income", "Income"], ["expenses", "Expenses"], ["surplus", "Surplus"],
  ["assets", "Assets"], ["liabilities", "Loans"], ["life", "Life cover"], ["health", "Health cover"],
  ["goals", "Goals"], ["risk", "Risk"],
] as const;
export type SectionKey = (typeof SECTIONS)[number][0];

const rupees = (v: number) => inrFull(v);

/**
 * Rows saved before income had a per-frequency amount carry a yearly
 * `annualAmount`. Shown as the same yearly total in the row's own frequency.
 * (Verbatim from the web form.)
 */
export function upgradeIncome(rows: IncomeRow[] | undefined): IncomeRow[] | undefined {
  if (!rows) return rows;
  return rows.map((r) => {
    if ((r.amount != null && r.amount !== "") || r.annualAmount == null || r.annualAmount === "") return r;
    const per = FREQUENCY_PER_YEAR[String(r.frequency ?? "")] ?? 1;
    const { annualAmount, ...rest } = r;
    const amount = Math.round((Number(annualAmount) || 0) / per);
    return { ...rest, amount, frequency: r.frequency || "Annually" };
  });
}

/** Which sections hold something (null = read-outs only) — the progress bar. */
export function filledSections(data: DiscoveryData, c: DiscoveryComputed): Record<SectionKey, boolean | null> {
  const ident = (data.identification ?? {}) as Record<string, any>;
  return {
    identity: !!(ident.fullName && ident.dob && ident.mobile),
    income: c.grossAnnualIncome > 0,
    expenses: c.monthlyExpenses > 0,
    surplus: null,
    assets: (data.assets ?? []).length > 0,
    liabilities: (data.liabilities ?? []).length > 0,
    life: (data.lifeInsurance ?? []).length > 0,
    health: (data.healthInsurance ?? []).length > 0,
    goals: (data.goals ?? []).length > 0,
    risk: !!data.recordedRisk || c.risk.complete,
  };
}

/** The section an error key ("identification.pan", "goals.2.targetYear") sits in. */
export function sectionOfError(key: string): SectionKey {
  const head = key.split(".")[0];
  const map: Record<string, SectionKey> = {
    identification: "identity", income: "income", expenses: "expenses", surplusInputs: "surplus",
    assets: "assets", liabilities: "liabilities", lifeInsurance: "life", healthInsurance: "health", goals: "goals",
  };
  return map[head] ?? "identity";
}

/* ── list sections ──────────────────────────────────────────────────────── */
type ColType = "text" | "num" | "int" | "money" | { select: readonly string[] };
type Col = { key: string; label: string; type: ColType };
type ListKey = "income" | "assets" | "liabilities" | "lifeInsurance" | "healthInsurance" | "goals";

const INCOME_COLS: Col[] = [
  { key: "source", label: "Income source", type: "text" },
  { key: "amount", label: "Amount ₹", type: "money" },
  { key: "frequency", label: "Every", type: { select: O.FREQUENCY } },
  { key: "taxable", label: "Taxable?", type: { select: O.YES_NO } },
];
const ASSET_COLS: Col[] = [
  { key: "description", label: "Description", type: "text" },
  { key: "category", label: "Type", type: { select: O.ASSET_TYPES } },
  { key: "currentValue", label: "Value ₹", type: "money" },
  { key: "invested", label: "Invested ₹", type: "money" },
  { key: "liquid", label: "Liquid?", type: { select: O.YES_NO } },
];
const LIABILITY_COLS: Col[] = [
  { key: "description", label: "Description", type: "text" },
  { key: "type", label: "Type", type: { select: O.LIABILITY_TYPES } },
  { key: "outstanding", label: "Outstanding ₹", type: "money" },
  { key: "emi", label: "EMI ₹ / mo", type: "money" },
  { key: "ratePct", label: "Rate %", type: "num" },
];
const LIFE_COLS: Col[] = [
  { key: "policy", label: "Policy / insurer", type: "text" },
  { key: "type", label: "Type", type: { select: O.LIFE_INSURANCE_TYPES } },
  { key: "sumAssured", label: "Sum assured ₹", type: "money" },
  { key: "premium", label: "Premium ₹ / yr", type: "money" },
];
const HEALTH_COLS: Col[] = [
  { key: "insurer", label: "Insurer / plan", type: "text" },
  { key: "type", label: "Type", type: { select: O.HEALTH_INSURANCE_TYPES } },
  { key: "sumInsured", label: "Sum insured ₹", type: "money" },
  { key: "premium", label: "Premium ₹ / yr", type: "money" },
];
const GOAL_COLS: Col[] = [
  { key: "description", label: "Goal", type: "text" },
  { key: "type", label: "Type", type: { select: O.GOAL_TYPES } },
  { key: "targetYear", label: "Target yr", type: "int" },
  { key: "targetCorpus", label: "Needed then ₹", type: "money" },
  { key: "alreadySaved", label: "Saved ₹", type: "money" },
  { key: "priority", label: "Priority", type: { select: O.PRIORITY } },
];

const EXPENSE_LABELS: Array<[string, string]> = [
  ["rent", "Rent"], ["groceries", "Groceries & household"], ["education", "Children's education"],
  ["vehicle", "Vehicle / transport"], ["utilities", "Utilities, internet"], ["medical", "Medical / healthcare"],
  ["entertainment", "Entertainment & dining"], ["clothing", "Clothing & personal"], ["other", "Other regular"],
];

type SetData = React.Dispatch<React.SetStateAction<DiscoveryData>>;

export function DiscoveryForm({
  data,
  setData,
  c,
  errors,
  subject,
  onSaveRisk,
  riskSaving,
  onSectionLayout,
}: {
  data: DiscoveryData;
  setData: SetData;
  c: DiscoveryComputed;
  errors: DiscoveryErrors;
  /** The lead / client this fact-find is for. */
  subject: { type: string; id: string };
  /** Save the completed questionnaire as a provisional risk profile (client, none on record, may edit). */
  onSaveRisk?: () => void;
  riskSaving?: boolean;
  /** Each section's y inside the scroll content, for the jump bar and "fix the highlighted field". */
  onSectionLayout: (key: SectionKey, y: number) => void;
}) {
  const router = useRouter();
  const set = useCallback((patch: Partial<DiscoveryData>) => setData((d) => ({ ...d, ...patch })), [setData]);
  const setId = (k: string, v: any) => setData((d) => ({ ...d, identification: { ...(d.identification ?? {}), [k]: v } }));
  const setExp = (k: string, v: any) => setData((d) => ({ ...d, expenses: { ...(d.expenses ?? {}), [k]: v } }));
  const setSurp = (k: string, v: any) => setData((d) => ({ ...d, surplusInputs: { ...(d.surplusInputs ?? {}), [k]: v } }));
  const setRisk = (k: string, v: any) => setData((d) => ({ ...d, riskProfile: { ...(d.riskProfile ?? {}), [k]: v } }));
  const setList = useCallback((list: ListKey, rows: any[]) => set({ [list]: rows } as Partial<DiscoveryData>), [set]);

  // What came from the CRM record, to say so on each section.
  const from = new Set(data.prefilledFromRecord ?? []);
  const identityFromRecord = [...from].some((k) => k.startsWith("identification."));
  const who = subject.type === "lead" ? "the lead record" : "the client record";
  const note = (on: boolean) => (on ? `Filled in from ${who} — check and correct if anything has changed.` : undefined);
  const rec = data.recordedRisk;
  // A risk profile on record means the questionnaire is not asked again.
  const riskQuestions = rec ? [] : RISK_QUESTIONS;

  const ident = (data.identification ?? {}) as Record<string, any>;
  const surplusLegacy = data.surplusInputs ?? {};
  // Premiums belong in sections 7–8. An older fact-find may still carry one here.
  const expenseLabels = Number((data.expenses as any)?.insurance) > 0
    ? [...EXPENSE_LABELS, ["insurance", "Insurance premiums (old entry)"] as [string, string]]
    : EXPENSE_LABELS;
  const layout = (k: SectionKey) => (e: { nativeEvent: { layout: { y: number } } }) => onSectionLayout(k, e.nativeEvent.layout.y);
  const subjectHref = subject.type === "lead" ? `/m/leads/${subject.id}` : `/m/investors/${subject.id}`;

  return (
    <View style={{ gap: spacing.md }}>
      {/* 1 · Identity */}
      <Section onLayout={layout("identity")} title="1 · Client identity" note={note(identityFromRecord)}>
        <Grid>
          <TextBox label="Full name (as per PAN)" value={ident.fullName} onChange={(x) => setId("fullName", x)} autoCapitalize="words" />
          <View style={{ width: "100%" }}>
            <DateField label="Date of birth" value={String(ident.dob ?? "")} onChange={(x) => setId("dob", x)} error={errors["identification.dob"]} />
          </View>
          <TextBox half label="PAN" value={ident.pan} onChange={(x) => setId("pan", x.toUpperCase())} error={errors["identification.pan"]} autoCapitalize="characters" mono />
          <TextBox half label="Mobile" value={ident.mobile} onChange={(x) => setId("mobile", x)} error={errors["identification.mobile"]} keyboardType="phone-pad" />
          <TextBox label="Email" value={ident.email} onChange={(x) => setId("email", x)} error={errors["identification.email"]} keyboardType="email-address" autoCapitalize="none" />
          <TextBox half label="City" value={ident.city} onChange={(x) => setId("city", x)} autoCapitalize="words" />
          <SelectBox half label="Residency" value={ident.residency} onChange={(x) => setId("residency", x)} options={O.RESIDENCY} />
          <TextBox half label="Occupation" value={ident.occupation} onChange={(x) => setId("occupation", x)} />
          <SelectBox half label="Tax slab" value={ident.taxSlab} onChange={(x) => setId("taxSlab", x)} options={O.TAX_SLABS} />
          <NumBox half integer label="Dependents" value={ident.dependents} onChange={(x) => setId("dependents", x)} error={errors["identification.dependents"]} />
          <TextBox half label="Nominee name" value={ident.nomineeName} onChange={(x) => setId("nomineeName", x)} autoCapitalize="words" />
          <SelectBox half label="Nominee relation" value={ident.nomineeRelation} onChange={(x) => setId("nomineeRelation", x)} options={O.RELATIONS} />
        </Grid>
      </Section>

      {/* 2 · Income */}
      <Section onLayout={layout("income")} title="2 · Income & cash flow" subtitle={`Total gross annual income: ${rupees(c.grossAnnualIncome)}`}>
        <Repeat list="income" rows={data.income ?? []} cols={INCOME_COLS} errors={errors} setList={setList} addLabel="Add income source" />
        <Small>Enter each amount as it is received — a monthly salary per month — and pick how often.</Small>
      </Section>

      {/* 3 · Monthly expenses */}
      <Section onLayout={layout("expenses")} title="3 · Monthly household expenses" subtitle={`Total: ${rupees(c.monthlyExpenses)}/mo · ${rupees(c.annualExpenses)}/yr`}>
        <Grid>
          {expenseLabels.map(([k, label]) => (
            <NumBox key={k} half money label={label} value={(data.expenses as any)?.[k]} onChange={(x) => setExp(k, x)} error={errors[`expenses.${k}`]} />
          ))}
        </Grid>
        <Small>Loan EMIs go in Liabilities and premiums in Insurance — they are counted from there.</Small>
      </Section>

      {/* 4 · Surplus — read back from the sections that hold each figure */}
      <Section onLayout={layout("surplus")} title="4 · Investable surplus" subtitle={`Net annual surplus: ${rupees(c.netInvestableSurplus)} · ~${rupees(c.monthlySipCapacity)}/mo`}>
        <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
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
        </View>
        <Grid>
          <NumBox money label="Estimated annual tax" value={surplusLegacy.estimatedTax} onChange={(x) => setSurp("estimatedTax", x)} error={errors["surplusInputs.estimatedTax"]} />
          {c.emiSource === "typed" ? (
            <NumBox money label="Annual loan EMIs (old entry)" value={surplusLegacy.annualLoanEmis} onChange={(x) => setSurp("annualLoanEmis", x)} error={errors["surplusInputs.annualLoanEmis"]} />
          ) : null}
          {c.premiumSource === "typed" ? (
            <NumBox money label="Annual premiums (old entry)" value={surplusLegacy.annualInsurancePremiums} onChange={(x) => setSurp("annualInsurancePremiums", x)} error={errors["surplusInputs.annualInsurancePremiums"]} />
          ) : null}
        </Grid>
        {Number(data.existingSipMonthly) > 0 ? (
          <View style={styles.soft}>
            <Text variant="caption" tone="muted">
              Already investing with us: <Text variant="caption" style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>{rupees(Number(data.existingSipMonthly))}/mo</Text> in SIPs — part of this surplus may already be committed.
            </Text>
          </View>
        ) : null}
      </Section>

      {/* 5 · Assets */}
      <Section onLayout={layout("assets")} title="5 · Assets" subtitle={`Total assets: ${rupees(c.totalAssets)}`} note={note(from.has("assets"))}>
        <Repeat list="assets" rows={data.assets ?? []} cols={ASSET_COLS} errors={errors} setList={setList} addLabel="Add asset" />
      </Section>

      {/* 6 · Liabilities */}
      <Section onLayout={layout("liabilities")} title="6 · Liabilities" subtitle={`Total: ${rupees(c.totalLiabilities)} · Net worth ${rupees(c.netWorth)} · Debt/Asset ${c.debtToAssetRatio.toFixed(0)}%`}>
        <Repeat list="liabilities" rows={data.liabilities ?? []} cols={LIABILITY_COLS} errors={errors} setList={setList} addLabel="Add liability" />
      </Section>

      {/* 7 · Life insurance */}
      <Section
        onLayout={layout("life")}
        title="7 · Life insurance"
        subtitle={`Cover ${rupees(c.totalLifeCover)} · Recommended ${rupees(c.recommendedLifeCover)} · ${c.lifeCoverGap > 0 ? `Gap ${rupees(c.lifeCoverGap)}` : "Adequately covered"}`}
        note={note(from.has("lifeInsurance"))}
      >
        <Repeat list="lifeInsurance" rows={data.lifeInsurance ?? []} cols={LIFE_COLS} errors={errors} setList={setList} addLabel="Add life policy" />
      </Section>

      {/* 8 · Health insurance */}
      <Section onLayout={layout("health")} title="8 · Health & general insurance" subtitle={`Total health cover ${rupees(c.totalHealthCover)}`} note={note(from.has("healthInsurance"))}>
        <Repeat list="healthInsurance" rows={data.healthInsurance ?? []} cols={HEALTH_COLS} errors={errors} setList={setList} addLabel="Add health policy" />
      </Section>

      {/* 9 · Goals */}
      <Section onLayout={layout("goals")} title="9 · Financial goals" subtitle={`Target corpus ${rupees(c.totalCorpusTarget)} · SIP needed ~${rupees(c.totalSipNeeded)}/mo`} note={note(from.has("goals"))}>
        <Repeat list="goals" rows={data.goals ?? []} cols={GOAL_COLS} errors={errors} setList={setList} addLabel="Add goal" />
        <Small>
          Enter what the goal will cost in its target year. The SIP assumes {goalReturnPct(1)}% a year for goals under 3 years,{" "}
          {goalReturnPct(3)}% for 3–5 years and {goalReturnPct(5)}% beyond.
        </Small>
      </Section>

      {/* 10 · Risk profile — the one on record, or (with none) the questionnaire */}
      <Section
        onLayout={layout("risk")}
        title="10 · Risk profile & suitability"
        subtitle={
          rec
            ? undefined
            : c.risk.complete
              ? `${c.risk.bandLabel} · score ${c.risk.score}/${c.risk.max}`
              : c.risk.answered > 0
                ? `${c.risk.answered}/${c.risk.total} answered — still needed: ${c.risk.missing.join(", ")}`
                : "Answer the questions — risk score & product suitability auto-calculate"
        }
      >
        {rec ? (
          <View style={styles.onRecord}>
            <Feather name="shield" size={18} color={palette.muted} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm }}>
                <Text variant="label">
                  <Text variant="label" tone="muted">Risk profile on record: </Text>
                  <Text variant="label" style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>{titleCase(rec.category)}</Text>
                </Text>
                {rec.provisional ? (
                  <View style={styles.provisional}><Text variant="caption" style={{ color: palette.warning, fontWeight: fontWeight.semibold }}>Provisional</Text></View>
                ) : null}
              </View>
              <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                {[
                  rec.date ? `Completed ${fmtDate(rec.date)}` : null,
                  rec.score != null ? `score ${rec.score}` : null,
                  "from the Risk Profiles module — not asked again here",
                ].filter(Boolean).join(" · ")}
              </Text>
              <Text variant="caption" tone="brand" style={{ marginTop: spacing.xs, fontWeight: fontWeight.semibold }} onPress={() => router.push(subjectHref as any)}>
                View
              </Text>
            </View>
          </View>
        ) : (
          <Small>No risk profile on record yet. Answer below, or complete one in Risk Profiles so every screen shows the same profile.</Small>
        )}
        {riskQuestions.length > 0 ? (
          <Grid>
            {riskQuestions.map((q) => (
              <SelectBox key={q.key} label={q.label} value={data.riskProfile?.[q.key]} onChange={(x) => setRisk(q.key, x)} options={q.options.map((o) => o.value)} />
            ))}
          </Grid>
        ) : null}
        {!rec ? <Small>Age, annual income &amp; net worth are taken automatically from the fact-find above — no need to re-enter.</Small> : null}
        {!rec && onSaveRisk && subject.type === "investor" && c.risk.complete ? (
          <View style={[styles.soft, { gap: spacing.sm }]}>
            <Text variant="caption" tone="muted">
              Save <Text variant="caption" style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>{c.risk.bandLabel}</Text> as this client&apos;s risk profile — provisional until they confirm it.
            </Text>
            <Button label="Save as provisional risk profile" variant="secondary" size="sm" loading={riskSaving} onPress={onSaveRisk} icon={<Feather name="shield" size={14} color={palette.ink} />} />
          </View>
        ) : null}
      </Section>
    </View>
  );
}

/* ── primitives ─────────────────────────────────────────────────────────── */
function Section({ title, subtitle, note, onLayout, children }: {
  title: string; subtitle?: string; note?: string; onLayout: (e: any) => void; children: React.ReactNode;
}) {
  return (
    <View onLayout={onLayout}>
      <Card>
        <Text variant="subtitle">{title}</Text>
        {subtitle ? <Text variant="caption" tone="muted" style={{ marginTop: 2, fontVariant: ["tabular-nums"] }}>{subtitle}</Text> : null}
        {note ? (
          <View style={styles.note}>
            <Feather name="database" size={12} color={palette.muted} />
            <Text variant="caption" tone="muted" style={{ flex: 1 }}>{note}</Text>
          </View>
        ) : null}
        <View style={{ marginTop: spacing.md }}>{children}</View>
      </Card>
    </View>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

function Small({ children }: { children: React.ReactNode }) {
  return <Text variant="caption" tone="muted" style={{ marginTop: spacing.xs }}>{children}</Text>;
}

function ReadOut({ label, value, source }: { label: string; value: string; source: string }) {
  return (
    <View style={styles.soft}>
      <Text variant="caption" tone="muted">{label}</Text>
      <Text variant="label" style={{ color: palette.ink, fontWeight: fontWeight.semibold, fontVariant: ["tabular-nums"] }}>{value}</Text>
      <Text variant="caption" tone="muted">{source}</Text>
    </View>
  );
}

function Cell({ col, value, on, error, half }: { col: Col; value: any; on: (x: string) => void; error?: string; half: boolean }) {
  if (col.type === "text") return <TextBox half={half} label={col.label} value={value} onChange={on} error={error} />;
  if (col.type === "num") return <NumBox half={half} label={col.label} value={value} onChange={on} error={error} />;
  if (col.type === "int") return <NumBox half={half} integer label={col.label} value={value} onChange={on} error={error} />;
  if (col.type === "money") return <NumBox half={half} money label={col.label} value={value} onChange={on} error={error} />;
  return <SelectBox half={half} label={col.label} value={value} onChange={on} options={col.type.select} error={error} />;
}

const hasAnyValue = (r: Record<string, unknown>) => Object.values(r ?? {}).some((v) => v != null && String(v).trim() !== "");

/** One card per row, every box labelled (the web's phone layout). */
const Repeat = React.memo(function Repeat({ list, rows, cols, errors, setList, addLabel }: {
  list: ListKey; rows: any[]; cols: Col[]; errors: DiscoveryErrors; setList: (list: ListKey, rows: any[]) => void; addLabel: string;
}) {
  const update = (i: number, key: string, val: any) => setList(list, rows.map((r, j) => (j === i ? { ...r, [key]: val } : r)));
  const add = () => setList(list, [...rows, {}]);
  const remove = (i: number) => {
    const drop = () => setList(list, rows.filter((_, j) => j !== i));
    if (!hasAnyValue(rows[i])) drop();
    else confirmDelete({ title: "Remove this row?", confirmLabel: "Remove" }, drop);
  };
  return (
    <View style={{ gap: spacing.sm }}>
      {rows.length === 0 ? <Text variant="caption" tone="muted">None added yet.</Text> : null}
      {rows.map((r, i) => (
        <View key={i} style={styles.rowCard}>
          <View style={styles.grid}>
            {cols.map((cc, k) => (
              <Cell key={cc.key} col={cc} half={k !== 0} value={r?.[cc.key]} on={(x) => update(i, cc.key, x)} error={errors[`${list}.${i}.${cc.key}`]} />
            ))}
          </View>
          <Pressable onPress={() => remove(i)} accessibilityRole="button" accessibilityLabel="Remove row" hitSlop={8} style={styles.remove}>
            <Feather name="trash-2" size={16} color={palette.muted} />
          </Pressable>
        </View>
      ))}
      <Pressable onPress={add} accessibilityRole="button" style={styles.add}>
        <Feather name="plus" size={15} color={palette.brandDark} />
        <Text variant="label" tone="brand" style={{ fontWeight: fontWeight.semibold }}>{addLabel}</Text>
      </Pressable>
    </View>
  );
}, (a, b) =>
  a.rows === b.rows && a.list === b.list && a.setList === b.setList &&
  errSig(a.errors, a.list) === errSig(b.errors, b.list));

/** The errors that concern one list, as a comparable string. */
function errSig(e: DiscoveryErrors, list: string): string {
  return Object.keys(e).filter((k) => k.startsWith(`${list}.`)).map((k) => `${k}=${e[k]}`).join("|");
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  note: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm, backgroundColor: palette.surfaceSunken, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  soft: { backgroundColor: palette.surfaceSunken, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  onRecord: { flexDirection: "row", gap: spacing.md, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surfaceAlt, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  provisional: { backgroundColor: palette.warningBg, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  rowCard: { borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.md, paddingBottom: spacing.xs },
  remove: { alignSelf: "flex-end", width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  add: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: spacing.sm, minHeight: 40 },
});
