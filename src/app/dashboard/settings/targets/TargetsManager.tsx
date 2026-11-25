"use client";

/**
 * TargetsManager — each team member's FY targets, the SAME seven the dashboard's
 * "My target tracker" shows: SIP book, Net new SIP, Net business, New clients,
 * Meetings, Review meetings and Insurance business (lib/targets/personal-targets.ts).
 *
 * Each is one ANNUAL figure for the financial year; the tracker phases it into a
 * week or a month itself. They are stored where the tracker reads them (kra_targets),
 * so what is typed here is what the dashboard measures against. Managers edit every
 * row; everyone else sees and edits only their own (the server already scopes the list).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { PERSONAL_TARGET_METRICS, type PersonalTargetMetric } from "@/lib/targets/personal-targets";

export type MemberTarget = {
  id: string;
  name: string;
  /** metric key → the FY target; a metric with none is absent. */
  targets: Record<string, number>;
};

const asText = (n: number | undefined) => (n != null && Number.isFinite(n) ? String(n) : "");

function MemberCard({ m, canEdit, isSelf, fiscalYear }: { m: MemberTarget; canEdit: boolean; isSelf: boolean; fiscalYear: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(PERSONAL_TARGET_METRICS.map((t) => [t.key, asText(m.targets[t.key])])),
  );
  const set = Object.keys(m.targets).length;

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/targets", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        // A blank clears a target: "Not set" on the dashboard, never a target of zero.
        body: JSON.stringify({ userId: m.id, fyTargets: values }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? "Could not save targets", "Save failed");
        return;
      }
      toast.success(`Targets saved for ${m.name}`);
      router.refresh();
    } catch {
      toast.error("Network error — please try again", "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold">
          {m.name}
          {isSelf && <span className="chip bg-brand-cyan-light text-2xs text-brand-cyan-deep">You</span>}
        </div>
        <span className="text-xs text-muted-foreground">
          {set === 0 ? `No ${fiscalYear} targets set` : `${set} of ${PERSONAL_TARGET_METRICS.length} set for ${fiscalYear}`}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PERSONAL_TARGET_METRICS.map((t) => (
          <Field
            key={t.key}
            metric={t}
            value={values[t.key] ?? ""}
            disabled={!canEdit}
            onChange={(v) => setValues((cur) => ({ ...cur, [t.key]: v }))}
          />
        ))}
      </div>

      {canEdit && (
        <div className="flex justify-end border-t pt-3">
          <button onClick={save} disabled={busy} className="btn-primary inline-flex items-center gap-1.5 text-sm disabled:opacity-50">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save targets
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ metric, value, disabled, onChange }: { metric: PersonalTargetMetric; value: string; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">
        {metric.label}
        {metric.unit === "inr" ? " (₹)" : ""}
      </span>
      <input
        type="number"
        min={0}
        step={metric.unit === "count" ? 1 : "any"}
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={metric.placeholder}
        aria-describedby={`hint-${metric.key}`}
        className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-3 text-sm tabular-nums focus:border-brand-cyan/60 focus:outline-none focus:ring-2 focus:ring-brand-cyan/15 disabled:opacity-60"
      />
      <span id={`hint-${metric.key}`} className="mt-0.5 block text-2xs text-muted-foreground">{metric.hint}</span>
    </label>
  );
}

export function TargetsManager({
  members,
  canEditAll,
  selfId,
  fiscalYear,
}: {
  members: MemberTarget[];
  canEditAll: boolean;
  selfId: string;
  fiscalYear: string;
}) {
  if (members.length === 0) {
    return <div className="card-surface p-12 text-center text-sm text-muted-foreground">No team members to show targets for.</div>;
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Each figure is the target for the whole financial year ({fiscalYear}). The dashboard&apos;s <b className="font-medium text-foreground">My target tracker</b> works
        out the week or the month from it. Leave a box empty for no target.
      </p>
      {members.map((m) => (
        <MemberCard key={m.id} m={m} canEdit={canEditAll || m.id === selfId} isSelf={m.id === selfId} fiscalYear={fiscalYear} />
      ))}
    </div>
  );
}
