"use client";

/**
 * "Download client master" — a row in the client's More menu. Opens a popup that says what
 * is always in the PDF and asks which optional sections to add (Meetings, Service
 * requests, Tasks, Emails, Gifts), with the record count of each, then downloads the PDF
 * from GET /api/investors/[id]/client-master/pdf. A section the person's role cannot see is
 * shown greyed with the reason and is never sent.
 */

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { buttonClass } from "@/components/ui/button-class";
import { notify } from "@/components/ui/Toast";

type OptionalKey = "meetings" | "serviceRequests" | "tasks" | "emails" | "gifts";

const SECTIONS: Array<{ key: OptionalKey; label: string; hint: (n: number) => string }> = [
  { key: "meetings", label: "Meetings", hint: (n) => `${n} meeting${n === 1 ? "" : "s"} with date, type, RM, status and notes` },
  { key: "serviceRequests", label: "Service requests", hint: (n) => `${n} request${n === 1 ? "" : "s"} with service ID, status and handler` },
  { key: "tasks", label: "Tasks", hint: (n) => `${n} task${n === 1 ? "" : "s"} with due date, assignee and status` },
  { key: "emails", label: "Emails", hint: (n) => `${n} email${n === 1 ? "" : "s"} with delivery status` },
  { key: "gifts", label: "Gifts", hint: (n) => `${n} gift${n === 1 ? "" : "s"} with occasion and value` },
];

type Summary = { counts: Record<OptionalKey, number>; available: Record<OptionalKey, boolean>; name: string };

export function ClientMasterDownload({ investorId, name, triggerClassName }: { investorId: string; name: string; triggerClassName?: string }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<OptionalKey>>(new Set());
  const [busy, setBusy] = useState(false);

  async function openDialog() {
    setOpen(true);
    setLoadErr(null);
    setPicked(new Set());
    setSummary(null);
    try {
      const res = await fetch(`/api/investors/${investorId}/client-master/summary`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setLoadErr(j.error ?? `Failed (${res.status})`); return; }
      setSummary(j as Summary);
    } catch {
      setLoadErr("Network error. Try again.");
    }
  }

  const choosable = SECTIONS.filter((s) => summary?.available[s.key]);
  const allPicked = choosable.length > 0 && choosable.every((s) => picked.has(s.key));
  const toggle = (k: OptionalKey) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  async function download() {
    setBusy(true);
    try {
      const include = [...picked].join(",");
      const res = await fetch(`/api/investors/${investorId}/client-master/pdf?download=1${include ? `&include=${include}` : ""}`, { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        notify.error(j.error ?? `Couldn't create the PDF (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const file = /filename="([^"]+)"/.exec(cd)?.[1] ?? "Client_master.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setOpen(false);
      notify.success("Client master downloaded.");
    } catch {
      notify.error("Network error while creating the PDF.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={openDialog} className={triggerClassName ?? buttonClass("secondary", "md")} title="Download the whole client master as a PDF">
        <FileDown className={triggerClassName ? "size-4 shrink-0 text-muted-foreground" : "size-4"} aria-hidden /> Download client master
      </button>
      <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Download client master</DialogTitle>
            <DialogDescription>A PDF of everything the CRM holds on {name}.</DialogDescription>
          </DialogHeader>

          <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Always included</div>
          <div className="mt-1.5 rounded-lg border border-border bg-secondary/40 p-3 text-sm">
            <div className="font-medium">Client Master · Portfolio · Fixed deposits · Cross-sell holdings · Review details · Notes</div>
            <div className="mt-0.5 text-xs text-muted-foreground">KYC &amp; profile, bank, nominees, referrals and the risk profile are on the Client Master pages. Notes are on the last page.</div>
          </div>

          <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Also include?</div>
          {loadErr && <p className="mt-2 text-sm text-destructive">{loadErr}</p>}
          {!summary && !loadErr && (
            <p className="mt-2 inline-flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Counting records…</p>
          )}
          {summary && (
            <ul className="mt-1.5 space-y-1.5">
              {SECTIONS.map((s) => {
                const ok = summary.available[s.key];
                const on = picked.has(s.key);
                return (
                  <li key={s.key}>
                    <label className={`flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${ok ? "cursor-pointer" : "cursor-not-allowed opacity-60"} ${on ? "border-primary bg-primary/5" : "border-border"}`}>
                      <input type="checkbox" className="mt-1" checked={on} disabled={!ok || busy} onChange={() => toggle(s.key)} />
                      <span>
                        {s.label}
                        <span className="block text-xs text-muted-foreground">{ok ? s.hint(summary.counts[s.key]) : "Not available for your role"}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          <DialogFooter className="sm:justify-between">
            <button
              type="button"
              disabled={!summary || busy || choosable.length === 0}
              onClick={() => setPicked(allPicked ? new Set() : new Set(choosable.map((s) => s.key)))}
              className="self-center text-xs text-primary hover:underline disabled:opacity-50"
            >
              {allPicked ? "Clear all" : "Select all"}
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={busy} className={buttonClass("secondary")}>Cancel</button>
              <button type="button" onClick={download} disabled={busy || !summary} className={buttonClass("primary")}>
                {busy && <Loader2 className="size-4 animate-spin" />} Download PDF
              </button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
