"use client";

/**
 * Two-button strip on the Proposal detail page:
 *   - Send via WhatsApp  → POST /api/proposals/[id]/send {channel:'whatsapp'}
 *                          opens the returned wa.me link in a new tab so the
 *                          RM ships it from their own WhatsApp.
 *   - Send via Email     → POST /api/proposals/[id]/send {channel:'email'}
 * `primary` (a draft): WhatsApp is the page's main action. Once the proposal
 * has gone, sending again is secondary to recording the client's answer.
 * Outcomes surface as toasts (no inline banners).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageCircle, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export function ProposalSendActions({
  id,
  hasEmail,
  hasPhone,
  status,
  primary = true,
}: {
  id: string;
  hasEmail: boolean;
  hasPhone: boolean;
  status: string;
  primary?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<"email" | "whatsapp" | null>(null);

  const locked = status === "accepted" || status === "rejected";

  async function send(channel: "email" | "whatsapp") {
    setBusy(channel);
    try {
      const res = await fetch(`/api/proposals/${id}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Send failed (${res.status})`, "Couldn't send proposal");
        return;
      }
      if (channel === "whatsapp" && j.waUrl) {
        window.open(j.waUrl, "_blank", "noopener,noreferrer");
        toast.success("WhatsApp opened in a new tab — review and tap Send.");
      } else if (channel === "email") {
        toast.success(
          j.externalId?.startsWith("dev_")
            ? "Email logged in dev mode (no mail provider configured)."
            : "Proposal emailed to the client with the PDF attached."
        );
      }
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Couldn't send proposal");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => send("whatsapp")}
        disabled={!!busy || locked || !hasPhone}
        className={`${primary ? "btn-accent" : "btn-secondary"} text-xs`}
        style={primary ? { backgroundImage: "linear-gradient(135deg, hsl(142 70% 40%) 0%, hsl(142 70% 30%) 100%)" } : undefined}
        title={!hasPhone ? "No mobile number on file" : "Send proposal via WhatsApp"}
      >
        {busy === "whatsapp" ? <Loader2 className="size-3.5 animate-spin" /> : <MessageCircle className="size-3.5" />}
        Send via WhatsApp
      </button>
      <button
        onClick={() => send("email")}
        disabled={!!busy || locked || !hasEmail}
        className="btn-secondary text-xs"
        title={!hasEmail ? "No email on file" : "Send proposal by email"}
      >
        {busy === "email" ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
        Send via Email
      </button>
    </div>
  );
}
