"use client";

/**
 * Wealth Story — Spotify-Wrapped-style 12-month recap for a client.
 *
 * Renders a button that opens a celebratory modal (gradient hero, big stat
 * cards, goals, fun-fact chips) built from GET /api/investors/[id]/wealth-story.
 * Footer actions: Download the branded PDF (?pdf=1 via fetch→blob, route never
 * exposed in an <a href>), Email it to the client (POST { action: "email" }).
 */

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Sparkles, X, Loader2, FileDown, Mail, Check, Target, TrendingUp, PiggyBank, Trophy, CalendarClock } from "lucide-react";
import { downloadFile } from "@/lib/secure-download";

type Story = {
  client: { name: string; email: string | null; tenureYears: number; riskProfile: string | null };
  period: { from: string; to: string };
  invested: number;
  withdrawn: number;
  netInvested: number;
  currentValue: number;
  sipInstallments: number;
  sipTotal: number;
  activeMonths: number;
  topHolding: { name: string; value: number } | null;
  holdingsCount: number;
  amcCount: number;
  goals: { name: string; targetAmount: number; progressPct: number | null }[];
  funFacts: string[];
  hasData: boolean;
};

const inr = (n: number) => `₹${Math.round(n ?? 0).toLocaleString("en-IN")}`;
const mon = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

export function WealthStoryButton({
  investorId,
  clientName,
  className,
}: {
  investorId: string;
  clientName: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [story, setStory] = useState<Story | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [busy, setBusy] = useState<null | "pdf" | "email">(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function openStory() {
    setOpen(true);
    setNotice(null);
    setEmailOpen(false);
    if (story) return; // cached for this mount
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/investors/${investorId}/wealth-story`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? `Could not load the story (${res.status})`);
      } else {
        setStory(j);
        setEmailTo(j?.client?.email ?? "");
      }
    } catch (e: any) {
      setError(e?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function onDownload() {
    setBusy("pdf");
    setNotice(null);
    try {
      await downloadFile(
        `/api/investors/${investorId}/wealth-story?pdf=1`,
        `WealthStory_${clientName.replace(/[^A-Za-z0-9_-]+/g, "_")}.pdf`
      );
      setNotice({ kind: "ok", text: "PDF downloaded" });
    } catch {
      setNotice({ kind: "err", text: "Download failed" });
    } finally {
      setBusy(null);
    }
  }

  async function onEmail() {
    const to = emailTo.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      setNotice({ kind: "err", text: "Enter a valid email address." });
      return;
    }
    setBusy("email");
    setNotice(null);
    try {
      const res = await fetch(`/api/investors/${investorId}/wealth-story`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "email", to }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setNotice({ kind: "err", text: j.error ?? `Failed (${res.status})` });
      else {
        setNotice({ kind: "ok", text: `Wealth Story emailed to ${to}` });
        setEmailOpen(false);
      }
    } catch (e: any) {
      setNotice({ kind: "err", text: e?.message ?? "Network error" });
    } finally {
      setBusy(null);
    }
  }

  const s = story;
  const firstName = (clientName || "").split(/\s+/)[0] || "Client";

  return (
    <>
      <button
        type="button"
        onClick={openStory}
        className={
          className ??
          "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white shadow-sm " +
            "bg-gradient-to-r from-violet-600 via-fuchsia-600 to-amber-500 hover:opacity-90 transition-opacity"
        }
      >
        <Sparkles className="size-3.5" /> Wealth Story
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <div className="relative w-full max-w-2xl max-h-[90vh] card-elevated overflow-hidden flex flex-col">
              {/* ── Hero ── */}
              <div className="brand-mesh text-white px-6 py-6 relative shrink-0">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="absolute top-3 right-3 rounded-full p-1.5 text-white/80 hover:text-white hover:bg-white/10"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </button>
                <div className="text-[11px] uppercase tracking-[0.2em] text-white/70 font-semibold">Your year in investing</div>
                <h2 className="text-xl sm:text-2xl font-bold mt-1 flex items-center gap-2">
                  <span aria-hidden>✨</span> {clientName}&rsquo;s Wealth Story
                </h2>
                {s && (
                  <div className="text-xs text-white/75 mt-1.5 inline-flex items-center gap-1.5">
                    <CalendarClock className="size-3.5" /> {mon(s.period.from)} – {mon(s.period.to)}
                    {s.client.tenureYears >= 1 && (
                      <span className="ml-2">· investing together for {s.client.tenureYears} yr{s.client.tenureYears >= 2 ? "s" : ""}</span>
                    )}
                  </div>
                )}
              </div>

              {/* ── Body ── */}
              <div className="overflow-y-auto p-6 space-y-5 bg-card">
                {loading && (
                  <div className="flex flex-col items-center justify-center py-14 text-muted-foreground gap-3">
                    <Loader2 className="size-6 animate-spin" />
                    <span className="text-sm">Composing {firstName}&rsquo;s story…</span>
                  </div>
                )}

                {!loading && error && <div className="text-sm text-rose-600 py-8 text-center">{error}</div>}

                {!loading && s && !s.hasData && (
                  <div className="text-center py-12 space-y-2">
                    <div className="text-3xl" aria-hidden>📭</div>
                    <p className="text-sm font-medium">No portfolio data yet for {firstName}.</p>
                    <p className="text-xs text-muted-foreground">
                      Import their portfolio first — see <span className="font-semibold">RTA File Imports</span> under Operations.
                    </p>
                  </div>
                )}

                {!loading && s && s.hasData && (
                  <>
                    {/* Big stat cards */}
                    <div className="grid grid-cols-2 gap-3">
                      <StatCard icon={<TrendingUp className="size-4" />} label="Value today" value={inr(s.currentValue)} accent="text-emerald-600" />
                      <StatCard icon={<PiggyBank className="size-4" />} label="You added this year" value={inr(s.invested)} accent="text-brand-cyan" />
                      <StatCard
                        icon={<Sparkles className="size-4" />}
                        label="SIP installments"
                        value={String(s.sipInstallments)}
                        sub={s.sipTotal > 0 ? `${inr(s.sipTotal)} via SIP` : undefined}
                        accent="text-violet-600"
                      />
                      <StatCard
                        icon={<Trophy className="size-4" />}
                        label="Top holding"
                        value={s.topHolding ? s.topHolding.name : "—"}
                        sub={s.topHolding ? inr(s.topHolding.value) : undefined}
                        accent="text-amber-600"
                        small={!!s.topHolding}
                      />
                    </div>

                    {/* Honest secondary line */}
                    <p className="text-[11px] text-muted-foreground">
                      &ldquo;Value today&rdquo; is the current portfolio value on record · added {inr(s.invested)}
                      {s.withdrawn > 0 && <> · withdrew {inr(s.withdrawn)} · net {inr(s.netInvested)}</>} · {s.holdingsCount} scheme
                      {s.holdingsCount === 1 ? "" : "s"} across {s.amcCount} fund house{s.amcCount === 1 ? "" : "s"}. Past activity is not a
                      projection of returns.
                    </p>

                    {/* Goals */}
                    {s.goals.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-sm font-semibold flex items-center gap-1.5">
                          <Target className="size-4 text-brand-cyan" /> Goals in motion
                        </h3>
                        <div className="space-y-1.5">
                          {s.goals.map((g, i) => (
                            <div key={i} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-sm">
                              <span className="truncate mr-3">{g.name}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                target <span className="font-semibold text-foreground">{inr(g.targetAmount)}</span>
                                {g.progressPct != null && <> · {Math.round(g.progressPct)}% there</>}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Fun facts */}
                    {s.funFacts.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {s.funFacts.map((f, i) => (
                          <span key={i} className="chip bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                            <span aria-hidden>🎉</span> {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── Footer ── */}
              <div className="border-t px-4 py-3 bg-card shrink-0 space-y-2">
                {notice && (
                  <div className={`text-xs inline-flex items-center gap-1 ${notice.kind === "ok" ? "text-emerald-600" : "text-rose-600"}`}>
                    {notice.kind === "ok" && <Check className="size-3.5" />} {notice.text}
                  </div>
                )}
                {emailOpen && s?.hasData && (
                  <div className="flex items-center gap-2">
                    <input
                      type="email"
                      value={emailTo}
                      onChange={(e) => setEmailTo(e.target.value)}
                      placeholder="client@email.com"
                      className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                    />
                    <button type="button" onClick={onEmail} disabled={busy !== null} className="btn-primary text-xs">
                      {busy === "email" ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />} Send
                    </button>
                    <button type="button" onClick={() => setEmailOpen(false)} className="btn-secondary text-xs">
                      Cancel
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button type="button" onClick={onDownload} disabled={busy !== null || !s?.hasData} className="btn-secondary text-xs">
                    {busy === "pdf" ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />} Download PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEmailOpen((v) => !v); setNotice(null); }}
                    disabled={busy !== null || !s?.hasData}
                    className="btn-secondary text-xs"
                  >
                    <Mail className="size-3.5" /> Email to client
                  </button>
                  <button type="button" onClick={() => setOpen(false)} className="btn-secondary text-xs">
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
  small,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/60 p-3.5">
      <div className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}>
        <span className={accent}>{icon}</span> {label}
      </div>
      <div className={`mt-1 font-bold ${small ? "text-sm leading-snug" : "text-xl"} ${accent}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
