"use client";

/**
 * "Send NPS survey" — pick clients (search), a client segment, or all clients,
 * see how many will actually get it, then send the `feedback_nps` email. Each client gets
 * their own feedback link; see POST /api/support/feedback/send.
 *
 * Two steps on purpose: the preview counts who has no email on file before
 * anything is sent, so "send to 40" never quietly means 31.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, X, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { buttonClass } from "@/components/ui/button-class";
import { SelectField } from "@/components/ui/SelectField";

type Picked = { id: string; name: string; sub?: string };
type Preview = { total: number; sendable: number; noEmail: number; noEmailSample: string[]; alreadySurveyed?: number; capped: boolean; limit: number };
type Result = { attempted: number; sent: number; skipped: number; failed: { name: string; error: string }[]; noEmail: number; alreadySurveyed?: number; remaining: number };

export function SendNpsSurvey({ label = "Send NPS survey", className }: { label?: string; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"clients" | "segment" | "all">("clients");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Picked[]>([]);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [segments, setSegments] = useState<{ value: string; label: string }[] | null>(null);
  const [segmentId, setSegmentId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMode("clients");
    setQ("");
    setHits([]);
    setPicked([]);
    setSegmentId("");
    setPreview(null);
    setResult(null);
    setError(null);
  }

  // Client search — the same endpoint as the Ctrl+K palette, so the same scope.
  useEffect(() => {
    if (!open || mode !== "clients" || q.trim().length < 2) {
      setHits([]);
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const j = await (await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`)).json();
        if (live)
          setHits(
            (j.investors ?? []).map((r: any) => ({
              id: String(r.id),
              name: r.name,
              sub: [r.email || "no email", r.pan].filter(Boolean).join(" · "),
            }))
          );
      } catch {
        if (live) setHits([]);
      }
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, open, mode]);

  // Client segments, loaded once the Segment tab is opened.
  useEffect(() => {
    if (!open || mode !== "segment" || segments) return;
    fetch("/api/segments")
      .then((r) => (r.ok ? r.json() : { segments: [] }))
      .then((j) =>
        setSegments(
          (j.segments ?? [])
            .filter((s: any) => s.subjectType === "investor")
            .map((s: any) => ({ value: String(s.id), label: s.name }))
        )
      )
      .catch(() => setSegments([]));
  }, [open, mode, segments]);

  const body = useMemo(
    () => (mode === "all" ? { all: true as const } : mode === "clients" ? { investorIds: picked.map((p) => p.id) } : { segmentId }),
    [mode, picked, segmentId]
  );
  const ready = mode === "all" ? true : mode === "clients" ? picked.length > 0 : !!segmentId;

  // Any change to the audience invalidates the preview.
  useEffect(() => {
    setPreview(null);
    setError(null);
  }, [body]);

  async function call(dryRun: boolean) {
    setBusy(dryRun ? "preview" : "send");
    setError(null);
    try {
      const res = await fetch("/api/support/feedback/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, dryRun }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? "That didn't go through.");
        return;
      }
      if (dryRun) setPreview(j);
      else {
        setResult(j);
        router.refresh();
      }
    } catch {
      setError("Network error. Nothing was sent.");
    } finally {
      setBusy(null);
    }
  }

  const tab = (on: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`;

  return (
    <>
      <button type="button" onClick={() => { reset(); setOpen(true); }} className={className ?? buttonClass("primary")}>
        <Send className="size-4" /> {label}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send NPS survey</DialogTitle>
            <DialogDescription>
              Emails the &ldquo;Feedback / NPS Survey&rdquo; template. Each client gets their own 0–10 feedback link; replies
              land on this page.
            </DialogDescription>
          </DialogHeader>

          {result ? (
            <div className="mt-4 space-y-2 text-sm">
              <p className="font-medium">
                Sent to {result.sent} client{result.sent === 1 ? "" : "s"}.
              </p>
              {result.skipped > 0 && (
                <p className="text-muted-foreground">
                  {result.skipped} held back by consent or compliance checks (see Communications).
                </p>
              )}
              {result.noEmail > 0 && <p className="text-muted-foreground">{result.noEmail} have no email on file.</p>}
              {result.failed.length > 0 && (
                <p className="text-destructive">{result.failed.length} failed: {result.failed.slice(0, 3).map((f) => f.name).join(", ")}.</p>
              )}
              {result.remaining > 0 && (
                <p className="text-muted-foreground">{result.remaining} more are waiting — send the next batch to reach them.</p>
              )}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div role="tablist" aria-label="Send to" className="inline-flex gap-1 rounded-lg border border-border bg-secondary/40 p-1">
                <button type="button" role="tab" aria-selected={mode === "clients"} onClick={() => setMode("clients")} className={tab(mode === "clients")}>
                  Clients
                </button>
                <button type="button" role="tab" aria-selected={mode === "segment"} onClick={() => setMode("segment")} className={tab(mode === "segment")}>
                  Segment
                </button>
                <button type="button" role="tab" aria-selected={mode === "all"} onClick={() => setMode("all")} className={tab(mode === "all")}>
                  All clients
                </button>
              </div>

              {mode === "all" ? (
                <p className="text-sm text-muted-foreground">
                  Every active client you look after who has an email on file. Anyone already surveyed this month is skipped.
                </p>
              ) : mode === "clients" ? (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Search clients by name, PAN, email…"
                      aria-label="Search clients"
                      className="input-base w-full pl-8"
                    />
                  </div>
                  {hits.length > 0 && (
                    <ul className="max-h-40 overflow-y-auto rounded-md border divide-y">
                      {hits.map((h) => {
                        const on = picked.some((p) => p.id === h.id);
                        return (
                          <li key={h.id}>
                            <button
                              type="button"
                              disabled={on}
                              onClick={() => setPicked((p) => [...p, h])}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-secondary disabled:opacity-50"
                            >
                              {h.name}
                              {h.sub && <span className="block text-2xs text-muted-foreground">{h.sub}</span>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {picked.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {picked.map((p) => (
                        <span key={p.id} className="inline-flex items-center gap-1 rounded-full border bg-secondary px-2 py-0.5 text-xs">
                          {p.name}
                          <button
                            type="button"
                            onClick={() => setPicked((all) => all.filter((x) => x.id !== p.id))}
                            aria-label={`Remove ${p.name}`}
                            className="grid size-4 place-items-center rounded-full hover:bg-card"
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : segments === null ? (
                <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 className="size-3.5 animate-spin" /> Loading segments…
                </p>
              ) : segments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No client segments yet. Build one under Segments, then send to it here.</p>
              ) : (
                <SelectField value={segmentId} onChange={(e) => setSegmentId(e.target.value)} aria-label="Segment" placeholder="Choose a segment…">
                  <option value="">Choose a segment…</option>
                  {segments.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </SelectField>
              )}

              {preview && (
                <div className="rounded-md border bg-secondary/40 px-3 py-2 text-sm">
                  <span className="font-medium">
                    {Math.min(preview.sendable, preview.limit)} client{preview.sendable === 1 ? "" : "s"} will get the survey.
                  </span>
                  {preview.noEmail > 0 && (
                    <span className="block text-2xs text-muted-foreground">
                      {preview.noEmail} have no email on file{preview.noEmailSample.length ? ` (${preview.noEmailSample.slice(0, 3).join(", ")}…)` : ""}.
                    </span>
                  )}
                  {(preview.alreadySurveyed ?? 0) > 0 && (
                    <span className="block text-2xs text-muted-foreground">
                      {preview.alreadySurveyed} already got it this month and are skipped.
                    </span>
                  )}
                  {preview.capped && (
                    <span className="block text-2xs text-muted-foreground">
                      The first {preview.limit} go now; send again for the rest.
                    </span>
                  )}
                </div>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            {result ? (
              result.remaining > 0 ? (
                <>
                  <button type="button" onClick={() => setOpen(false)} className={buttonClass("secondary")}>
                    Close
                  </button>
                  <button type="button" onClick={() => call(false)} disabled={!!busy} className={buttonClass("primary")}>
                    {busy === "send" && <Loader2 className="size-4 animate-spin" />}
                    Send the next batch
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setOpen(false)} className={buttonClass("primary")}>
                  Done
                </button>
              )
            ) : (
              <>
                <button type="button" onClick={() => setOpen(false)} className={buttonClass("secondary")}>
                  Cancel
                </button>
                {preview ? (
                  <button
                    type="button"
                    onClick={() => call(false)}
                    disabled={!!busy || preview.sendable === 0}
                    className={buttonClass("primary")}
                  >
                    {busy === "send" && <Loader2 className="size-4 animate-spin" />}
                    Send to {Math.min(preview.sendable, preview.limit)}
                  </button>
                ) : (
                  <button type="button" onClick={() => call(true)} disabled={!ready || !!busy} className={buttonClass("primary")}>
                    {busy === "preview" && <Loader2 className="size-4 animate-spin" />}
                    Review recipients
                  </button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
