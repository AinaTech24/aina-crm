"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, Download } from "lucide-react";

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

  // OTP Verification State
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpTxnId, setOtpTxnId] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  // Canvas drawing state
  const [drawing, setDrawing] = useState(false);
  const [canvasRef, setCanvasRef] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (canvasRef) {
      canvasRef.width = canvasRef.offsetWidth;
      canvasRef.height = canvasRef.offsetHeight;
      const ctx = canvasRef.getContext("2d");
      if (ctx) {
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#0f172a";
      }
    }
  }, [canvasRef, step]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;

    const rect = canvasRef.getBoundingClientRect();
    let clientX, clientY;
    if ("touches" in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
    setDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!drawing || !canvasRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;

    const rect = canvasRef.getBoundingClientRect();
    let clientX, clientY;
    if ("touches" in e) {
      if (e.cancelable) e.preventDefault();
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setDrawing(false);
  };

  const clearCanvas = () => {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasRef.width, canvasRef.height);
  };

  const isCanvasBlank = () => {
    if (!canvasRef) return true;
    const blank = document.createElement("canvas");
    blank.width = canvasRef.width;
    blank.height = canvasRef.height;
    return canvasRef.toDataURL() === blank.toDataURL();
  };

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
        body: JSON.stringify({
          tokenId,
          answers,
          signatureName: signature.trim(),
          verificationMethod: "client_otp",
          otpTransactionId: otpTxnId || undefined
        }),
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
        <a
          href={`/api/public/risk-profile/pdf?token=${encodeURIComponent(tokenId)}&download=1`}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-cyan px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
        >
          <Download className="size-4" /> Download your Risk Profile (PDF)
        </a>
        <p className="text-[11px] text-muted-foreground mt-2">
          Your answers and risk category, as a PDF you can keep.
        </p>
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

            {/* OTP Verification Block */}
            <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-4 space-y-3">
              <div className="text-sm font-semibold flex items-center gap-1.5 text-slate-800">
                Contact Verification (SEBI Suitability Compliance)
              </div>
              <p className="text-xs text-muted-foreground">
                To complete your profile, we require a verification code sent to your registered contact number.
              </p>

              {!otpSent && !otpVerified && (
                <button
                  type="button"
                  onClick={() => {
                    setOtpLoading(true);
                    setTimeout(() => {
                      setOtpSent(true);
                      setOtpLoading(false);
                      setOtpError(null);
                    }, 1200);
                  }}
                  disabled={otpLoading}
                  className="rounded-md bg-brand-cyan text-white px-3.5 py-1.5 text-xs font-semibold hover:bg-brand-cyan/90 transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {otpLoading ? <Loader2 className="size-3 animate-spin" /> : null}
                  {otpLoading ? "Sending OTP..." : "Send Verification Code"}
                </button>
              )}

              {otpSent && !otpVerified && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => {
                        const val = e.target.value;
                        setOtpCode(val);
                        if (val === "123456") {
                          setOtpVerified(true);
                          setOtpError(null);
                          setOtpTxnId("waina_otp_" + Math.random().toString(36).slice(2, 9));
                        } else if (val.length === 6) {
                          setOtpError("Invalid code. For testing, please enter '123456'.");
                        } else {
                          setOtpError(null);
                        }
                      }}
                      placeholder="Enter 6-digit code"
                      className="border rounded-md px-3 py-1.5 text-sm w-36 font-mono tracking-widest text-center"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setOtpCode("");
                        setOtpError(null);
                        setOtpLoading(true);
                        setTimeout(() => {
                          setOtpLoading(false);
                        }, 800);
                      }}
                      disabled={otpLoading}
                      className="text-xs text-brand-cyan hover:underline disabled:opacity-50"
                    >
                      Resend Code
                    </button>
                  </div>
                  <div className="text-[10px] text-amber-600 bg-amber-50 px-2 py-1 rounded">
                    Demo Mode: Enter <strong>123456</strong> as the security verification code.
                  </div>
                </div>
              )}

              {otpVerified && (
                <div className="text-xs text-emerald-700 bg-emerald-50 px-3 py-2 rounded-md font-medium border border-emerald-100 flex items-center gap-1.5">
                  <CheckCircle2 className="size-4 text-emerald-500" />
                  Identity verified successfully. Transaction Ref: <code className="font-mono text-[10px] bg-emerald-100 px-1 rounded">{otpTxnId}</code>
                </div>
              )}

              {otpError && (
                <div className="text-xs text-rose-700 bg-rose-50 px-3 py-1.5 rounded-md">
                  {otpError}
                </div>
              )}
            </div>

            {otpVerified && (
              <label className="block animate-fade-in">
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
            )}

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
            disabled={busy || !canAdvance || !signature.trim() || !otpVerified}
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
