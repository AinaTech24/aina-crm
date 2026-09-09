"use client";

/**
 * Client feedback (NPS) form — the landing page for /f/<token>.
 *
 * Deliberately one screen: an 0–10 score, an optional comment, and the client's
 * name as a signature. Every extra field costs responses, and the score is the
 * part the firm acts on.
 *
 * POSTs to /api/public/feedback/submit, which files the response as a closed
 * `feedback` service request (CSAT fields set, detractors raised to high
 * priority) and emits a `feedback.submitted` event.
 */

import { useState } from "react";
import { CheckCircle2, Loader2, MessageSquareHeart } from "lucide-react";

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
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [signature, setSignature] = useState(recipientName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (rating == null) {
      setError("Please pick a score from 0 to 10.");
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
          rating,
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
        <h2 className="text-xl font-bold mt-3">Thank you{recipientName ? `, ${recipientName.split(" ")[0]}` : ""}!</h2>
        <p className="text-sm text-slate-600 mt-2">
          Your feedback has reached {firmName}. {rating != null && rating <= 6
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
            {recipientName ? `${recipientName}, how ` : "How "}likely are you to recommend {firmName} to a friend or
            colleague?
          </p>
        </div>
      </div>

      {/* Score 0–10 */}
      <fieldset className="mt-6">
        <legend className="sr-only">Score from 0 to 10</legend>
        <div className="grid grid-cols-6 sm:grid-cols-11 gap-1.5">
          {Array.from({ length: 11 }, (_, n) => {
            const tone = scoreTone(n);
            const active = rating === n;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={active}
                aria-label={`Score ${n}`}
                onClick={() => {
                  setRating(n);
                  setError(null);
                }}
                className={`h-11 rounded-lg border text-sm font-semibold transition ${
                  active ? tone.active : tone.idle
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
        <div className="flex justify-between text-[11px] text-slate-500 mt-1.5">
          <span>Not at all likely</span>
          <span>Extremely likely</span>
        </div>
      </fieldset>

      <label className="block mt-6">
        <span className="text-sm font-medium">
          What made you choose that score? <span className="font-normal text-slate-500">(optional)</span>
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
