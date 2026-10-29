"use client";

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";

/**
 * "Email the client about THIS record" — a rejected SIP (SIP Rejections) or a
 * switch / STP / SWP (Transactions). Asks once, showing what will be sent, then
 * posts to /api/investors/[id]/record-email, which fills the email from the
 * record itself and sends it through the usual consent and compliance checks.
 * A refusal comes back as a sentence and is shown as is.
 */
export function EmailRecordButton({
  investorId,
  kind,
  recordId,
  clientName,
  summary,
  label = "Email",
  className = "",
}: {
  investorId: string;
  kind: "sip_rejection" | "transaction";
  recordId: string;
  clientName: string | null;
  /** One line naming the record, shown in the confirmation — "HDFC Flexi Cap · ₹5,000". */
  summary: string;
  label?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const who = clientName?.trim() || "this client";
  const about = kind === "sip_rejection" ? "the SIP that was not processed" : "this switch / STP / SWP";

  async function send() {
    const ok = await confirmDialog({
      title: `Email ${who}?`,
      message: `Sends an email about ${about}: ${summary}. It goes through the consent and compliance checks.`,
      confirmLabel: "Send email",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/investors/${investorId}/record-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, recordId }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; email?: string };
      if (!res.ok) {
        notify.error(j.error ?? `Could not send (${res.status}).`);
        return;
      }
      notify.success(`Email sent to ${j.email ?? who}.`);
    } catch {
      notify.error("Network error — the email was not sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={send}
      disabled={busy}
      title={`Email ${who} about ${about}`}
      aria-label={`Email ${who} about ${about}`}
      className={`inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-semibold hover:bg-secondary disabled:opacity-60 ${className}`}
    >
      {busy ? <Loader2 className="size-3 animate-spin" /> : <Mail className="size-3" />}
      {label}
    </button>
  );
}
