"use client";

/**
 * "Later" on an opportunity — the client wants it, but not yet.
 *
 *   LaterFields   when: a quick pick ("After Diwali", "In 3 months", …) or a
 *                 date, or "when money comes in" (FD maturity, bonus, …), and
 *                 what the client said. Shows when the owner will be reminded.
 *   LaterDialog   park an open opportunity, or give a parked one a new date.
 *   LaterBanner   on a parked card: when it comes back, why, the money it
 *                 waits for, and Resume now · New date · Close as lost.
 *
 * Rules (lead days, presets, the snooze limit) are lib/opportunities/later-core.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, Hourglass, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { notify } from "@/components/ui/Toast";
import { formatDate, formatMoney } from "@/lib/format";
import {
  MONEY_SOURCE_LABELS, REVISIT_LEAD_DAYS, SNOOZE_LIMIT, istDay, laterPresets, reminderDay,
} from "@/lib/opportunities/later-core";
import type { OpportunityPipeline } from "@/lib/opportunities/products";
import type { OpportunityView } from "@/lib/opportunities/journey";
import type { InflowSourceType } from "@/db/schema/expected_inflows";
import { cn } from "@/lib/utils";

export type LaterDraft = {
  mode: "date" | "money";
  /** The quick pick in use, or null for a date picked by hand. */
  preset: string | null;
  day: string;
  reason: string;
  sourceType: InflowSourceType | "";
  amount: string;
};

export function newLaterDraft(from?: OpportunityView["later"]): LaterDraft {
  if (from) {
    return {
      mode: from.money ? "money" : "date", preset: null, day: from.revisitOn, reason: from.reason ?? "",
      sourceType: (from.money?.sourceType as InflowSourceType) ?? "", amount: from.money?.amount ? String(from.money.amount) : "",
    };
  }
  const first = laterPresets()[0];
  return { mode: "date", preset: first.key, day: first.day, reason: first.reason, sourceType: "", amount: "" };
}

/** What is wrong with the draft, or null. */
export function laterError(d: LaterDraft): string | null {
  if (!d.day || d.day <= istDay()) return "Pick a date after today.";
  if (d.mode === "money" && !d.sourceType) return "Say where the money comes from.";
  return null;
}

/** The request body's `later` part. */
export function laterPayload(d: LaterDraft) {
  const amount = d.amount.trim() ? Number(d.amount.replace(/[^0-9.]/g, "")) : null;
  const sourceLabel = d.sourceType ? MONEY_SOURCE_LABELS[d.sourceType] : "";
  return {
    revisitOn: d.day,
    reason: d.reason.trim() || (d.mode === "money" && sourceLabel ? `When the ${sourceLabel.toLowerCase()} comes in` : ""),
    money: d.mode === "money" && d.sourceType ? { sourceType: d.sourceType, amount: amount || null } : null,
  };
}

export function LaterFields({ draft, onChange, pipeline, ownerName }: {
  draft: LaterDraft;
  onChange: (d: LaterDraft) => void;
  pipeline: OpportunityPipeline | null;
  ownerName?: string | null;
}) {
  const presets = useMemo(() => laterPresets(), []);
  const today = istDay();
  const set = (patch: Partial<LaterDraft>) => onChange({ ...draft, ...patch });
  const lead = REVISIT_LEAD_DAYS[pipeline ?? "mf"];
  const remind = draft.day && draft.day > today ? reminderDay(draft.day, pipeline ?? "mf", today) : null;

  return (
    <div className="space-y-3">
      <nav className="dash-seg" aria-label="Waiting for">
        <button type="button" aria-pressed={draft.mode === "date"} onClick={() => set({ mode: "date" })}>A date</button>
        <button type="button" aria-pressed={draft.mode === "money"} onClick={() => set({ mode: "money", preset: null })}>Money coming in</button>
      </nav>

      {draft.mode === "date" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick picks">
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={draft.preset === p.key}
                onClick={() => set({ preset: p.key, day: p.day, reason: !draft.reason || presets.some((x) => x.reason === draft.reason) ? p.reason : draft.reason })}
                className={cn(
                  "min-h-7 rounded-full border px-3 text-xs font-medium transition-colors",
                  draft.preset === p.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label} <span className="font-normal opacity-70">· {formatDate(p.day)}</span>
              </button>
            ))}
          </div>
          <Field label="Revisit on" required>
            {(id, d) => (
              <DateField id={id} aria-describedby={d} value={draft.day} min={istDay(1)}
                onChange={(e) => set({ day: e.target.value, preset: presets.find((p) => p.day === e.target.value)?.key ?? null })} />
            )}
          </Field>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Money from" required>
            {(id, d) => (
              <SelectField id={id} aria-describedby={d} value={draft.sourceType} className="w-full"
                onChange={(e) => set({ sourceType: e.target.value as InflowSourceType })}>
                <option value="">Select…</option>
                {(Object.keys(MONEY_SOURCE_LABELS) as InflowSourceType[]).map((k) => (
                  <option key={k} value={k}>{MONEY_SOURCE_LABELS[k]}</option>
                ))}
              </SelectField>
            )}
          </Field>
          <Field label="Expected around" required>
            {(id, d) => (
              <DateField id={id} aria-describedby={d} value={draft.day} min={istDay(1)} onChange={(e) => set({ day: e.target.value })} />
            )}
          </Field>
          <Field label="Amount (₹)" optional className="sm:col-span-2">
            {(id, d) => (
              <input id={id} aria-describedby={d} className="input-base" inputMode="decimal" value={draft.amount}
                onChange={(e) => set({ amount: e.target.value })} placeholder="e.g. 500000" />
            )}
          </Field>
        </div>
      )}

      <Field label="Why later?" optional>
        {(id, d) => (
          <input id={id} aria-describedby={d} className="input-base" value={draft.reason} maxLength={300}
            onChange={(e) => set({ reason: e.target.value })}
            placeholder={draft.mode === "money" ? "e.g. once my FD matures" : "e.g. after Diwali, once the bonus is in"} />
        )}
      </Field>

      {remind && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Hourglass className="size-3.5 shrink-0" aria-hidden />
          {ownerName ? `${ownerName} gets` : "The owner gets"} a reminder on <span className="font-medium text-foreground">{formatDate(remind)}</span>
          {remind > today ? ` — ${lead} days before` : " — today, the date is close"}.
        </p>
      )}
    </div>
  );
}

export function LaterDialog({ o, onClose, onDone }: {
  o: OpportunityView; onClose: () => void; onDone: (v: OpportunityView) => void;
}) {
  const [draft, setDraft] = useState<LaterDraft>(() => newLaterDraft(o.later));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const again = !!o.later;

  async function save() {
    const e = laterError(draft);
    if (e) return setErr(e);
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/opportunities/${o.id}/later`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "park", ...laterPayload(draft) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(j.error ?? "Could not save");
      notify.success(`Back on ${formatDate(draft.day)} — reminder on ${formatDate(j.remindOn)}`);
      onDone(j.opportunity);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{again ? `New date for ${o.productLabel}` : `${o.productLabel} — later`}</DialogTitle>
          <DialogDescription>
            {again ? "The reminder moves with it." : "It stays open. The owner is reminded before the date, so the call comes while the money is uncommitted."}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-3">
          {again && o.later!.count >= SNOOZE_LIMIT && (
            <p className="flex items-start gap-1.5 rounded-lg bg-warning/10 px-3 py-2 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" aria-hidden />
              Put off {o.later!.count} times already. If the client is not going ahead, close it as lost instead.
            </p>
          )}
          <LaterFields draft={draft} onChange={setDraft} pipeline={o.pipeline} ownerName={o.ownerName} />
          {err && <p className="flex items-center gap-1.5 text-sm text-destructive"><AlertTriangle className="size-4" /> {err}</p>}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>{again ? "Save new date" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A parked card's state and actions, in place of the follow-up row. */
export function LaterBanner({ o, canWork, onChange, onNewDate, onLose }: {
  o: OpportunityView; canWork: boolean;
  onChange: (v: OpportunityView | undefined) => void; onNewDate: () => void; onLose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const later = o.later!;
  const today = istDay();
  const due = later.revisitOn <= today;
  const remind = o.followUpAt ? new Date(new Date(o.followUpAt).getTime() + 5.5 * 36e5).toISOString().slice(0, 10) : null;

  async function resume() {
    setBusy(true);
    try {
      const res = await fetch(`/api/opportunities/${o.id}/later`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resume" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return notify.error(j.error ?? "Could not resume");
      notify.success("Back in the pipeline — follow-up tomorrow");
      onChange(j.opportunity);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("mt-3 rounded-lg px-3 py-2.5", due ? "bg-warning/10" : "bg-secondary/70")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Hourglass className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-semibold text-foreground">Later</span>
        <span className="text-muted-foreground">· back {formatDate(later.revisitOn)}</span>
        {later.reason && <span className="text-muted-foreground">· “{later.reason}”</span>}
      </div>
      {later.money && (
        <p className="mt-1 text-xs text-muted-foreground">
          Waiting for: <span className="font-medium text-foreground">{later.money.label}</span>
          {later.money.amount ? ` ${formatMoney(later.money.amount)}` : ""} around {formatDate(later.money.expectedOn)}
        </p>
      )}
      <p className={cn("mt-1 text-xs", due ? "font-medium text-warning-foreground" : "text-muted-foreground")}>
        {due
          ? later.money ? "The date has come — has the money arrived?" : "The date has come — is the client ready?"
          : remind ? `Reminder on ${formatDate(remind)}` : "No reminder open"}
        {later.count > 1 ? ` · put off ${later.count} times` : ""}
      </p>
      {canWork && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" loading={busy} icon={<Play className="size-3.5" />} onClick={resume}>Resume now</Button>
          <Button size="sm" onClick={onNewDate}>New date</Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onLose}>Close as lost</Button>
        </div>
      )}
    </div>
  );
}
