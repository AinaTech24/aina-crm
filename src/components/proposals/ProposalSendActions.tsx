"use client";

/**
 * Two-button strip on the Proposal detail page:
 *   - Send via Email     → POST /api/proposals/[id]/send {channel:'email'}
 *   - Send via WhatsApp  → POST /api/proposals/[id]/send {channel:'whatsapp'}
 *                          opens the returned wa.me link in a new tab so the
 *                          RM ships it from their own WhatsApp.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageCircle, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

export function ProposalSendActions({
  id,
  hasEmail,
  hasPhone,
  status,
}: {
  id: string;
  hasEmail: boolean;
  hasPhone: boolean;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"email" | "whatsapp" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const locked = status === "accepted" || status === "rejected";

  async function send(channel: "email" | "whatsapp") {
    setBusy(channel);
    setErr(null);
    setOk(null);
    try {
      const res = await fetch(`/api/proposals/${id}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Send failed (${res.status})`);
        return;
      }
      if (channel === "whatsapp" && j.waUrl) {
        window.open(j.waUrl, "_blank", "noopener,noreferrer");
        setOk("WhatsApp opened in a new tab — review and tap Send.");
      } else if (channel === "email") {
        setOk(
          j.externalId?.startsWith("dev_")
            ? "Email logged in dev mode (RESEND_API_KEY not set)."
            : `Email queued · id ${j.externalId ?? "—"}`
        );
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => send("email")}
          disabled={!!busy || locked || !hasEmail}
          className="btn-secondary text-xs"
          title={!hasEmail ? "No email on file" : "Send proposal by email"}
        >
          {busy === "email" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Mail className="size-3.5" />
          )}
          Send via Email
        </button>
        <button
          onClick={() => send("whatsapp")}
          disabled={!!busy || locked || !hasPhone}
          className="btn-accent text-xs"
          style={{
            backgroundImage:
              "linear-gradient(135deg, hsl(142 70% 40%) 0%, hsl(142 70% 30%) 100%)",
          }}
          title={!hasPhone ? "No phone on file" : "Send proposal via WhatsApp"}
        >
          {busy === "whatsapp" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <MessageCircle className="size-3.5" />
          )}
          Send via WhatsApp
        </button>
      </div>
      {err && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 text-destructive text-xs px-2.5 py-1.5 flex items-center gap-1.5">
          <AlertCircle className="size-3.5 flex-shrink-0" /> {err}
        </div>
      )}
      {ok && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs px-2.5 py-1.5 flex items-center gap-1.5">
          <CheckCircle2 className="size-3.5 flex-shrink-0" /> {ok}
        </div>
      )}
    </div>
  );
}
