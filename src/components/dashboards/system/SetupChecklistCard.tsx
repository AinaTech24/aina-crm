"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, ChevronRight, ChevronDown, X } from "lucide-react";

export type SetupStep = {
  key: string;
  label: string;
  hint: string;
  href: string;
  done: boolean;
};

const DISMISS_KEY = "aina:setup-checklist-dismissed:v1";

/**
 * Presentational half of the setup checklist. Dismiss hides it on this device
 * (localStorage); the server half stops rendering it entirely once every step
 * is verified done, so the dismissal is only ever a temporary "not now".
 */
export function SetupChecklistCard({ steps }: { steps: SetupStep[] }) {
  const [hidden, setHidden] = useState(true); // start hidden to avoid a flash before the localStorage read
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setHidden(false);
    }
  }, []);
  if (hidden) return null;

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-controls="workspace-setup-steps" className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-2 text-left">
          <span className="grid size-8 place-items-center rounded-lg bg-primary/5 text-primary"><CheckCircle2 className="size-4" /></span>
          <span className="text-sm font-semibold">Finish setting up your workspace</span>
          <span className="text-xs text-muted-foreground">{doneCount} of {steps.length} complete</span>
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary">{expanded ? "Hide steps" : "View steps"}<ChevronDown className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} /></span>
        </button>
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

      <ul id="workspace-setup-steps" hidden={!expanded} className={expanded ? "mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-border pt-4" : "hidden"}>
        {steps.map((s) => (
          <li key={s.key}>
            {s.done ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary/40 px-3 py-2.5 opacity-70">
                <CheckCircle2 className="size-4 text-emerald-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium line-through decoration-border">{s.label}</div>
                </div>
              </div>
            ) : (
              <Link
                href={s.href}
                className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 hover:bg-accent/40 transition-colors group"
              >
                <Circle className="size-4 text-muted-foreground/50 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{s.label}</div>
                  <div className="text-2xs text-muted-foreground mt-0.5">{s.hint}</div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground/40 mt-0.5 shrink-0 group-hover:text-foreground transition-colors" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
