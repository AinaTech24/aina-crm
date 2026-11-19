"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarCheck, CheckCircle2, Circle, ChevronRight, ChevronDown, X } from "lucide-react";

export type SetupStep = {
  key: string;
  label: string;
  hint: string;
  href: string;
  done: boolean;
  /** Not one of the four core steps — listed under the collapsed "Later". */
  later?: boolean;
};

const DISMISS_KEY = "aina:setup-checklist-dismissed:v1";

/**
 * Presentational half of the setup checklist. Dismiss hides it on this device
 * (localStorage); the server half stops rendering it entirely once every step
 * is verified done, so the dismissal is only ever a temporary "not now".
 */
export function SetupChecklistCard({ steps, callUrl }: { steps: SetupStep[]; callUrl: string }) {
  const [hidden, setHidden] = useState(true); // start hidden to avoid a flash before the localStorage read
  const [laterOpen, setLaterOpen] = useState(false);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setHidden(false);
    }
  }, []);
  if (hidden) return null;

  const core = steps.filter((s) => !s.later);
  const later = steps.filter((s) => s.later);
  const doneCount = core.filter((s) => s.done).length;
  const pct = core.length ? Math.round((doneCount / core.length) * 100) : 100;
  const laterLeft = later.filter((s) => !s.done).length;

  return (
    <section aria-labelledby="setup-checklist-title" className="rounded-xl border border-border bg-card px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="setup-checklist-title" className="text-sm font-semibold">Get set up</h2>
            <span className="text-xs text-muted-foreground">
              {doneCount} of {core.length} done
            </span>
          </div>
          <div
            className="h-2 max-w-md overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={0}
            aria-valuemax={core.length}
            aria-valuenow={doneCount}
            aria-valuetext={`${doneCount} of ${core.length} done`}
          >
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(pct, 3)}%` }} />
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
            setHidden(true);
          }}
          className="btn-icon"
          aria-label="Hide setup checklist"
          title="Hide for now"
        >
          <X className="size-4" />
        </button>
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {core.map((s) => (
          <StepRow key={s.key} s={s} />
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-3">
        {later.length > 0 ? (
          <button
            type="button"
            onClick={() => setLaterOpen((v) => !v)}
            aria-expanded={laterOpen}
            aria-controls="setup-checklist-later"
            className="inline-flex min-h-6 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Later{laterLeft ? ` · ${laterLeft} to do` : " · done"}
            <ChevronDown className={`size-3.5 transition-transform ${laterOpen ? "rotate-180" : ""}`} aria-hidden />
          </button>
        ) : (
          <span />
        )}
        <a href={callUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center gap-1.5 text-xs font-medium text-primary hover:underline">
          <CalendarCheck className="size-3.5" aria-hidden /> Book your free onboarding call
        </a>
      </div>
      {later.length > 0 && (
        <ul id="setup-checklist-later" hidden={!laterOpen} className={laterOpen ? "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2" : "hidden"}>
          {later.map((s) => (
            <StepRow key={s.key} s={s} />
          ))}
        </ul>
      )}
    </section>
  );
}

function StepRow({ s }: { s: SetupStep }) {
  return (
    <li>
      {s.done ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary/40 px-3 py-2.5 opacity-70">
          <CheckCircle2 className="size-4 text-success mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <div className="text-sm font-medium line-through decoration-border">
              {s.label}
              <span className="sr-only"> — done</span>
            </div>
          </div>
        </div>
      ) : (
        <Link
          href={s.href}
          className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 hover:bg-accent/40 transition-colors group"
        >
          <Circle className="size-4 text-muted-foreground/50 mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{s.label}</div>
            <div className="text-2xs text-muted-foreground mt-0.5">{s.hint}</div>
          </div>
          <ChevronRight className="size-4 text-muted-foreground/40 mt-0.5 shrink-0 group-hover:text-foreground transition-colors" aria-hidden />
        </Link>
      )}
    </li>
  );
}
