"use client";

/**
 * Risk Profile Questioner — multi-step wizard.
 *
 * Reads the tenant's published template (questions + bands) — the parent
 * fetches it server-side via loadActiveTemplate() and passes it in. Falls
 * back to the seed default when no tenant template exists.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

type Option = { value: string; label: string; score: number };
type Question = { key: string; label: string; helperText?: string; type: "single"; options: Option[] };
type Band = { id: string; label: string; minScore: number; maxScore: number; color?: string; description?: string };
type Template = { name: string; description?: string; questions: Question[]; bands: Band[]; reviewIntervalDays: number };

export function RiskProfileWizard({
  investor,
  template,
}: {
  investor: { id: string; name: string; pan: string; dob: string | null };
  template: Template;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [age, setAge] = useState<string>(deriveAge(investor.dob) ?? "");
  const [remarks, setRemarks] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const questions = template.questions;
  const N = questions.length;
  const onReview = step === N;
  const q = onReview ? null : questions[step];

  // Live scoring preview against the supplied template.
  const live = useMemo(() => {
    let total = 0;
    const breakdown: Array<{ key: string; question: string; answer: string; score: number }> = [];
    for (const q of questions) {
      const val = answers[q.key];
      if (!val) continue;
      const opt = q.options.find((o) => o.value === val);
      if (!opt) continue;
      total += opt.score;
      breakdown.push({ key: q.key, question: q.label, answer: opt.label, score: opt.score });
    }
    const band = template.bands.find((b) => total >= b.minScore && total <= b.maxScore) ?? template.bands[template.bands.length - 1];
    return { total, band, breakdown };
  }, [answers, questions, template.bands]);

  const range = useMemo(() => {
    let min = 0;
    let max = 0;
    for (const q of questions) {
      const s = q.options.map((o) => o.score);
      min += Math.min(...s);
      max += Math.max(...s);
    }
    return { min, max };
  }, [questions]);

  const progress = onReview ? 100 : Math.round((step / N) * 100);
  const canAdvance = q ? !!answers[q.key] : Object.keys(answers).length === N;

  function pick(value: string) {
    if (!q) return;
    setAnswers((s) => ({ ...s, [q.key]: value }));
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/risk-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          investorId: investor.id,
          age: age ? Number(age) : undefined,
          answers,
          documentUrl: documentUrl || undefined,
          rmRemarks: remarks || undefined,
          signedByName: investor.name,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Submit failed (${res.status})`);
        return;
      }
      router.push(`/dashboard/investors/${investor.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/dashboard/risk-profiles"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1 mb-4"
      >
        <ChevronLeft className="size-4" /> Back to risk profiles
      </Link>

      {/* Header */}
      <div className="card-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ShieldCheck className="size-5 text-brand-cyan" /> {template.name}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              For <span className="font-medium text-foreground">{investor.name}</span> · PAN{" "}
              <span className="font-mono">{investor.pan}</span>
            </p>
            {template.description && (
              <p className="text-[11px] text-muted-foreground mt-1 italic">{template.description}</p>
            )}
          </div>
          {!onReview && (
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Question {Math.min(step + 1, N)} of {N}</div>
              <div className="text-2xl font-bold tabular-nums mt-0.5">{progress}%</div>
            </div>
          )}
        </div>

        <div className="mt-4 h-1.5 rounded-full bg-secondary overflow-hidden">
          <div className="h-full brand-gradient transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Body */}
      <div className="card-surface p-6 mt-4">
        {q && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <div className="text-xs uppercase tracking-wide text-brand-cyan font-semibold mb-1">
                Question {step + 1}
              </div>
              <h2 className="text-xl font-semibold">{q.label}</h2>
              {q.helperText && <p className="text-sm text-muted-foreground mt-1.5">{q.helperText}</p>}
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
                        ? "border-brand-cyan bg-brand-cyan-light/40 shadow-sm"
                        : "border-border bg-card hover:border-brand-cyan/40 hover:bg-secondary/40"
                    }`}
                  >
                    <span className="font-medium text-sm">{opt.label}</span>
                    {selected && <CheckCircle2 className="size-5 text-brand-cyan" />}
                  </button>
                );
              })}
            </div>

            {q.key === "age" && (
              <div className="pt-3 border-t">
                <label className="block">
                  <div className="text-xs font-medium mb-1">Exact age (optional)</div>
                  <input
                    type="number"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    placeholder="e.g. 42"
                    className="input-base max-w-xs"
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {onReview && (
          <div className="space-y-5 animate-fade-in">
            <div>
              <div className="text-xs uppercase tracking-wide text-brand-cyan font-semibold mb-1">Review & submit</div>
              <h2 className="text-xl font-semibold">Final risk profile</h2>
            </div>

            <div
              className="border-2 rounded-lg p-5"
              style={{
                borderColor: live.band.color ?? "#0ea5e9",
                background: `${live.band.color ?? "#0ea5e9"}15`,
                color: live.band.color ?? "#0e2557",
              }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide font-semibold opacity-70">Final category</div>
                  <div className="text-3xl font-bold mt-1">{live.band.label}</div>
                  {live.band.description && (
                    <div className="text-xs opacity-80 mt-1">{live.band.description}</div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wide font-semibold opacity-70">Total score</div>
                  <div className="text-3xl font-bold tabular-nums mt-1">
                    {live.total}/{range.max}
                  </div>
                </div>
              </div>
            </div>

            <div className="card-surface p-4">
              <h3 className="font-semibold mb-3">Answer breakdown</h3>
              <ul className="divide-y">
                {live.breakdown.map((b) => (
                  <li key={b.key} className="py-2 flex items-start justify-between gap-3 text-sm">
                    <div className="flex-1">
                      <div className="font-medium">{b.question}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{b.answer}</div>
                    </div>
                    <span className="chip bg-secondary">+{b.score}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card-surface p-4 space-y-3">
              <label className="block">
                <div className="text-xs font-semibold mb-1">Signed document URL (optional)</div>
                <input
                  value={documentUrl}
                  onChange={(e) => setDocumentUrl(e.target.value)}
                  placeholder="https://… (S3 link to signed PDF)"
                  className="input-base"
                />
              </label>
              <label className="block">
                <div className="text-xs font-semibold mb-1">RM remarks</div>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={3}
                  placeholder="Observations, special factors, follow-up needed…"
                  className="input-base"
                />
              </label>
            </div>

            {err && (
              <div className="border border-destructive/30 bg-destructive/5 text-destructive rounded-lg px-3 py-2 text-sm">
                {err}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer nav */}
      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || busy}
          className="btn-secondary"
        >
          <ChevronLeft className="size-4" /> Back
        </button>
        <div className="text-xs text-muted-foreground tabular-nums">
          Live score: <span className="font-semibold">{live.total}</span> ·{" "}
          <span style={{ color: live.band.color ?? undefined }}>{live.band.label}</span>
        </div>
        {onReview ? (
          <button onClick={submit} disabled={busy || !canAdvance} className="btn-primary">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            {busy ? "Saving…" : "Submit profile"}
          </button>
        ) : (
          <button
            onClick={() => setStep((s) => Math.min(N, s + 1))}
            disabled={!canAdvance}
            className="btn-primary"
          >
            {step === N - 1 ? "Review" : "Next"} <ChevronRight className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function deriveAge(dob: string | null): string | null {
  if (!dob) return null;
  try {
    const d = new Date(dob);
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
    return String(age);
  } catch {
    return null;
  }
}
