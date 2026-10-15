"use client";
/**
 * "Confirm guardian" — the owner's or compliance's resolution of a minor whose
 * guardian could not be linked (POST /api/investors/[id]/guardian-verification,
 * audited as investor.guardian_verified). Shown only to someone allowed to.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { promptDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";

export function ConfirmGuardianButton({ investorId }: { investorId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function confirm() {
    const note = await promptDialog({
      title: "Confirm this minor's guardian",
      message: "Use this when the guardian is not a client of the firm, or their record could not be linked. Say what you checked — the documents seen and who confirmed. It is kept in the client's history.",
      label: "What was checked",
      multiline: true,
      maxLength: 1000,
      confirmLabel: "Confirm guardian",
    });
    if (note == null) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/investors/${investorId}/guardian-verification`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) notify.error(j.error ?? "Could not confirm the guardian");
      else { notify.success("Guardian confirmed"); router.refresh(); }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="secondary" size="sm" onClick={confirm} disabled={busy} className="mt-1">
      {busy ? "Confirming…" : "Confirm guardian"}
    </Button>
  );
}
