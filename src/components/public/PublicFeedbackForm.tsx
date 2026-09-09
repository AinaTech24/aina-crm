"use client";

/**
 * Client feedback form — the landing page for /f/<token>.
 *
 * A short rated questionnaire (see lib/support/feedback-questions), an optional
 * comment, and the client's name as a signature.
 *
 * Every question sits on ONE screen rather than a wizard: five 0–10 rows are
 * quicker to answer in a single pass than five steps, and the client can see how
 * much is left — the main reason short forms get abandoned part-way.
 *
 * POSTs to /api/public/feedback/submit, which files the response as a closed
 * `feedback` service request (per-question answers stored, detractors raised to
 * high priority) and emits a `feedback.submitted` event.
 */

import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, MessageSquareHeart } from "lucide-react";
import { FEEDBACK_QUESTIONS, NPS_QUESTION_KEY } from "@/lib/support/feedback-questions";

/**
 * 0–6 detractor, 7–8 passive, 9–10 promoter (standard NPS bands).
 *
 * Both states are FULL literal class strings. Tailwind scans source statically,
 * so a class assembled at runtime (`hover:${tone.ring}`) is never generated and
 * the style silently does nothing — a trap this codebase has hit before.
 */
function scoreTone(n: number): { idle: string; active: string } {
  if (n <= 6)
    return {
      idle: "bg-white text-slate-700 border-slate-200 hover:border-rose-300 hover:bg-rose-50",
      active: "bg-rose-500 text-white border-rose-500",
    };
  if (n <= 8)
    return {
      idle: "bg-white text-slate-700 border-slate-200 hover:border-amber-300 hover:bg-amber-50",
      active: "bg-amber-500 text-white border-amber-500",
    };
  return {
    idle: "bg-white text-slate-700 border-slate-200 hover:border-emerald-300 hover:bg-emerald-50",
    active: "bg-emerald-500 text-white border-emerald-500",
  };
}

export function PublicFeedbackForm({
  tokenId,
  recipientName,
  firmName,
}: {
  tokenId: string;
  recipientName: string;
  firmName: string;
}) {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const [signature, setSignature] = useState(recipientName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const answered = Object.keys(scores).length;
  const firstUnanswered = useMemo(
    () => FEEDBACK_QUESTIONS.find((q) => scores[q.key] === undefined)?.key ?? null,
    [scores]
  );
  const npsScore = scores[NPS_QUESTION_KEY];

  async function submit() {
    if (firstUnanswered) {
      setError("Please answer every question above.");
      document.getElementById(`q-${firstUnanswered}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!signature.trim()) {
      setError("Please type your name to confirm this feedback is yours.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/public/feedback/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tokenId,
          answers: FEEDBACK_QUESTIONS.map((q) => ({ key: q.key, label: q.label, score: scores[q.key] })),
          comment: comment.trim(),
          signatureName: signature.trim(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Could not submit your feedback");
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="bg-white rounded-xl shadow p-8 text-center">
        <CheckCircle2 className="size-12 text-emerald-500 mx-auto" />
        <h2 className="text-xl font-bold mt-3">
          Thank you{recipientName ? `, ${recipientName.split(" ")[0]}` : ""}!
        </h2>
        <p className="text-sm text-slate-600 mt-2">
          Your feedback has reached {firmName}.{" "}
          {npsScore != null && npsScore <= 6
            ? "Someone from the team will get in touch with you shortly."
            : "We're grateful you took the time."}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <MessageSquareHeart className="size-6 text-brand-cyan shrink-0 mt-0.5" />
        <div>
          <h1 className="text-lg font-bold">How are we doing?</h1>
          <p className="text-sm text-slate-600 mt-1">
            {recipientName ? `${recipientName}, a` : "A"} few quick questions about working with {firmName}. Rate each
            one from 0 (not at all) to 10 (completely) — it takes about a minute.
          </p>
        </div>
      </div>

      {/* Progress — shown so it is obvious how much is left. */}
      <div className="mt-5 flex items-center gap-3">
        <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full bg-brand-cyan transition-all"
            style={{ width: `${(answered / FEEDBACK_QUESTIONS.length) * 100}%` }}
          />
        </div>
        <span className="text-[11px] text-slate-500 tabular-nums shrink-0">
          {answered} of {FEEDBACK_QUESTIONS.length}
        </span>
      </div>

      <div className="mt-6 space-y-7">
        {FEEDBACK_QUESTIONS.map((q, qi) => (
          <fieldset key={q.key} id={`q-${q.key}`}>
            <legend className="text-sm font-medium text-slate-900">
              {qi + 1}. {q.label}
            </legend>
            {q.hint && <p className="text-xs text-slate-500 mt-0.5">{q.hint}</p>}

            <div className="grid grid-cols-6 sm:grid-cols-11 gap-1.5 mt-3">
              {Array.from({ length: 11 }, (_, n) => {
                const tone = scoreTone(n);
                const active = scores[q.key] === n;
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={active}
                    aria-label={`${q.label} — score ${n}`}
                    onClick={() => {
                      setScores((s) => ({ ...s, [q.key]: n }));
                      setError(null);
                    }}
                    className={`h-10 rounded-lg border text-sm font-semibold transition ${
                      active ? tone.active : tone.idle
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            {qi === 0 && (
              <div className="flex justify-between text-[11px] text-slate-500 mt-1.5">
                <span>Not at all</span>
                <span>Completely</span>
              </div>
            )}
          </fieldset>
        ))}
      </div>

      <label className="block mt-8">
        <span className="text-sm font-medium">
          Anything you would like to add? <span className="font-normal text-slate-500">(optional)</span>
        </span>
        <textarea
          rows={4}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={2000}
          placeholder="Anything we did well, or anything we should do better."
          className="mt-1.5 w-full rounded-lg border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
        />
      </label>

      <label className="block mt-4">
        <span className="text-sm font-medium">Your name</span>
        <input
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          maxLength={120}
          className="mt-1.5 w-full rounded-lg border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
        />
      </label>

      {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="mt-6 w-full h-11 rounded-lg bg-brand-cyan text-white font-semibold text-sm disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {busy ? "Sending…" : "Submit feedback"}
      </button>

      <p className="mt-3 text-[11px] text-slate-500 text-center">
        This link is personal to you and can be used once.
      </p>
    </div>
  );
}
