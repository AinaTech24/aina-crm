"use client";

/**
 * "Merge exact-PAN duplicates automatically" — the button that populates
 * "Client Merged By System".
 *
 * Two-step on purpose: a dry run first (how many groups, a sample of who
 * merges into whom), then an explicit confirm. Only exact-PAN groups are ever
 * merged unattended; everything else stays a suggestion for a human.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type DryRun = { groups: number; clients: number; sample: Array<{ pan: string; keep: string; merge: string[] }> };

export function AutoMergeButton({ panGroups }: { panGroups: number }) {
  const router = useRouter();
  const toast = useToast();
  const [plan, setPlan] = useState<DryRun | null>(null);
  const [busy, setBusy] = useState(false);

  async function preview() {
    setBusy(true);
    try {
      const res = await fetch("/api/investors/merge/auto", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        toast.error(j.error ?? `Could not prepare the system merge (${res.status})`, "System merge");
        return;
      }
      setPlan(j);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/investors/merge/auto", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        toast.error(j.error ?? `System merge failed (${res.status})`, "System merge");
        return;
      }
      const failed = Array.isArray(j.failed) ? j.failed.length : 0;
      toast.success(
        `System merged ${j.merged} client${j.merged === 1 ? "" : "s"} across ${j.groupsDone} PAN group${j.groupsDone === 1 ? "" : "s"}` +
          (failed ? ` · ${failed} skipped` : "") +
          (j.remaining ? ` · ${j.remaining} remaining — run again` : "")
      );
      setPlan(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (panGroups === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold inline-flex items-center gap-1.5">
            <Sparkles className="size-4 text-primary" /> Let the system merge exact-PAN duplicates
          </div>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            {panGroups} group{panGroups === 1 ? "" : "s"} share an identical PAN — one legal person each. The system keeps the
            record with the bigger book and merges the rest, logged as “merged by system” and can be undone from Merge history.
            Phone, email and address matches are never merged automatically.
          </p>
        </div>
        {!plan && (
          <button type="button" onClick={preview} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1.5 shrink-0">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Preview system merge
          </button>
        )}
      </div>

      {plan && (
        <div className="mt-3 rounded-lg border border-border bg-secondary/30 p-3 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span>
              Will merge <strong>{plan.clients}</strong> client{plan.clients === 1 ? "" : "s"} across <strong>{plan.groups}</strong> PAN group{plan.groups === 1 ? "" : "s"}.
            </span>
            <button type="button" onClick={() => setPlan(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close preview">
              <X className="size-3.5" />
            </button>
          </div>
          <ul className="space-y-1">
            {plan.sample.map((s) => (
              <li key={s.pan} className="flex flex-wrap items-center gap-x-2">
                <span className="font-mono text-muted-foreground">{s.pan}</span>
                <span className="text-rose-700">{s.merge.join(", ")}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-medium text-emerald-700">{s.keep}</span>
              </li>
            ))}
            {plan.groups > plan.sample.length && <li className="text-muted-foreground">…and {plan.groups - plan.sample.length} more group{plan.groups - plan.sample.length === 1 ? "" : "s"}</li>}
          </ul>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={() => setPlan(null)} disabled={busy} className="btn-secondary text-xs">Cancel</button>
            <button type="button" onClick={run} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1.5">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Merge {plan.clients} now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
