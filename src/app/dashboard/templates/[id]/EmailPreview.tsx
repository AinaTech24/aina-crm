"use client";

/**
 * Rendered email preview for the template detail page.
 *
 * The page used to list the raw blocks ("LOGO —", "HEADING …"), which shows the
 * structure but not the mail: you could not see the firm's logo, the sign-off,
 * the theme colours or the compliance footer. This renders the real HTML
 * through /api/email-designer/preview — the same renderer the send path uses —
 * with the firm's branding and the viewer's own signature.
 *
 * The HTML is dropped into a sandboxed iframe (`srcdoc`, no allow-scripts):
 * email HTML is a full document with its own <style>, so injecting it into the
 * page would let it restyle the dashboard around it. The sandbox also means a
 * template body can never run script in the app's origin.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Monitor, Smartphone, RefreshCw, AlertCircle, Code2, Eye, Send, Check } from "lucide-react";

type Props = {
  /** The version body to render (email designer JSON). */
  body: unknown;
  /** Raw-block view, rendered by the server component, shown on the other tab. */
  blocksView: React.ReactNode;
  /** Pre-fills the test-send box; usually the signed-in user's address. */
  defaultTestEmail?: string;
};

const WIDTHS = { desktop: 720, mobile: 390 } as const;
type Device = keyof typeof WIDTHS;

export function EmailPreview({ body, blocksView, defaultTestEmail = "" }: Props) {
  const [tab, setTab] = useState<"preview" | "blocks">("preview");
  const [device, setDevice] = useState<Device>("desktop");
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [height, setHeight] = useState(900);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // Test send — mails this exact render to any address, from the firm's own
  // connected mailbox, using sample client data. Never touches a real client.
  const [showSend, setShowSend] = useState(false);
  const [to, setTo] = useState(defaultTestEmail);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);

  async function sendTest() {
    const address = to.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      setSendErr("Enter a valid email address.");
      return;
    }
    setSending(true);
    setSendErr(null);
    setSent(null);
    try {
      const res = await fetch("/api/email-designer/test-send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, to: address }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? `Send failed (${res.status})`);
      setSent(j.sentTo ?? address);
    } catch (e) {
      setSendErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/email-designer/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? `Preview failed (${res.status})`);
      setHtml(j.html ?? "");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [body]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Size the frame to its content so the mail isn't trapped in a small box. */
  const fit = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.body) return;
    const h = Math.max(doc.body.scrollHeight, doc.documentElement?.scrollHeight ?? 0);
    if (h > 0) setHeight(Math.min(Math.max(h + 24, 320), 4000));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="inline-flex rounded-lg border bg-background p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setTab("preview")}
            className={`px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 font-medium transition ${
              tab === "preview" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            }`}
          >
            <Eye className="size-3.5" /> Preview
          </button>
          <button
            type="button"
            onClick={() => setTab("blocks")}
            className={`px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 font-medium transition ${
              tab === "blocks" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            }`}
          >
            <Code2 className="size-3.5" /> Content blocks
          </button>
        </div>

        {tab === "preview" && (
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border bg-background p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setDevice("desktop")}
                aria-pressed={device === "desktop"}
                className={`px-2.5 py-1.5 rounded-md inline-flex items-center gap-1.5 transition ${
                  device === "desktop" ? "bg-secondary" : "text-muted-foreground hover:bg-accent"
                }`}
              >
                <Monitor className="size-3.5" /> Desktop
              </button>
              <button
                type="button"
                onClick={() => setDevice("mobile")}
                aria-pressed={device === "mobile"}
                className={`px-2.5 py-1.5 rounded-md inline-flex items-center gap-1.5 transition ${
                  device === "mobile" ? "bg-secondary" : "text-muted-foreground hover:bg-accent"
                }`}
              >
                <Smartphone className="size-3.5" /> Mobile
              </button>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={busy}
              className="text-xs px-2.5 py-1.5 rounded-lg border hover:bg-accent disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Refresh
            </button>
            <button
              type="button"
              onClick={() => setShowSend((v) => !v)}
              aria-expanded={showSend}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 inline-flex items-center gap-1.5"
            >
              <Send className="size-3.5" /> Send me a test
            </button>
          </div>
        )}
      </div>

      {tab === "blocks" ? (
        blocksView
      ) : (
        <>
          {err && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 flex items-start gap-2">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">Could not render the preview</div>
                <div className="text-xs mt-0.5">{err}</div>
              </div>
            </div>
          )}

          {showSend && (
            <div className="rounded-lg border bg-card p-3 mb-3">
              <div className="flex items-end gap-2 flex-wrap">
                <label className="flex-1 min-w-[220px]">
                  <span className="text-2xs font-medium text-muted-foreground">Send this email to</span>
                  <input
                    type="email"
                    value={to}
                    onChange={(e) => {
                      setTo(e.target.value);
                      setSendErr(null);
                      setSent(null);
                    }}
                    placeholder="name@example.com"
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-background"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void sendTest()}
                  disabled={sending}
                  className="h-[38px] text-sm px-3 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  {sending ? "Sending…" : "Send test"}
                </button>
              </div>
              {sent && (
                <p className="text-xs text-emerald-600 mt-2 inline-flex items-center gap-1">
                  <Check className="size-3.5" /> Sent to {sent}. It arrives with a [TEST] subject.
                </p>
              )}
              {sendErr && <p className="text-xs text-rose-600 mt-2">{sendErr}</p>}
              <p className="text-2xs text-muted-foreground mt-2">
                Goes out from your firm's connected mailbox with sample client data. No client is contacted and
                nothing is recorded against a client record.
              </p>
            </div>
          )}

          {!err && busy && !html && (
            <div className="h-64 grid place-items-center text-sm text-muted-foreground gap-2">
              <Loader2 className="size-5 animate-spin" />
              Rendering your email…
            </div>
          )}

          {!err && html !== null && (
            <div className="rounded-lg border bg-secondary p-3 sm:p-4 overflow-x-auto">
              <div className="mx-auto transition-all" style={{ width: WIDTHS[device], maxWidth: "100%" }}>
                <iframe
                  ref={frameRef}
                  title="Email preview"
                  srcDoc={html}
                  onLoad={fit}
                  // No allow-scripts: the body is template HTML, not app code.
                  sandbox=""
                  className="w-full rounded-md bg-white shadow-sm"
                  style={{ height, border: "0" }}
                />
              </div>
            </div>
          )}

          <p className="text-2xs text-muted-foreground mt-2">
            Merge fields show sample client data. Your firm logo, colours and footer are real, and the sign-off
            uses your own signature — upload one under Settings → Profile if it is missing.
          </p>
        </>
      )}
    </div>
  );
}
