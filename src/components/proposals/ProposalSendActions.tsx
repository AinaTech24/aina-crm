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
 *
 * The send route refuses a proposal with no suitability note — the written
 * reason it suits the client, which the PDF and the audit trail carry. The
 * note's box sits further down the page, so a refused send used to end at a
 * toast telling the RM to "capture" a note they could not see. Now the button
 * asks for it, saves it on the proposal and finishes the send.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageCircle, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { promptDialog } from "@/components/ui/ConfirmProvider";

export function ProposalSendActions({
  id,
  hasEmail,
  hasPhone,
  status,
  primary = true,
  suggestedNote = "",
}: {
  id: string;
  hasEmail: boolean;
  hasPhone: boolean;
  status: string;
  primary?: boolean;
  /** The note drafted from this proposal; offered pre-filled when a send needs one. */
  suggestedNote?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<"email" | "whatsapp" | null>(null);

  const locked = status === "accepted" || status === "rejected";

  /** Ask for the suitability note and save it on the proposal. False when the RM cancelled or it failed. */
  async function captureNote(): Promise<boolean> {
    const note = await promptDialog({
      title: "Suitability note",
      message: suggestedNote ? "Drafted from this proposal. Read it, add anything specific to this client, then send." : undefined,
      label: "Why does this proposal suit the client?",
      defaultValue: suggestedNote || undefined,
      placeholder: "e.g. Long-term wealth creation; the funds sit within the client's risk profile and 10-year horizon.",
      multiline: true,
      maxLength: 2000,
      confirmLabel: "Save and send",
    });
    if (!note?.trim()) return false;
    const res = await fetch(`/api/proposals/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ suitabilityNote: note.trim() }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? `Save failed (${res.status})`, "Couldn't save the suitability note");
      return false;
    }
    return true;
  }

  async function send(channel: "email" | "whatsapp") {
    setBusy(channel);
    try {
      const post = () =>
        fetch(`/api/proposals/${id}/send`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ channel }),
        });
      let res = await post();
      let j = await res.json().catch(() => ({}));
      if (res.status === 412 && j.field === "suitabilityNote") {
        if (!(await captureNote())) return;
        res = await post();
        j = await res.json().catch(() => ({}));
      }
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
