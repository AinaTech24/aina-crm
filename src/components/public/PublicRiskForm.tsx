"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

type Option = { value: string; label: string; score: number };
type Question = { key: string; label: string; helperText?: string; type: "single"; options: Option[] };
type Band = { id: string; label: string; minScore: number; maxScore: number; color?: string; description?: string };

export function PublicRiskForm({
  tokenId,
  recipientName,
  template,
}: {
  tokenId: string;
  recipientName: string;
  template: { name: string; description?: string; questions: Question[]; bands: Band[]; reviewIntervalDays: number };
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { bandLabel: string; total: number; color?: string; description?: string }>(null);

  const N = template.questions.length;
  const onReview = step === N;
  const q = onReview ? null : template.questions[step];

  const live = useMemo(() => {
    let total = 0;
    for (const q of template.questions) {
      const v = answers[q.key];
      if (!v) continue;
      const opt = q.options.find((o) => o.value === v);
      if (opt) total += opt.score;
    }
    const band = template.bands.find((b) => total >= b.minScore && total <= b.maxScore) ?? template.bands[template.bands.length - 1];
    return { total, band };
  }, [answers, template]);

  const canAdvance = q ? !!answers[q.key] : Object.keys(answers).length === N;
  const progress = onReview ? 100 : Math.round((step / N) * 100);

  function pick(value: string) {
    if (!q) return;
    setAnswers((s) => ({ ...s, [q.key]: value }));
  }

  async function submit() {
    if (!signature.trim()) {
      setError("Please type your full name to submit.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/public/risk-profile/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenId, answers, signatureName: signature.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setDone({
        bandLabel: data.bandLabel,
        total: data.totalScore,
        color: data.bandColor,
        description: data.bandDescription,
      });
    } catch (e: any) {
      setError(e?.message ?? "Submission failed");
    } finally {
      setBusy(false);
    }
  }

  // ── Submission success screen ──
  if (done) {
    return (
      <div className="bg-white rounded-xl shadow p-8 text-center">
        <CheckCircle2 className="size-12 text-emerald-500 mx-auto" />
        <h2 className="text-xl font-bold mt-3">Thank you, {recipientName.split(" ")[0] || "investor"}!</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Your risk profile has been recorded. Your relationship manager will be in touch shortly.
        </p>
        <div
          className="mt-6 rounded-lg border-2 p-5"
          style={{ borderColor: done.color ?? "#0ea5e9", background: `${done.color ?? "#0ea5e9"}15` }}
        >
          <div className="text-xs uppercase tracking-wide font-semibold opacity-70">Your category</div>
          <div className="text-2xl font-bold mt-1" style={{ color: done.color ?? "#0e2557" }}>{done.bandLabel}</div>
          <div className="text-sm tabular-nums mt-1 text-muted-foreground">Score: {done.total}</div>
          {done.description && <div className="text-xs text-muted-foreground mt-2">{done.description}</div>}
        </div>
      </div>
    );
  }

  // ── Header ──
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold">{template.name}</h1>
            {recipientName && (
              <p className="text-sm text-muted-foreground mt-1">
                Hi <span className="font-medium text-foreground">{recipientName}</span> — please take a moment to answer
                these questions so we can recommend the right investments for you.
              </p>
            )}
            {template.description && (
              <p className="text-[11px] text-muted-foreground mt-1 italic">{template.description}</p>
            )}
          </div>
          {!onReview && (
            <div className="text-right text-xs">
              <div className="text-muted-foreground">Question {Math.min(step + 1, N)} of {N}</div>
              <div className="font-bold tabular-nums mt-0.5">{progress}%</div>
            </div>
          )}
        </div>
        <div className="mt-3 h-1.5 rounded-full bg-secondary overflow-hidden">
          <div className="h-full bg-brand-cyan transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Body */}
      <div className="bg-white rounded-xl shadow p-6">
        {q && (
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">{q.label}</h2>
              {q.helperText && <p className="text-sm text-muted-foreground mt-1">{q.helperText}</p>}
            </div>
            <div className="space-y-2">
              {q.options.map((opt) => {
                const selected = answers[q.key] === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => pick(opt.value)}
                    className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all flex items-center justify-between ${
                      selected
                        ? "border-brand-cyan bg-brand-cyan-light/40"
                        : "border-border bg-card hover:border-brand-cyan/40"
                    }`}
                  >
                    <span className="font-medium text-sm">{opt.label}</span>
                    {selected && <CheckCircle2 className="size-5 text-brand-cyan" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {onReview && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Review & submit</h2>
              <p className="text-sm text-muted-foreground mt-1">Please confirm your answers and sign below.</p>
            </div>

            <div
              className="rounded-lg border-2 p-4"
              style={{ borderColor: live.band.color ?? "#0ea5e9", background: `${live.band.color ?? "#0ea5e9"}15` }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide font-semibold opacity-70">Your category</div>
                  <div className="text-2xl font-bold mt-1" style={{ color: live.band.color }}>{live.band.label}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wide font-semibold opacity-70">Score</div>
                  <div className="text-2xl font-bold tabular-nums mt-1">{live.total}</div>
                </div>
              </div>
            </div>

            <label className="block">
              <div className="text-xs font-semibold mb-1">Signature (type your full name)</div>
              <input
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="e.g. Rajesh Sharma"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
              <div className="text-[10px] text-muted-foreground mt-1">
                By signing, you confirm that the answers above reflect your true financial situation and risk
                appetite. Mutual fund investments are subject to market risks.
              </div>
            </label>

            {error && <div className="text-xs text-rose-700 bg-rose-50 rounded-md p-2">{error}</div>}
          </div>
        )}
      </div>

      {/* Nav */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || busy}
          className="rounded-md border bg-white px-3 py-2 text-sm flex items-center gap-1 disabled:opacity-40"
        >
          <ChevronLeft className="size-4" /> Back
        </button>
        {onReview ? (
          <button
            onClick={submit}
            disabled={busy || !canAdvance || !signature.trim()}
            className="rounded-md bg-brand-cyan text-white px-4 py-2 text-sm font-semibold flex items-center gap-1 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            {busy ? "Submitting…" : "Submit"}
          </button>
        ) : (
          <button
            onClick={() => setStep((s) => Math.min(N, s + 1))}
            disabled={!canAdvance}
            className="rounded-md bg-brand-cyan text-white px-3 py-2 text-sm font-semibold flex items-center gap-1 disabled:opacity-40"
          >
            {step === N - 1 ? "Review" : "Next"} <ChevronRight className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
