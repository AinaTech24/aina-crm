"use client";

/**
 * GuidedStageActions — replaces the generic "Next action" chip strip.
 *
 * For the current stage, looks up STAGE_ACTIONS (catalog) and renders 1-3
 * primary buttons. Each button:
 *
 *   1. On click, calls /api/leads/[id]/blueprint/can-advance?to=<target>
 *      to check whether the prerequisite artefact exists (call log,
 *      meeting, proposal, risk profile, …).
 *
 *   2. If satisfied → fires the action's behaviour:
 *        - `open_dialog`   → opens an in-place modal
 *        - `navigate`      → routes to a form page
 *        - `advance_only`  → directly POSTs blueprint/advance
 *        - `call_api`      → calls a custom endpoint
 *      Then refreshes so the stepper above reflects the new stage.
 *
 *   3. If NOT satisfied → expands an inline checklist of unsatisfied
 *      items with direct CTAs (e.g. "Log the call now") so the user
 *      knows exactly what to do.
 *
 * The dialogs themselves come from the existing leads/actions
 * components — we just trigger them via callbacks.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  Loader2,
  Sparkles,
} from "lucide-react";
import { STAGE_ACTIONS, type StageAction, type DialogKind } from "@/lib/blueprints/stage-actions";

type Prereq = {
  label: string;
  satisfied: boolean;
  hint?: string;
  cta?: { href: string; label: string };
};

type Outcome =
  | { kind: "advanced" }
  | { kind: "needs_action"; items: Prereq[]; targetStage: string };

export function GuidedStageActions({
  leadId,
  currentStage,
  onOpenDialog,
  onAfterAdvance,
}: {
  leadId: string;
  currentStage: string;
  onOpenDialog?: (kind: DialogKind) => void;
  onAfterAdvance?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const actions = STAGE_ACTIONS[currentStage] ?? [];

  if (actions.length === 0) {
    return null; // terminal / boundary stage — nothing to do here
  }

  async function checkPrereq(targetStage: string): Promise<{ ok: boolean; items: Prereq[] }> {
    const res = await fetch(
      `/api/leads/${leadId}/blueprint/can-advance?to=${encodeURIComponent(targetStage)}`
    );
    if (!res.ok) return { ok: false, items: [] };
    return (await res.json()) as { ok: boolean; items: Prereq[] };
  }

  async function advance(targetStage: string, remarks?: string): Promise<boolean> {
    const res = await fetch(`/api/leads/${leadId}/blueprint/advance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toStageKey: targetStage, remarks }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      console.warn("[advance] failed:", j.error);
      return false;
    }
    return true;
  }

  async function handleClick(action: StageAction) {
    setBusy(action.key);
    setOutcome(null);
    try {
      // 1. If the action targets a *forward* stage, check prereqs first.
      const forwardJump = action.targetStage && action.targetStage !== currentStage;
      if (forwardJump) {
        const pre = await checkPrereq(action.targetStage);
        if (!pre.ok) {
          // Show the checklist of unsatisfied items.
          setOutcome({
            kind: "needs_action",
            items: pre.items,
            targetStage: action.targetStage,
          });
          return;
        }
      }

      // 2. Run the behaviour.
      switch (action.behaviour.kind) {
        case "open_dialog":
          // Defer to the page-level handler (existing LeadActions dialogs).
          onOpenDialog?.(action.behaviour.dialog);
          // The dialog's onSave will trigger router.refresh() — and the
          // smart auto-advance pipeline (call log creates → first_call_pending,
          // meeting created → appointment_scheduled, etc.) will move the
          // blueprint without us calling advance here.
          break;

        case "navigate": {
          const href = action.behaviour.hrefPattern.replace("{id}", leadId);
          router.push(href);
          break;
        }

        case "call_api": {
          const endpoint = action.behaviour.endpoint.replace("{id}", leadId);
          await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(action.behaviour.body ?? {}),
          });
          if (action.behaviour.afterStage) {
            await advance(action.behaviour.afterStage);
          }
          router.refresh();
          window.dispatchEvent(new CustomEvent("blueprint:refresh"));
          onAfterAdvance?.();
          setOutcome({ kind: "advanced" });
          break;
        }

        case "advance_only": {
          if (forwardJump) {
            await advance(action.targetStage, `Action: ${action.label}`);
          }
          router.refresh();
          window.dispatchEvent(new CustomEvent("blueprint:refresh"));
          onAfterAdvance?.();
          setOutcome({ kind: "advanced" });
          break;
        }
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => handleClick(a)}
            disabled={!!busy}
            className={`${toneClass(a.tone)} ${busy === a.key ? "opacity-70" : ""} text-sm whitespace-nowrap`}
            title={a.hint}
          >
            {busy === a.key ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            {a.label}
          </button>
        ))}
      </div>

      {/* Hint row for the first action */}
      {actions[0]?.hint && (
        <p className="text-xs text-muted-foreground leading-snug">
          <span className="font-medium">Tip:</span> {actions[0].hint}
        </p>
      )}

      {/* Outcome panel — checklist when prereq fails */}
      {outcome?.kind === "needs_action" && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50/70 p-4">
          <div className="flex items-start gap-3 mb-3">
            <div className="size-9 rounded-lg bg-amber-100 grid place-items-center flex-shrink-0">
              <AlertTriangle className="size-4 text-amber-700" />
            </div>
            <div>
              <div className="text-sm font-semibold text-amber-900">
                Before moving on, complete these
              </div>
              <p className="text-xs text-amber-800/90 mt-0.5">
                The CRM needs the underlying record on file before it can
                advance the stage. Click any item below to finish it.
              </p>
            </div>
          </div>
          <ul className="space-y-2">
            {outcome.items.map((p, i) => (
              <li
                key={i}
                className={`flex items-start gap-2.5 rounded-lg p-2.5 border ${
                  p.satisfied
                    ? "bg-emerald-50/60 border-emerald-200"
                    : "bg-white border-amber-200"
                }`}
              >
                {p.satisfied ? (
                  <CheckCircle2 className="size-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                ) : (
                  <Circle className="size-4 text-amber-600 mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-sm ${
                      p.satisfied ? "text-emerald-900 line-through" : "text-foreground"
                    }`}
                  >
                    {p.label}
                  </div>
                  {!p.satisfied && p.hint && (
                    <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                      {p.hint}
                    </div>
                  )}
                </div>
                {!p.satisfied && p.cta && (
                  <a
                    href={p.cta.href}
                    className="btn-secondary text-xs whitespace-nowrap inline-flex items-center gap-1"
                  >
                    {p.cta.label}
                    <ChevronRight className="size-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setOutcome(null)}
            className="mt-3 text-xs text-amber-800 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function toneClass(tone: StageAction["tone"]): string {
  switch (tone) {
    case "primary":
      return "btn-primary";
    case "success":
      return "btn-primary !bg-emerald-600 hover:!bg-emerald-700";
    case "danger":
      return "btn-secondary !text-rose-700 !border-rose-300 hover:!bg-rose-50";
    case "secondary":
    default:
      return "btn-secondary";
  }
}
