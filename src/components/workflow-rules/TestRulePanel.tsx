"use client";

/**
 * TestRulePanel — dry-run a workflow rule against a real record. Pick one of
 * the module's recent records, hit "Run test", and see which condition branch
 * would match and exactly which actions WOULD fire. Nothing is executed and
 * nothing is logged — safe to use on production data.
 */

import { useEffect, useState } from "react";
import { FlaskConical, Loader2, CheckCircle2, XCircle, Zap, Clock, Send, AlertTriangle } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";

type TestResult = {
  matched: boolean;
  live?: boolean;
  totalBranches?: number;
  branchIndex?: number;
  branchName?: string;
  message?: string;
  note?: string;
  wouldRunInstant?: Array<{ type: string; label?: string }>;
  wouldQueueScheduled?: Array<{ type: string; label?: string; delay?: { amount: number; unit: string } }>;
  ranInstant?: Array<{ type: string; status: string; detail?: string }>;
};

const ACTION_LABELS: Record<string, string> = {
  send_email: "Email Notification",
  send_whatsapp: "WhatsApp Message",
  send_sms: "SMS Message",
  create_task: "Task",
  schedule_meeting: "Meeting",
  schedule_call: "Call",
  update_field: "Field Update",
  add_tag: "Add Tag",
  remove_tag: "Remove Tag",
  webhook: "Webhook",
  convert_lead: "Convert Lead",
  create_notification: "In-app Notification",
};

export function TestRulePanel({ ruleId }: { ruleId: string }) {
  const [records, setRecords] = useState<Array<{ id: string; name: string }>>([]);
  const [subjectId, setSubjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [result, setResult] = useState<TestResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/workflow-rules/${ruleId}/test`)
      .then((r) => (r.ok ? r.json() : { records: [] }))
      .then((j) => {
        setRecords(j.records ?? []);
        if (j.records?.[0]) setSubjectId(j.records[0].id);
      })
      .catch(() => {})
      .finally(() => setLoadingRecords(false));
  }, [ruleId]);

  async function runTest(live = false) {
    if (!subjectId) return;
    if (live && !confirm("Run this rule LIVE for the selected record? Its instant actions (e.g. the email) will actually be sent.")) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await fetch(`/api/workflow-rules/${ruleId}/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subjectId, live }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setResult(j as TestResult);
    } catch (e: any) {
      setErr(e?.message ?? "Test failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface p-4 space-y-3">
      <h3 className="font-semibold flex items-center gap-2 text-sm">
        <FlaskConical className="size-4 text-brand-cyan" /> Run this rule
        <span className="text-[10px] font-normal text-muted-foreground">executes the rule&rsquo;s instant actions for the chosen record</span>
      </h3>

      <div className="flex items-center gap-2 flex-wrap">
        <SelectField
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          className="text-sm w-full sm:w-72"
          disabled={loadingRecords || records.length === 0}
        >
          {records.length === 0 ? (
            <option value="">{loadingRecords ? "Loading records…" : "No records in this module yet"}</option>
          ) : (
            records.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))
          )}
        </SelectField>
        <button
          type="button"
          onClick={() => runTest(true)}
          disabled={busy || !subjectId}
          className="btn-primary text-xs disabled:opacity-50"
          title="Actually execute the rule's instant actions (sends the email for real)"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Run live (send)
        </button>
      </div>

      {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2.5 py-1.5">{err}</div>}

      {result && (
        <div
          className={`rounded-lg border p-3 space-y-2 ${
            result.matched ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50"
          }`}
        >
          <div className={`flex items-center gap-2 text-sm font-semibold ${result.matched ? "text-emerald-700" : "text-amber-700"}`}>
            {result.matched ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
            {result.matched
              ? `Matches — falls into “${result.branchName}”${(result.totalBranches ?? 1) > 1 ? ` (of ${result.totalBranches} conditions)` : ""}`
              : "Does not match — the rule would not fire for this record"}
          </div>
          {result.message && <p className="text-xs text-amber-800">{result.message}</p>}

          {result.matched && result.live && (
            <div className="text-xs">
              <div className="font-semibold flex items-center gap-1 text-foreground/80 mb-1">
                <Send className="size-3" /> Executed now (live)
              </div>
              <ul className="space-y-1">
                {(result.ranInstant ?? []).map((a, i) => {
                  const ok = a.status === "succeeded";
                  const skip = a.status === "skipped";
                  return (
                    <li key={i} className="flex items-start gap-1.5">
                      {ok ? <CheckCircle2 className="size-3.5 text-emerald-600 mt-px shrink-0" />
                        : skip ? <AlertTriangle className="size-3.5 text-amber-600 mt-px shrink-0" />
                        : <XCircle className="size-3.5 text-rose-600 mt-px shrink-0" />}
                      <span>
                        <strong>{ACTION_LABELS[a.type] ?? a.type}</strong> — {ok ? "sent ✓" : a.status}
                        {a.detail ? <span className="text-muted-foreground"> ({a.detail})</span> : ""}
                      </span>
                    </li>
                  );
                })}
                {(result.ranInstant ?? []).length === 0 && <li className="text-muted-foreground italic">no instant actions on this rule</li>}
              </ul>
            </div>
          )}

          {result.matched && !result.live && (
            <>
              <div className="text-xs">
                <div className="font-semibold flex items-center gap-1 text-foreground/80 mb-1">
                  <Zap className="size-3" /> Would run now
                </div>
                {result.wouldRunInstant?.length ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {result.wouldRunInstant.map((a, i) => (
                      <li key={i} className="chip bg-brand-cyan-light text-brand-cyan-deep text-[10px]">
                        {ACTION_LABELS[a.type] ?? a.type}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted-foreground italic">none</span>
                )}
              </div>
              <div className="text-xs">
                <div className="font-semibold flex items-center gap-1 text-foreground/80 mb-1">
                  <Clock className="size-3" /> Would be scheduled
                </div>
                {result.wouldQueueScheduled?.length ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {result.wouldQueueScheduled.map((a, i) => (
                      <li key={i} className="chip bg-amber-50 text-amber-700 text-[10px]">
                        {ACTION_LABELS[a.type] ?? a.type}
                        {a.delay ? ` · after ${a.delay.amount} ${a.delay.unit}(s)` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted-foreground italic">none</span>
                )}
              </div>
            </>
          )}

          {result.note && <p className="text-[10px] text-muted-foreground">{result.note}</p>}
        </div>
      )}
    </div>
  );
}
