"use client";

/**
 * "Send risk profile link" — the third sign-off route, alongside the two the
 * wizard already offers (RM enters answers + client OTP, or RM uploads a
 * signed paper form). This one lets the CLIENT fill the questionnaire
 * themselves via a login-free link (/r/<token>), confirmed on their own by
 * email OTP.
 *
 * Mints the link on click, then shows all THREE ways to get it to the client
 * side-by-side — WhatsApp, Email, Copy link — rather than picking one
 * automatically, so the RM always sees every option regardless of what
 * contact info happens to be on file.
 *
 * The popover is PORTALLED to <body> and positioned from the trigger's viewport
 * rect. Rendered inline it would be clipped wherever an ancestor scrolls — the
 * risk-profiles table wraps rows in `.table-scroll` (overflow: auto), which cuts
 * off an absolutely-positioned child. Portalling keeps one component usable both
 * in a table row and on the client detail page.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link2, MessageCircle, Mail, Copy, Check, Loader2 } from "lucide-react";

type LinkInfo = { url: string; investorName: string; phone: string | null; email: string | null };

/** Keep digits only; assume a bare 10-digit number is Indian (+91) for wa.me. */
function waNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

/**
 * The two client-facing links an RM sends ad-hoc. Same mechanics (mint a share
 * token, then offer WhatsApp / Email / Copy), different endpoint and wording —
 * so they share one component rather than two near-identical copies.
 */
export type SendLinkKind = "risk_profile" | "feedback";

const KIND_CONFIG: Record<
  SendLinkKind,
  {
    endpoint: (id: string) => string;
    trigger: string;
    title: string;
    blurb: string;
    emailSubject: string;
    message: (url: string, name: string) => string;
    expiry: string;
  }
> = {
  risk_profile: {
    endpoint: (id) => `/api/investors/${id}/risk-profile-link`,
    trigger: "Send link to client",
    title: "Send risk profile link",
    blurb:
      "The client fills the questionnaire themselves - no login needed. They confirm it with their own email OTP.",
    emailSubject: "Your risk profile assessment",
    message: (url, name) =>
      `Hi ${name},\n\nPlease complete your risk profile assessment using the secure link below - it only takes a couple of minutes and needs no login:\n${url}`,
    expiry: "Link expires in 14 days, single client.",
  },
  feedback: {
    endpoint: (id) => `/api/investors/${id}/feedback-link`,
    trigger: "Ask for feedback",
    title: "Send feedback link",
    blurb:
      "The client rates you 0-10 with an optional comment - no login needed. The response files itself as a feedback ticket.",
    emailSubject: "How are we doing?",
    message: (url, name) =>
      `Hi ${name},\n\nWe would value your feedback. It is one question and takes about a minute - no login needed:\n${url}`,
    expiry: "Link expires in 30 days, single use.",
  },
};

export function SendRiskProfileLinkButton({
  investorId,
  kind = "risk_profile",
}: {
  investorId: string;
  kind?: SendLinkKind;
}) {
  const cfg = KIND_CONFIG[kind];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  /** Anchor the fixed-position panel under the trigger, flipped to stay on screen. */
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      const t = triggerRef.current?.getBoundingClientRect();
      if (!t) return;
      const W = 320;
      // Right-align to the trigger, but never past the viewport edge.
      let left = Math.min(t.right - W, window.innerWidth - W - 8);
      left = Math.max(8, left);
      // Flip above when there isn't room below.
      const belowRoom = window.innerHeight - t.bottom;
      const top = belowRoom < 280 && t.top > 280 ? t.top - 8 - 280 : t.bottom + 8;
      setPos({ top, left });
    };
    place();
    // A scroll or resize moves the trigger — follow it rather than detach.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const n = e.target as Node;
      if (panelRef.current?.contains(n) || triggerRef.current?.contains(n)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (info) return; // already minted this session — reuse it
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(cfg.endpoint(investorId), { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Could not create the link (${res.status})`);
      setInfo({ url: data.url, investorName: data.investorName, phone: data.phone, email: data.email });
    } catch (e: any) {
      setErr(e?.message ?? "Could not create the link");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard permission denied — the link is still visible to select manually */
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          // The risk-profiles table renders this inside a clickable row; the row
          // already ignores <button> clicks, but stop anyway so nothing upstream
          // navigates out from under an open panel.
          e.stopPropagation();
          void toggle();
        }}
        className="text-xs font-semibold text-brand-cyan hover:underline inline-flex items-center gap-1"
      >
        <Link2 className="size-3.5" /> {cfg.trigger}
      </button>

      {mounted && open && pos && createPortal(
        <div
          ref={panelRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: 320 }}
          className="z-[70] card-elevated bg-card p-3 space-y-2.5">
          <div className="text-xs font-semibold text-foreground">{cfg.title}</div>
          <p className="text-[11px] text-muted-foreground leading-snug">{cfg.blurb}</p>

          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="size-3.5 animate-spin" /> Generating link…
            </div>
          )}
          {err && <div className="text-xs text-rose-600">{err}</div>}

          {info && !busy && (
            <>
              <div className="text-[11px] font-mono bg-secondary/50 rounded px-2 py-1.5 truncate" title={info.url}>
                {info.url}
              </div>

              {/* All three send channels, always shown — greyed out (not hidden)
                  when the relevant contact detail isn't on file, so the RM sees
                  every option rather than a silently-narrowed set. */}
              <div className="flex flex-col gap-1.5">
                <a
                  href={info.phone ? `https://wa.me/${waNumber(info.phone)}?text=${encodeURIComponent(cfg.message(info.url, info.investorName))}` : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={!info.phone}
                  onClick={(e) => {
                    if (!info.phone) e.preventDefault();
                  }}
                  className={`inline-flex items-center gap-2 text-xs rounded-md border px-2.5 py-1.5 transition ${
                    info.phone ? "hover:bg-accent border-border" : "opacity-40 cursor-not-allowed border-border"
                  }`}
                  title={info.phone ? undefined : "No phone number on file"}
                >
                  <MessageCircle className="size-3.5 text-emerald-600" /> WhatsApp
                </a>
                <a
                  href={
                    info.email
                      ? `mailto:${info.email}?subject=${encodeURIComponent(cfg.emailSubject)}&body=${encodeURIComponent(cfg.message(info.url, info.investorName))}`
                      : undefined
                  }
                  aria-disabled={!info.email}
                  onClick={(e) => {
                    if (!info.email) e.preventDefault();
                  }}
                  className={`inline-flex items-center gap-2 text-xs rounded-md border px-2.5 py-1.5 transition ${
                    info.email ? "hover:bg-accent border-border" : "opacity-40 cursor-not-allowed border-border"
                  }`}
                  title={info.email ? undefined : "No email on file"}
                >
                  <Mail className="size-3.5 text-blue-600" /> Email
                </a>
                <button
                  type="button"
                  onClick={copyLink}
                  className="inline-flex items-center gap-2 text-xs rounded-md border border-border px-2.5 py-1.5 hover:bg-accent transition"
                >
                  {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy link"}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground">{cfg.expiry}</p>
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
