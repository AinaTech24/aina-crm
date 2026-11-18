"use client";

/**
 * Shared pieces of the Fund Research tools (math: src/lib/fund-research):
 * the scheme picker that also loads the scheme's NAV history, the 1–5 scheme
 * list, the date / frequency fields and the past-performance note that names
 * the NAV dates actually used. Presentation and fetching only — no math.
 *
 * History comes from GET /api/mf/schemes/[schemeCode]/nav (mfapi.in) and is
 * kept per scheme code for the page's life, so moving between tools does not
 * download it again.
 */

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import { InlineEmpty } from "@/components/common/EmptyState";
import { formatDate } from "@/lib/format";
import { type Frequency, FREQUENCY_LABEL, type NavSeries, navSeries } from "@/lib/fund-research/nav";
import { SchemeAutocomplete } from "../mf/SchemeAutocomplete";
import { Field, Segmented } from "./ui";

export type PickedScheme = { schemeCode: string; schemeName: string };

export type NavHistory = {
  schemeCode: string;
  schemeName: string;
  amc: string | null;
  category: string | null;
  firstDate: string;
  lastDate: string;
  series: NavSeries;
};

export type NavState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: NavHistory }
  | { status: "error"; error: string };

const store = new Map<string, NavHistory>();
const inflight = new Map<string, Promise<NavHistory>>();

async function loadHistory(code: string): Promise<NavHistory> {
  const have = store.get(code);
  if (have) return have;
  const pending = inflight.get(code);
  if (pending) return pending;
  const p = (async () => {
    const res = await fetch(`/api/mf/schemes/${encodeURIComponent(code)}/nav`);
    if (!res.ok) throw new Error(res.status === 404 ? "No NAV history is available for this scheme." : "Could not load the NAV history.");
    const j = (await res.json()) as {
      schemeCode: string; schemeName: string; amc: string | null; category: string | null;
      firstDate: string; lastDate: string; points: Array<[string, number]>;
    };
    const data: NavHistory = {
      schemeCode: j.schemeCode,
      schemeName: j.schemeName,
      amc: j.amc,
      category: j.category,
      firstDate: j.firstDate,
      lastDate: j.lastDate,
      series: navSeries(j.points.map(([date, nav]) => ({ date, nav }))),
    };
    store.set(code, data);
    return data;
  })();
  inflight.set(code, p);
  try {
    return await p;
  } finally {
    inflight.delete(code);
  }
}

/** NAV history for each code (missing / empty codes read as idle). */
export function useNavHistories(codes: ReadonlyArray<string | null | undefined>): NavState[] {
  const key = codes.map((c) => c ?? "").join("|");
  const [states, setStates] = useState<Record<string, NavState>>({});
  useEffect(() => {
    let alive = true;
    for (const code of key.split("|").filter(Boolean)) {
      const have = store.get(code);
      if (have) {
        setStates((s) => (s[code]?.status === "ready" ? s : { ...s, [code]: { status: "ready", data: have } }));
        continue;
      }
      setStates((s) => (s[code] ? s : { ...s, [code]: { status: "loading" } }));
      loadHistory(code).then(
        (data) => { if (alive) setStates((s) => ({ ...s, [code]: { status: "ready", data } })); },
        (e: unknown) => {
          if (alive) setStates((s) => ({ ...s, [code]: { status: "error", error: e instanceof Error ? e.message : "Could not load the NAV history." } }));
        },
      );
    }
    return () => { alive = false; };
  }, [key]);
  return codes.map((c) => (c ? states[c] ?? (store.has(c) ? { status: "ready", data: store.get(c) as NavHistory } : { status: "loading" }) : { status: "idle" }));
}

export function useNavHistory(code: string | null | undefined): NavState {
  return useNavHistories([code])[0];
}

/** What the picker shows under itself: the history's range, or why there is none. */
export function NavStatusLine({ state }: { state: NavState }) {
  if (state.status === "idle") return null;
  if (state.status === "loading") return <p className="text-2xs text-muted-foreground">Loading NAV history…</p>;
  if (state.status === "error") return <p className="text-2xs text-destructive" role="alert">{state.error}</p>;
  const d = state.data;
  return (
    <p className="text-2xs text-muted-foreground">
      {d.series.dates.length.toLocaleString("en-IN")} NAVs, {formatDate(d.firstDate)} to {formatDate(d.lastDate)}
      {d.category ? ` · ${d.category}` : ""}
    </p>
  );
}

/** One scheme: search the Scheme Master, then load the NAV history. */
export function FundPicker({
  label, value, onChange, state,
}: { label: string; value: PickedScheme | null; onChange: (v: PickedScheme | null) => void; state: NavState }) {
  return (
    <div className="space-y-1">
      <Field label={label}>
        {/* Research looks at any fund, not only the firm's Scheme Master. */}
        <SchemeAutocomplete
          size="sm"
          source="universe"
          defaultValue={value?.schemeName ?? ""}
          placeholder="Search a scheme…"
          onSelect={(s) => onChange({ schemeCode: s.schemeCode, schemeName: s.schemeName })}
          onClear={() => onChange(null)}
        />
      </Field>
      <NavStatusLine state={state} />
    </div>
  );
}

export const MAX_FUNDS = 5;

/** One row of a multi-scheme tool; `id` keeps the picker's own state across removals. */
export type FundSlot = { id: number; pick: PickedScheme | null };

let slotSeq = 0;
export function newSlot(pick: PickedScheme | null = null): FundSlot {
  slotSeq += 1;
  return { id: slotSeq, pick };
}

/** 1–5 schemes, each with its own picker and NAV status. */
export function FundList({
  funds, setFunds, states,
}: { funds: FundSlot[]; setFunds: (f: FundSlot[]) => void; states: NavState[] }) {
  return (
    <div className="space-y-3">
      {funds.map((f, i) => (
        <div key={f.id} className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <FundPicker
              label={`Scheme ${i + 1}`}
              value={f.pick}
              state={states[i] ?? { status: "idle" }}
              onChange={(v) => setFunds(funds.map((x) => (x.id === f.id ? { ...x, pick: v } : x)))}
            />
          </div>
          {funds.length > 1 && (
            <Button
              variant="ghost"
              size="icon"
              className="mt-5"
              aria-label={`Remove scheme ${i + 1}`}
              icon={<Trash2 className="size-4" aria-hidden />}
              onClick={() => setFunds(funds.filter((x) => x.id !== f.id))}
            />
          )}
        </div>
      ))}
      {funds.length < MAX_FUNDS && (
        <Button variant="secondary" size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setFunds([...funds, newSlot()])}>
          Add a scheme
        </Button>
      )}
    </div>
  );
}

export function DateInput({
  label, value, onChange, min, max,
}: { label: string; value: string; onChange: (v: string) => void; min?: string; max?: string }) {
  return (
    <Field label={label}>
      <DateField value={value} onChange={(e) => onChange(e.target.value)} min={min} max={max} className="input-base text-sm w-full" />
    </Field>
  );
}

export function FrequencyField({
  value, onChange, options = ["weekly", "monthly", "quarterly"], label = "Frequency",
}: { value: Frequency; onChange: (v: Frequency) => void; options?: Frequency[]; label?: string }) {
  return (
    <Segmented<Frequency>
      label={label}
      value={value}
      onChange={onChange}
      options={options.map((o) => ({ value: o, label: FREQUENCY_LABEL[o] }))}
    />
  );
}

export function DayField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="input-base text-sm w-full">
        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
    </Field>
  );
}

/** Past-performance note naming each scheme's NAV dates used. */
export function ResearchNote({ ranges, extra }: { ranges: Array<{ name: string; from: string; to: string }>; extra?: string }) {
  return (
    <div data-pdf="insight" className="text-2xs text-muted-foreground border-t border-border pt-3 space-y-1">
      <p>
        <strong className="font-semibold text-foreground">Past performance may or may not be sustained in future</strong> and
        is not a guarantee of future returns. Figures use the schemes&apos; published NAVs (AMFI, via mfapi.in), before
        stamp duty, exit loads and taxes; a transaction on a day with no NAV is taken at the next available NAV, and a
        value &ldquo;as on&rdquo; a date uses the latest NAV on or before it. Mutual fund investments are subject to market risks.
        {extra ? ` ${extra}` : ""}
      </p>
      {ranges.length > 0 && (
        <ul>
          {ranges.map((r, i) => (
            <li key={i}>NAVs used — {r.name}: {formatDate(r.from)} to {formatDate(r.to)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PickFirst({ message = "Pick a scheme to see its returns." }: { message?: string }) {
  return <InlineEmpty message={message} />;
}

/** A tool's one-sentence refusal (bad dates, no history in range). */
export function ToolError({ message }: { message: string }) {
  return <p className="text-sm text-destructive" role="alert">{message}</p>;
}

export function pctText(n: number | null | undefined, digits = 2): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n.toFixed(digits)}%`;
}

export function navText(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

export function unitsText(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export function dateText(iso: string): string {
  return formatDate(iso);
}

/** ISO date `years` before `iso` (for default start dates). */
export function yearsBefore(iso: string, years: number): string {
  const y = Number(iso.slice(0, 4)) - years;
  return `${y}${iso.slice(4)}`.replace(/-02-29$/, "-02-28");
}

/** Today in India as ISO yyyy-mm-dd. */
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}
