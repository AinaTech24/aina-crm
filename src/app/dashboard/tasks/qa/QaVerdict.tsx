"use client";

/** Pass / Fail for one QA check. A fail needs a reason; the note is optional. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { notify } from "@/components/ui/Toast";

export function QaVerdict({ reviewId, reasons }: { reviewId: string; reasons: string[] }) {
  const router = useRouter();
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(result: "pass" | "fail") {
    setBusy(true);
    try {
      const res = await fetch(`/api/qa/reviews/${reviewId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(result === "pass" ? { result } : { result, reason, note: note || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not save");
      notify.success(result === "pass" ? "Passed." : "Failed — a correction task went to them.");
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  if (!failing) {
    return (
      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" onClick={() => send("pass")} disabled={busy}><Check className="size-4" aria-hidden /> Pass</Button>
        <Button variant="ghost" onClick={() => setFailing(true)} disabled={busy}><X className="size-4" aria-hidden /> Fail</Button>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:items-center">
      <select className="input-base lg:w-auto" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}>
        <option value="">Reason…</option>
        {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <input className="input-base lg:w-56" aria-label="Note" placeholder="What to put right" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => send("fail")} disabled={busy || !reason} loading={busy}>Record fail</Button>
        <Button variant="ghost" onClick={() => setFailing(false)} disabled={busy}>Back</Button>
      </div>
    </div>
  );
}
