"use client";

import { useState } from "react";
import { Sparkles, Loader2, Flame, ThermometerSun, Snowflake } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";

type Result = {
  score: number;
  band: "hot" | "warm" | "cold";
  reasoning: string;
  nextAction: string;
};

const BAND = {
  hot: { icon: Flame, chip: "bg-rose-50 text-rose-700 border-rose-200", label: "Hot" },
  warm: { icon: ThermometerSun, chip: "bg-amber-50 text-amber-700 border-amber-200", label: "Warm" },
  cold: { icon: Snowflake, chip: "bg-sky-50 text-sky-700 border-sky-200", label: "Cold" },
} as const;

/**
 * AI lead-score action on the lead detail page. Posts the lead's engagement
 * signals to /api/ai/lead-score and shows the score + reasoning + next action
 * in a dialog. Advisory — does not persist on the lead, and it is a second
 * opinion beside the deterministic score in the header, not a replacement.
 */
export function LeadScoreButton(props: {
  name: string;
  source?: string | null;
  stage?: string | null;
  ageInStageDays?: number | null;
  lastTouchDaysAgo?: number | null;
  estimatedAumInr?: number | null;
  /** Replaces the trigger's look — a record menu passes its row class. */
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function score() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/ai/lead-score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: props.name,
          source: props.source ?? undefined,
          stage: props.stage ?? undefined,
          ageInStageDays: props.ageInStageDays ?? undefined,
          lastTouchDaysAgo: props.lastTouchDaysAgo ?? undefined,
          estimatedAumInr: props.estimatedAumInr ?? undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Could not score this lead");
        return;
      }
      setResult(j);
    } finally {
      setBusy(false);
    }
  }

  function start() {
    setOpen(true);
    if (!result && !busy) void score();
  }

  const b = result ? BAND[result.band] : null;
  const BandIcon = b?.icon;

  return (
    <>
      <button type="button" onClick={start} disabled={busy} className={props.triggerClassName ?? "btn-secondary text-xs"}>
        {busy ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <Sparkles className="size-4 shrink-0 text-muted-foreground" />}
        AI lead score
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>AI lead score — {props.name}</DialogTitle>
            <DialogDescription>An AI estimate to weigh beside the score in the header. Your judgement decides.</DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-3 text-sm">
            {busy && !result ? (
              <div className="flex items-center gap-2 py-6 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Reading the lead…
              </div>
            ) : err ? (
              <p className="text-destructive">{err}</p>
            ) : result && b ? (
              <>
                <div className="flex items-center gap-2">
                  {BandIcon && <BandIcon className="size-4" aria-hidden />}
                  <span className={`chip border ${b.chip}`}>{b.label}</span>
                  <span className="font-bold tabular-nums">{result.score}/100</span>
                  <button type="button" onClick={score} disabled={busy} className="ml-auto text-2xs text-muted-foreground hover:underline">
                    {busy ? "…" : "Score again"}
                  </button>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{result.reasoning}</p>
                {result.nextAction && (
                  <p className="text-xs">
                    <span className="font-semibold">Suggested next step: </span>
                    {result.nextAction}
                  </p>
                )}
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
