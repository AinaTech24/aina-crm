"use client";

/**
 * Lead Blueprint Stage Bar.
 *
 * Drops onto the lead detail page above the Onboarding Actions panel.
 *
 *   - Horizontal stepper (15 dots) with done / current / upcoming styling.
 *   - "Next required action" tile beneath the bar — shows owner role,
 *     allowed actions, SLA badge ("Due in 2d" / "Overdue by 1d").
 *   - "Advance to" picker for valid forward transitions with optional remarks.
 *   - Inline stage history dropdown for the audit trail.
 *
 * Data is fetched from /api/leads/[id]/blueprint on mount.
 */

import { useId, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  History,
  Loader2,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { GuidedStageActions } from "@/components/leads/GuidedStageActions";
import { leadPipelineColumn, stageLabel } from "@/lib/leads/stages";
import { LEAD_PHASE_LAST_ORDER } from "@/lib/blueprints/lead_to_client";

type Stage = {
  key: string;
  name: string;
  order: number;
  status: "done" | "current" | "upcoming";
  phase?: "lead" | "client";
  /** Loops and dead ends are branches, not linear steps. */
  flavour?: "default" | "loop" | "terminal_success" | "terminal_failure";
};
type Current = {
  key: string;
  name: string;
  description: string | null;
  ownerRole: string | null;
  order: number;
  slaDays: number | null;
  allowedActions: string[];
  requiredFields: string[];
  secondsInStage: number;
  slaRemainingDays: number | null;
  isDelayed: boolean;
};
type HistoryRow = {
  stageKey: string;
  stageName: string;
  enteredAt: string;
  exitedAt: string | null;
  durationSeconds: number | null;
  breachedSla: boolean;
};

const ACTION_LABELS: Record<string, string> = {
  send_welcome: "Send Welcome",
  schedule_call: "Schedule Call",
  log_call_outcome: "Log Call Outcome",
  confirm_meeting: "Confirm Meeting",
  reschedule_meeting: "Reschedule Meeting",
  cancel_meeting: "Cancel Meeting",
  capture_meeting_outcome: "Capture Meeting Outcome",
  qualify_lead: "Qualify Lead",
  send_risk_profile: "Send Risk Profile",
  mark_nurture: "Move to Nurture",
  mark_lost: "Mark Lost",
  resend_risk_profile: "Resend Risk Profile",
  manual_capture_risk_profile: "Capture Risk Manually",
  create_proposal: "Create Proposal",
  send_proposal: "Send Proposal",
  edit_proposal: "Edit Proposal",
  suitability_check: "Suitability Check",
  resend_proposal: "Resend Proposal",
  capture_approval: "Capture Approval",
  revise_proposal: "Revise Proposal",
  send_doc_checklist: "Send Document Checklist",
  resend_doc_checklist: "Resend Document Checklist",
  manual_upload_docs: "Upload Docs Manually",
  convert_to_client: "Convert to Client",
  view_ops_tasks: "View Ops Tasks",
  escalate_to_owner: "Escalate",
  schedule_first_review: "Schedule First Review",
};

/**
 * `phase` controls which stages render:
 *   - "lead"  (default for lead detail page) — stages 1-12 (new → docs_received).
 *   - "client" — stages 13-15 (ops_in_progress → active_client).
 *   - undefined — show the entire 15-stage journey.
 *
 * `convertedInvestorId` (lead phase only) — when present and the current stage
 * is `docs_received`, the stepper swaps the generic advance picker for a big
 * "Convert to Client →" CTA that links to the existing conversion flow.
 */
export function BlueprintStageBar({
  leadId,
  phase,
  convertedInvestorId,
  onConvertClick,
}: {
  leadId: string;
  phase?: "lead" | "client";
  convertedInvestorId?: string | null;
  /** Override the default conversion CTA behaviour. */
  onConvertClick?: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<{ current: Current; allStages: Stage[]; history: HistoryRow[]; pipeline?: string; leadScore?: number | null; scoreBand?: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch(`/api/leads/${leadId}/blueprint`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "Failed to load");
      // Lead-phase stages go by the Leads module's names (src/lib/leads/stages.ts),
      // not the blueprint's formal ones ("New Lead Created", "Won Lead"), so the
      // stepper agrees with the kanban and the dashboard. Client-phase stages
      // keep their blueprint names.
      const relabel = <T extends { key: string; name: string }>(s: T): T =>
        leadPipelineColumn(s.key) ? { ...s, name: stageLabel(s.key) } : s;
      setData({ ...d, current: d.current && relabel(d.current), allStages: (d.allStages ?? []).map(relabel) });
    } catch (e: any) {
      setError(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [leadId]);

  // Listen for "blueprint:refresh" events fired by sibling components
  // (LeadActions, GuidedStageActions, OnboardingActions) after they save
  // something that may have auto-advanced the stage. Without this, the
  // bar would show stale data until a hard page reload.
  useEffect(() => {
    function onRefresh() {
      void load();
    }
    window.addEventListener("blueprint:refresh", onRefresh);
    return () => window.removeEventListener("blueprint:refresh", onRefresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function advance(toStageKey: string, remarks?: string) {
    setAdvancing(true);
    setError(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/blueprint/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toStageKey, remarks }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "Failed to advance");
      await load();
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Failed to advance");
    } finally {
      setAdvancing(false);
    }
  }

  async function resync() {
    setAdvancing(true);
    setError(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/blueprint/sync`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "Failed to re-sync");
      await load();
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Failed to re-sync");
    } finally {
      setAdvancing(false);
    }
  }

  if (loading) {
    return (
      <div className="card-surface p-4 text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="size-3.5 animate-spin" /> Loading the journey…
      </div>
    );
  }
  if (!data) return null;
  const { current, history } = data;
  // Filter the stepper to the requested phase. When unspecified, show everything.
  const allStages: Stage[] = phase
    ? data.allStages.filter((s) => (s.phase ?? "lead") === phase)
    : data.allStages;

  /**
   * Every icon on the rail carries its number — its place on the rail, 1 … N
   * left to right — and the header's "step X of N" counts the same way, so the
   * two always agree. The firm asked for a number in every icon (2026-10-02):
   * a rail that numbered only the main path and drew loops and dead ends as
   * ↺ / ✕ read as missing numbers. What KIND of stage it is stays visible in
   * the icon's shape and colour — a dashed diamond is a loop (call back later),
   * a red one a dead end (lost) — just no longer instead of the number.
   */
  const stepNo = new Map<string, number>(allStages.map((s, i) => [s.key, i + 1] as const));
  const railTotal = allStages.length;
  const railPosition = stepNo.get(current.key) ?? Math.max(1, allStages.filter((s) => s.order <= current.order).length);

  /**
   * Two boundary conditions:
   *   1. Lead module + stage `docs_received` and NOT yet converted → big
   *      "Convert to Client" CTA replaces the normal advance picker.
   *   2. Client module + current stage is still lead-phase (lead in progress,
   *      not converted) → render a placeholder banner instead of an empty bar.
   */
  const isConvertReady =
    phase === "lead" && current.key === "won_lead" && !convertedInvestorId;
  const leadStillInProgress =
    phase === "client" && (current.order <= LEAD_PHASE_LAST_ORDER || !convertedInvestorId);

  const slaTone =
    current.slaRemainingDays == null
      ? "neutral"
      : current.slaRemainingDays < 0
        ? "overdue"
        : current.slaRemainingDays < 1
          ? "due-soon"
          : "ok";

  return (
    <div className="card-surface p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" />
          <h3 className="section-title">
            {phase === "client" ? "Client onboarding" : "Lead journey"}
          </h3>
          <span className="text-xs text-muted-foreground">
            {leadStillInProgress
              ? "Onboarding will start once the lead is converted"
              : `${current.name} · step ${railPosition} of ${railTotal}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {slaTone === "overdue" && (
            <span className="chip bg-destructive/10 text-destructive inline-flex items-center gap-1 text-2xs">
              <AlertTriangle className="size-3" />
              Overdue by {Math.abs(Math.ceil(current.slaRemainingDays!))}d
            </span>
          )}
          {slaTone === "due-soon" && (
            <span className="chip bg-warning/10 text-warning-foreground inline-flex items-center gap-1 text-2xs">
              <Clock className="size-3" />
              Due in {Math.max(0, Math.floor((current.slaRemainingDays ?? 0) * 24))}h
            </span>
          )}
          {slaTone === "ok" && current.slaDays != null && (
            <span className="chip bg-success/10 text-success inline-flex items-center gap-1 text-2xs">
              <Clock className="size-3" />
              Due in {Math.ceil(current.slaRemainingDays!)}d
            </span>
          )}
          {current.ownerRole && (
            <span className="chip bg-secondary text-2xs capitalize">
              Owner: {current.ownerRole.replace(/_/g, " ")}
            </span>
          )}
          <button
            onClick={resync}
            disabled={advancing}
            title="Re-detect stage from risk profile / proposal / docs on file"
            className="btn-ghost text-2xs"
          >
            <RefreshCw className={`size-3 ${advancing ? "animate-spin" : ""}`} /> Re-sync
          </button>
          <button onClick={() => setShowHistory((v) => !v)} className="btn-ghost text-2xs">
            <History className="size-3" /> {showHistory ? "Hide" : "History"}
          </button>
        </div>
      </div>

      {/* Stepper */}
      <div className="overflow-x-auto scrollbar-thin">
        <ol className="flex items-center min-w-max gap-0.5">
          {allStages.map((s, i) => (
            <li key={s.key} className="flex items-center">
              <div className="flex flex-col items-center min-w-[64px]">
                {/* A branch is not a step. `flavour` marks the three kinds
                    that are not part of a straight line: a LOOP (call back
                    later — returns to the same place), a DEAD END (not
                    qualified, mandate rejected) and a FINISH (won, active
                    client). Drawing all of them as identical numbered circles
                    is what made this rail read as a broken sequence. */}
                {(() => {
                  const fl = s.flavour ?? "default";
                  const shape = fl === "default" ? "rounded-full" : "rounded-md rotate-45";
                  const tone =
                    s.status === "done"
                      ? "bg-success text-white"
                      : s.status === "current"
                        ? "bg-primary text-white ring-2 ring-primary/30"
                        : fl === "terminal_failure"
                          ? "bg-destructive/10 text-destructive border border-destructive/30"
                          : fl === "terminal_success"
                            ? "bg-success/10 text-success border border-success/30"
                            : fl === "loop"
                              ? "bg-secondary text-muted-foreground border border-dashed border-muted-foreground/40"
                              : "bg-secondary text-muted-foreground";
                  const note =
                    fl === "loop"
                      ? " — a loop, not a step forward"
                      : fl === "terminal_failure"
                        ? " — a dead end for this journey"
                        : fl === "terminal_success"
                          ? " — the finish line"
                          : "";
                  return (
                    <div
                      className={`size-7 grid place-items-center text-2xs font-bold ${shape} ${tone}`}
                      title={`${s.name}${note}`}
                    >
                      <span className={fl === "default" ? "" : "-rotate-45"}>
                        {s.status === "done" ? "✓" : stepNo.get(s.key)}
                      </span>
                    </div>
                  );
                })()}
                <span
                  className={`mt-1 text-2xs text-center leading-tight max-w-[80px] ${
                    s.status === "current" ? "font-semibold" : "text-muted-foreground"
                  }`}
                >
                  {s.name}
                </span>
              </div>
              {i < allStages.length - 1 && (
                <div
                  className={`h-0.5 w-6 mx-0.5 mb-5 ${
                    s.status === "done" ? "bg-emerald-400" : "bg-border"
                  }`}
                />
              )}
            </li>
          ))}
        </ol>
      </div>

      {/* Boundary banners — short-circuit the normal "Next action" picker
          when the lead is ready to convert, or when the client stage bar
          is waiting on the lead-side to complete. */}
      {isConvertReady ? (
        <div className="rounded-xl border-2 border-emerald-300 bg-gradient-to-r from-emerald-50 to-emerald-50/60 p-4">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-xl bg-emerald-500 text-white grid place-items-center flex-shrink-0 shadow-md">
              <CheckCircle2 className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-emerald-900">
                Lead qualified and won
              </div>
              <p className="text-xs text-emerald-800/90 mt-1 leading-relaxed">
                This lead is ready to be converted into a client. All captured risk profiles, proposals, and pre-onboarding notes will automatically carry over to the Clients module.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (onConvertClick) {
                  onConvertClick();
                } else {
                  // Open the convert dialog directly (LeadActions listens for
                  // this event), and scroll the panel into view. Previously
                  // this only scrolled — which looked like "nothing happened"
                  // when the header panel was already on screen.
                  window.dispatchEvent(
                    new CustomEvent("blueprint:open-dialog", {
                      detail: { kind: "convert", leadId },
                    })
                  );
                  document
                    .querySelector("[data-lead-actions]")
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                }
              }}
              className="btn-primary text-sm whitespace-nowrap"
            >
              Convert to Client →
            </button>
          </div>
        </div>
      ) : leadStillInProgress ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 flex items-center gap-3">
          <Clock className="size-4 text-amber-700 flex-shrink-0" />
          <span className="text-xs text-amber-900 leading-relaxed">
            <strong>Onboarding pending.</strong> The lead is still at &ldquo;
            {current.name}&rdquo; in the Leads module. Once they&apos;re converted to
            a client, the Operations → Portal → Active Client steps continue
            here.
          </span>
        </div>
      ) : (
      // Guidance panel, deliberately NEUTRAL. `brand-cyan` resolves to the Aina
      // red, so this border + tint + heading were three more reds on a card that
      // already carries a red overdue chip and a red primary action. Colour that
      // marks everything marks nothing; red stays for what is actually wrong.
      <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <ChevronRight className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            What's next?
          </span>
        </div>
        {current.description && (
          <p className="text-xs text-muted-foreground">{current.description}</p>
        )}

        {/* Guided stage actions — replaces the old chip strip + advance
            picker with stage-specific buttons that check prerequisites
            (e.g. "Call Done" verifies a call log exists before advancing). */}
        <GuidedStageActions
          leadId={leadId}
          investorId={convertedInvestorId}
          currentStage={current.key}
          pipeline={data?.pipeline}
          onOpenDialog={(kind) => {
            // Bubble up to the page so the existing LeadActions dialogs
            // (LogActivity, LogPastMeeting, etc.) can open.
            window.dispatchEvent(
              new CustomEvent("blueprint:open-dialog", {
                detail: { kind, leadId },
              })
            );
          }}
          onAfterAdvance={() => {
            void load();
            router.refresh();
          }}
        />

        {/* Fallback: manual advance to any stage (admin override). */}
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Or pick a stage manually
          </summary>
          <div className="mt-2">
            <ForwardPicker
              allStages={allStages}
              currentKey={current.key}
              allowedActions={current.allowedActions}
              busy={advancing}
              onAdvance={advance}
            />
          </div>
        </details>

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 rounded p-1.5 flex items-start gap-1.5">
            <AlertTriangle className="size-3 mt-0.5" /> {error}
          </div>
        )}
      </div>
      )}

      {/* History panel */}
      {showHistory && (
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Stage history
          </div>
          <ol className="space-y-1.5">
            {history.map((h, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <CheckCircle2
                  className={`size-3.5 mt-0.5 flex-shrink-0 ${
                    h.exitedAt ? "text-emerald-500" : "text-brand-cyan"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{h.stageName}</div>
                  <div className="text-2xs text-muted-foreground">
                    Entered {new Date(h.enteredAt).toLocaleString("en-IN")}
                    {h.exitedAt && (
                      <>
                        {" · "}
                        exited {new Date(h.exitedAt).toLocaleString("en-IN")}
                        {h.durationSeconds != null && (
                          <span className="ml-1">({humaniseDuration(h.durationSeconds)})</span>
                        )}
                      </>
                    )}
                    {h.breachedSla && (
                      <span className="text-rose-600 ml-1 inline-flex items-center gap-0.5">
                        <AlertTriangle className="size-3" /> SLA breached
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function ForwardPicker({
  allStages,
  currentKey,
  allowedActions,
  busy,
  onAdvance,
}: {
  allStages: Stage[];
  currentKey: string;
  allowedActions: string[];
  busy: boolean;
  onAdvance: (key: string, remarks?: string) => void;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [remarks, setRemarks] = useState("");

  // Offer exactly the stages the blueprint allows from here. This used to take
  // the next three stages BY ARRAY ORDER, which listed moves the engine has no
  // transition for — picking one always failed with
  // “No transition defined from …” (e.g. Mandate Activated → Mandate
  // Rejected). allowedActions mirrors the transition graph for every stage, so
  // filtering by it means the picker can only offer moves that will succeed.
  const candidates = allStages.filter((s) => allowedActions.includes(s.key));
  if (!candidates.length) return null;

  return (
    <div className="mt-3 pt-3 border-t border-brand-cyan/20">
      <button onClick={() => setOpen((v) => !v)} className="btn-secondary text-xs">
        <ChevronRight className="size-3.5" />
        {open ? "Cancel" : "Advance stage manually"}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div>
            <label htmlFor={`${uid}-move-to`} className="text-2xs text-muted-foreground">Move to</label>
            <select id={`${uid}-move-to`}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="input-base text-xs w-full mt-1"
            >
              <option value="">— choose —</option>
              {candidates.map((s) => (
                <option key={s.key} value={s.key}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-remarks-optional`} className="text-2xs text-muted-foreground">Remarks (optional)</label>
            <textarea id={`${uid}-remarks-optional`}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              className="input-base text-xs w-full mt-1"
              placeholder="Why are you advancing?"
            />
          </div>
          <button
            disabled={!target || busy}
            onClick={() => onAdvance(target, remarks || undefined)}
            className="btn-primary text-xs disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <ChevronRight className="size-3" />}
            {busy ? "Advancing…" : "Confirm advance"}
          </button>
        </div>
      )}
    </div>
  );
}

function humaniseDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}
