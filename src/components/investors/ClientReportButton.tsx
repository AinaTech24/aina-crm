"use client";

/**
 * "Client report" on the client page and "Family report" on the family page
 * (flag `clientReportPdf`): one PDF with everything the CRM holds about the
 * client, or about every member of the family. Two presets — the complete
 * record for the team, and a copy to share without the internal sections
 * (activity log, tasks, opportunities, messages, documents, record gaps) —
 * and every section can be ticked on or off.
 */

import { useEffect, useState } from "react";
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

type Facet = { key: string; label: string; n: number };
type Facets = { statuses: Facet[]; types: Facet[] };
/** "In force" = active, or a claim moved it off active (lib/insurance/book). */
const IN_FORCE = ["active", "claim_filed", "claim_settled"];

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
  // Which policies the Insurance section prints: the statuses and types this
  // client / family holds, all ticked until the user narrows them.
  const [facets, setFacets] = useState<Facets | null>(null);
  const [insStatus, setInsStatus] = useState<Set<string>>(new Set());
  const [insType, setInsType] = useState<Set<string>>(new Set());
  const reportUrl = family ? `/api/families/${familyId}/report` : `/api/investors/${investorId}/client-report`;

  useEffect(() => {
    if (!open || facets) return;
    let live = true;
    fetch(`${reportUrl}?facets=insurance`)
      .then((r) => (r.ok ? r.json() : null))
      .then((f: Facets | null) => {
        if (!live || !f || !Array.isArray(f.statuses) || !Array.isArray(f.types)) return;
        setFacets(f);
        setInsStatus(new Set(f.statuses.map((x) => x.key)));
        setInsType(new Set(f.types.map((x) => x.key)));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, facets, reportUrl]);

  const flip = (set: Set<string>, k: string) => {
    const n = new Set(set);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  };

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
  const insuranceOn = picked.has("insurance") && visible.some((s) => s.key === "insurance");
  const choosePolicies = insuranceOn && !!facets && facets.statuses.length + facets.types.length > 0;
  const policiesEmpty = choosePolicies && (insStatus.size === 0 || insType.size === 0);
  const noun = family ? "Family" : "Client";

  async function download() {
    const keys = base.filter((k) => picked.has(k));
    if (!keys.length) return;
    setBusy(true);
    try {
      const qs = new URLSearchParams({ sections: keys.join(",") });
      if (copy === "client") qs.set("copy", "client");
      // Only a narrowed choice is sent: all ticked = every policy, as before.
      if (choosePolicies && facets) {
        if (insStatus.size < facets.statuses.length) qs.set("insStatus", [...insStatus].join(","));
        if (insType.size < facets.types.length) qs.set("insType", [...insType].join(","));
      }
      const url = `${reportUrl}?${qs}`;
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

          {choosePolicies && facets && (
            <div className="mt-4 space-y-3 rounded-lg bg-secondary/60 p-3">
              <div className="text-sm font-medium">Which insurance policies?</div>
              <PolicyChoice
                title="Status"
                items={facets.statuses}
                chosen={insStatus}
                onToggle={(k) => setInsStatus((s) => flip(s, k))}
                onAll={(on) => setInsStatus(new Set(on ? facets.statuses.map((x) => x.key) : []))}
                extra={
                  facets.statuses.some((x) => IN_FORCE.includes(x.key)) && (
                    <button
                      type="button"
                      className="text-xs font-medium text-primary hover:underline"
                      onClick={() => setInsStatus(new Set(facets.statuses.filter((x) => IN_FORCE.includes(x.key)).map((x) => x.key)))}
                    >
                      In force only
                    </button>
                  )
                }
              />
              <PolicyChoice
                title="Type"
                items={facets.types}
                chosen={insType}
                onToggle={(k) => setInsType((s) => flip(s, k))}
                onAll={(on) => setInsType(new Set(on ? facets.types.map((x) => x.key) : []))}
              />
              {policiesEmpty && <p className="text-xs text-destructive">Tick at least one status and one type.</p>}
            </div>
          )}

          <DialogFooter>
            <button type="button" className={buttonClass("ghost")} onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={buttonClass("primary")} onClick={download} disabled={busy || policiesEmpty || !visible.some((s) => picked.has(s.key))}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
              {busy ? "Preparing…" : "Download PDF"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** One row of the policy choice: a tick per status (or type) with its count. */
function PolicyChoice({
  title,
  items,
  chosen,
  onToggle,
  onAll,
  extra,
}: {
  title: string;
  items: Facet[];
  chosen: Set<string>;
  onToggle: (key: string) => void;
  onAll: (on: boolean) => void;
  extra?: React.ReactNode;
}) {
  const all = items.every((x) => chosen.has(x.key));
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{title}</span>
        <button type="button" className="font-medium text-primary hover:underline" onClick={() => onAll(!all)}>
          {all ? "Clear all" : "Select all"}
        </button>
        {extra}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((x) => (
          <label
            key={x.key}
            className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
              chosen.has(x.key) ? "border-primary/40 bg-background" : "border-border bg-transparent text-muted-foreground"
            }`}
          >
            <input type="checkbox" checked={chosen.has(x.key)} onChange={() => onToggle(x.key)} />
            {x.label}
            <span className="text-muted-foreground">{x.n}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
