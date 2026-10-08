"use client";

/**
 * "I have read this" on the operations manual. Records the reader's own
 * acknowledgement of the SOP's CURRENT version through the existing
 * POST /api/sops/:id/acknowledge (idempotent per version and user).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { notify } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";

export function ManualAckButton({ sopId, acknowledgedAt }: { sopId: string; acknowledgedAt: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (acknowledgedAt) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <Check className="size-3.5" aria-hidden /> Read on {formatDate(acknowledgedAt)}
      </span>
    );
  }

  async function ack() {
    setBusy(true);
    try {
      const res = await fetch(`/api/sops/${encodeURIComponent(sopId)}/acknowledge`, { method: "POST" });
      if (!res.ok) {
        notify.error("Could not record that you read it.");
        return;
      }
      router.refresh();
    } catch {
      notify.error("Could not record that you read it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="secondary" onClick={ack} loading={busy} disabled={busy}>
      I have read this
    </Button>
  );
}
