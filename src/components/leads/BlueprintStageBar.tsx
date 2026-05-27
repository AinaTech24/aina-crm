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

import { useEffect, useState } from "react";
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

type Stage = { key: string; name: string; order: number; status: "done" | "current" | "upcoming" };
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

export function BlueprintStageBar({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [data, setData] = useState<{ current: Current; allStages: Stage[]; history: HistoryRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch(`/api/leads/${leadId}/blueprint`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "Failed to load");
      setData(d);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
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
        <Loader2 className="size-3.5 animate-spin" /> Loading blueprint…
      </div>
    );
  }
  if (!data) return null;
  const { current, allStages, history } = data;

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
          <ShieldCheck className="size-4 text-brand-cyan" />
          <h3 className="font-semibold text-sm">Lead Journey</h3>
          <span className="text-xs text-muted-foreground">
            Stage {current.order} of {allStages.length} · {current.name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {slaTone === "overdue" && (
            <span className="chip bg-rose-50 text-rose-700 inline-flex items-center gap-1 text-[10px]">
              <AlertTriangle className="size-3" />
              Overdue by {Math.abs(Math.ceil(current.slaRemainingDays!))}d
            </span>
          )}
          {slaTone === "due-soon" && (
            <span className="chip bg-amber-50 text-amber-700 inline-flex items-center gap-1 text-[10px]">
              <Clock className="size-3" />
              Due in {Math.max(0, Math.floor((current.slaRemainingDays ?? 0) * 24))}h
            </span>
          )}
          {slaTone === "ok" && current.slaDays != null && (
            <span className="chip bg-emerald-50 text-emerald-700 inline-flex items-center gap-1 text-[10px]">
              <Clock className="size-3" />
              Due in {Math.ceil(current.slaRemainingDays!)}d
            </span>
          )}
          {current.ownerRole && (
            <span className="chip bg-secondary text-[10px] capitalize">
              Owner: {current.ownerRole.replace(/_/g, " ")}
            </span>
          )}
          <button
            onClick={resync}
            disabled={advancing}
            title="Re-detect stage from risk profile / proposal / docs on file"
            className="btn-ghost text-[11px]"
          >
            <RefreshCw className={`size-3 ${advancing ? "animate-spin" : ""}`} /> Re-sync
          </button>
          <button onClick={() => setShowHistory((v) => !v)} className="btn-ghost text-[11px]">
            <History className="size-3" /> {showHistory ? "Hide" : "History"}
          </button>
        </div>
      </div>

      {/* Stepper */}
      <div className="overflow-x-auto">
        <ol className="flex items-center min-w-max gap-0.5">
          {allStages.map((s, i) => (
            <li key={s.key} className="flex items-center">
              <div className="flex flex-col items-center min-w-[64px]">
                <div
                  className={`size-7 rounded-full grid place-items-center text-[10px] font-bold ${
                    s.status === "done"
                      ? "bg-emerald-500 text-white"
                      : s.status === "current"
                        ? "bg-brand-cyan text-white ring-2 ring-brand-cyan/30"
                        : "bg-secondary text-muted-foreground"
                  }`}
                  title={s.name}
                >
                  {s.status === "done" ? "✓" : s.order}
                </div>
                <span
                  className={`mt-1 text-[9px] text-center leading-tight max-w-[80px] ${
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

      {/* Next action card */}
      <div className="rounded-lg border border-brand-cyan/30 bg-brand-cyan-light/20 p-3">
        <div className="flex items-center gap-2 mb-2">
          <ChevronRight className="size-3.5 text-brand-cyan" />
          <span className="text-xs font-semibold uppercase tracking-wider text-brand-cyan-deep">
            Next action
          </span>
        </div>
        {current.description && (
          <p className="text-xs text-muted-foreground mb-2">{current.description}</p>
        )}
        {current.allowedActions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {current.allowedActions.map((a) => (
              <span key={a} className="chip bg-white text-xs border border-border">
                {ACTION_LABELS[a] ?? a}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            This is the final stage — no further actions needed.
          </p>
        )}
        <ForwardPicker
          allStages={allStages}
          currentKey={current.key}
          busy={advancing}
          onAdvance={advance}
        />
        {error && (
          <div className="mt-2 text-xs text-rose-700 bg-rose-50/50 rounded p-1.5 flex items-start gap-1.5">
            <AlertTriangle className="size-3 mt-0.5" /> {error}
          </div>
        )}
      </div>

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
                  <div className="text-[10px] text-muted-foreground">
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
  busy,
  onAdvance,
}: {
  allStages: Stage[];
  currentKey: string;
  busy: boolean;
  onAdvance: (key: string, remarks?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [remarks, setRemarks] = useState("");

  const currentIdx = allStages.findIndex((s) => s.key === currentKey);
  // Only show forward stages (you can't undo with this control — use the
  // explicit transition routes for that).
  const candidates = allStages.slice(currentIdx + 1, currentIdx + 4);
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
            <label className="text-[10px] text-muted-foreground">Move to</label>
            <select
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
            <label className="text-[10px] text-muted-foreground">Remarks (optional)</label>
            <textarea
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
