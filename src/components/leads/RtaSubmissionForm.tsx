"use client";

/**
 * "Submitted to RTA" — the physical route's submission: where the signed forms
 * went (CAMS / KFintech / an AMC), the acknowledgement no. and the date.
 * POST /api/leads/[id]/rta-submission; returns to the page the user came from.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormActions } from "@/components/ui/FormActions";
import { DateField } from "@/components/ui/DateField";
import { AmcSelect } from "@/components/mf/AmcSelect";
import { notify } from "@/components/ui/Toast";

type Prev = { rta?: string; amcName?: string; centre?: string } | null;

const INCLUDES: Array<{ value: "lumpsum" | "sip" | "nach" | "cheque"; label: string }> = [
  { value: "lumpsum", label: "Lumpsum application" },
  { value: "sip", label: "SIP registration form" },
  { value: "nach", label: "NACH / OTM mandate" },
  { value: "cheque", label: "Cheque" },
];

export function RtaSubmissionForm({ leadId, backHref, prev, resubmit }: { leadId: string; backHref: string; prev: Prev; resubmit: boolean }) {
  const router = useRouter();
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const [rta, setRta] = useState<string>(prev?.rta ?? "CAMS");
  const [amcName, setAmcName] = useState<string>(prev?.amcName ?? "");
  const [centre, setCentre] = useState<string>(prev?.centre ?? "");
  const [ackNo, setAckNo] = useState("");
  const [submittedOn, setSubmittedOn] = useState(today);
  const [includes, setIncludes] = useState<string[]>([]);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!ackNo.trim()) { setError("Enter the acknowledgement / inward no."); return; }
    if (rta === "AMC" && !amcName) { setError("Pick the AMC the forms went to."); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/rta-submission`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rta,
          ...(rta === "AMC" ? { amcName } : {}),
          ...(centre.trim() ? { centre: centre.trim() } : {}),
          ackNo: ackNo.trim(),
          submittedOn,
          includes,
          ...(amount && Number(amount) > 0 ? { amount: Number(amount) } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Couldn't save the submission."); return; }
      notify.success("Submitted to RTA — the RTA feed will confirm it");
      router.push(backHref);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Submitted to <span className="text-rose-500">*</span></span>
            <select value={rta} onChange={(e) => setRta(e.target.value)} className="input-base w-full text-sm">
              <option value="CAMS">CAMS</option>
              <option value="KFintech">KFintech</option>
              <option value="AMC">An AMC branch directly</option>
            </select>
          </label>
          {rta === "AMC" && (
            <div className="text-sm">
              <span className="mb-1 block font-medium">AMC <span className="text-rose-500">*</span></span>
              <AmcSelect value={amcName} onChange={setAmcName} aria-label="AMC" />
            </div>
          )}
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Service centre / branch</span>
            <input value={centre} onChange={(e) => setCentre(e.target.value)} maxLength={200} placeholder="e.g. CAMS Surat" className="input-base w-full text-sm" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Acknowledgement / inward no. <span className="text-rose-500">*</span></span>
            <input value={ackNo} onChange={(e) => setAckNo(e.target.value)} maxLength={100} className="input-base w-full text-sm" />
          </label>
          <div className="text-sm">
            <span className="mb-1 block font-medium">Submitted on <span className="text-rose-500">*</span></span>
            <DateField value={submittedOn} max={today} onChange={(e) => setSubmittedOn(e.target.value)} />
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Amount (₹)</span>
            <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="input-base w-full text-sm" />
          </label>
        </div>

        <fieldset className="space-y-2 text-sm">
          <legend className="mb-1 font-medium">What went in</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {INCLUDES.map((o) => (
              <label key={o.value} className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includes.includes(o.value)}
                  onChange={() => setIncludes((s) => (s.includes(o.value) ? s.filter((x) => x !== o.value) : [...s, o.value]))}
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">Notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} className="input-base w-full text-sm" />
        </label>
      </Card>

      <FormActions status={error ? <span className="text-sm text-destructive">{error}</span> : undefined}>
        <Button variant="secondary" onClick={() => router.push(backHref)} disabled={busy}>Cancel</Button>
        <Button
          variant="primary"
          onClick={save}
          disabled={busy}
          icon={busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
        >
          {resubmit ? "Save & mark Resubmitted" : "Save & mark Submitted to RTA"}
        </Button>
      </FormActions>
    </div>
  );
}
