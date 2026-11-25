"use client";

/**
 * "Client report" on the client page and "Family report" on the family page
 * (flag `clientReportPdf`): one PDF with everything the CRM holds about the
 * client, or about every member of the family. Two presets — the complete
 * record for the team, and a copy to share without the internal sections
 * (activity log, tasks, opportunities, messages, documents, record gaps) —
 * and every section can be ticked on or off.
 */

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { buttonClass } from "@/components/ui/button-class";
import { downloadFile, DownloadError } from "@/lib/secure-download";
import { notify } from "@/components/ui/Toast";
import {
  ALL_CLIENT_REPORT_SECTIONS,
  CLIENT_COPY_SECTIONS,
  CLIENT_REPORT_SECTIONS,
  FAMILY_REPORT_SECTIONS,
  type ClientReportSection,
} from "@/lib/investors/client-report-sections";

type Copy = "complete" | "client";

export function ClientReportButton({
  investorId,
  familyId,
  clientName,
}: {
  /** One client's report… */
  investorId?: string;
  /** …or the whole family's. */
  familyId?: string;
  clientName: string;
}) {
  const family = !!familyId;
  const base = family ? FAMILY_REPORT_SECTIONS : ALL_CLIENT_REPORT_SECTIONS;
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<Copy>("complete");
  const [picked, setPicked] = useState<Set<ClientReportSection>>(new Set(base));
  const [busy, setBusy] = useState(false);

  const choose = (c: Copy) => {
    setCopy(c);
    setPicked(new Set(c === "client" ? base.filter((k) => CLIENT_COPY_SECTIONS.includes(k)) : base));
  };
  const toggle = (k: ClientReportSection) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const visible = CLIENT_REPORT_SECTIONS.filter((s) => base.includes(s.key) && (copy === "complete" || s.client));
  const noun = family ? "Family" : "Client";

  async function download() {
    const keys = base.filter((k) => picked.has(k));
    if (!keys.length) return;
    setBusy(true);
    try {
      const qs = new URLSearchParams({ sections: keys.join(",") });
      if (copy === "client") qs.set("copy", "client");
      const url = family ? `/api/families/${familyId}/report?${qs}` : `/api/investors/${investorId}/client-report?${qs}`;
      await downloadFile(url, `${noun}_Report_${clientName.replace(/[^a-z0-9]+/gi, "_")}.pdf`);
      setOpen(false);
    } catch (e) {
      notify.error(e instanceof DownloadError ? e.message : "Could not prepare the report. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={buttonClass("secondary")} onClick={() => setOpen(true)}>
        <FileDown className="size-4" /> {noun} report
      </button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{noun} report (PDF)</DialogTitle>
            <DialogDescription>{clientName}</DialogDescription>
          </DialogHeader>

          <div className="mt-3 dash-seg w-full" role="group" aria-label="Report type">
            {(["complete", "client"] as const).map((c) => (
              <button key={c} type="button" aria-pressed={copy === c} onClick={() => choose(c)} className="flex-1">
                {c === "complete" ? "Complete record" : family ? "Family copy" : "Client copy"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {copy === "complete"
              ? family
                ? "Every member's record, for the team."
                : "Everything on the client's record, for the team."
              : family
                ? "To share with the family: no internal notes, tasks or activity."
                : "To share with the client: no internal notes, tasks or activity."}
          </p>

          <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            {visible.map((s) => (
              <label key={s.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={picked.has(s.key)} onChange={() => toggle(s.key)} />
                {s.label}
              </label>
            ))}
          </div>

          <DialogFooter>
            <button type="button" className={buttonClass("ghost")} onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={buttonClass("primary")} onClick={download} disabled={busy || !visible.some((s) => picked.has(s.key))}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
              {busy ? "Preparing…" : "Download PDF"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
