"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, X, Loader2, CheckCircle2, CalendarPlus, Copy, Check } from "lucide-react";
import { ScheduleMeetingForm } from "./ScheduleMeetingForm";
import { DownloadButton } from "@/components/common/SecureLinkButtons";
import { formatDate } from "@/lib/format";
import { meetingCalendarLinks } from "@/lib/review-meetings/calendar-links";
import Link from "next/link";

type Saved = {
  id?: string;
  day?: string;
  time?: string;
  subject?: string;
  name?: string;
  startIso?: string;
  durationMinutes?: number;
  location?: string;
};

/**
 * Schedule a meeting in a popup, without leaving the current page (e.g. from a
 * lead's blueprint "Schedule Meeting" action). Loads ONLY the preselected
 * subject (fast), pre-fills the subject line, and on save shows a confirmation
 * with an "Add to calendar" link and a copy-able invite — then refreshes the
 * host on Done.
 */
export function ScheduleMeetingModal({
  open,
  onClose,
  onSuccess,
  preselectedLeadId,
  preselectedInvestorId,
  preselectedCategory,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: (meetingId?: string) => void;
  preselectedLeadId?: string;
  preselectedInvestorId?: string;
  preselectedCategory?: string;
}) {
  const [data, setData] = useState<{ investors: any[]; leads: any[]; families: any[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [copied, setCopied] = useState(false);
  // Once the meeting is saved, closing by ✕ / Escape / the backdrop must do
  // what Done does — refresh the host — or its Activity list stays stale.
  const close = useCallback(() => {
    if (saved && onSuccess) onSuccess(saved.id);
    else onClose();
  }, [saved, onSuccess, onClose]);

  useEffect(() => {
    if (!open) { setData(null); setErr(null); setSaved(null); setCopied(false); return; }
    let alive = true;
    (async () => {
      try {
        const q = preselectedLeadId ? `?leadId=${preselectedLeadId}` : preselectedInvestorId ? `?investorId=${preselectedInvestorId}` : "";
        const res = await fetch(`/api/review-meetings/subjects${q}`);
        const j = await res.json();
        if (!alive) return;
        if (!res.ok) { setErr(j.error ?? "Could not load."); return; }
        setData({ investors: j.investors ?? [], leads: j.leads ?? [], families: j.families ?? [] });
      } catch {
        if (alive) setErr("Could not load.");
      }
    })();
    return () => { alive = false; };
  }, [open, preselectedLeadId, preselectedInvestorId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const subjectName = data?.leads?.[0]?.name ?? data?.investors?.[0]?.name ?? "";
  const defaultSubject = subjectName ? `Intro meeting — ${subjectName}` : "";
  const prettyDate = saved?.day ? formatDate(new Date(saved.day + "T00:00:00"), "weekday") : "";

  // Google / Outlook open the event already filled in — the user clicks Save
  // there, no file to download. The .ics stays as the fallback.
  const cal = saved?.startIso
    ? meetingCalendarLinks({
        id: saved.id,
        start: saved.startIso,
        durationMinutes: saved.durationMinutes,
        title: saved.subject || (saved.name ? `Meeting with ${saved.name}` : "Meeting"),
        location: saved.location,
      })
    : saved?.id
      ? { google: null, outlook: null, ics: `/api/review-meetings/${saved.id}/calendar.ics` }
      : null;

  const inviteText = saved
    ? `Hi${saved.name ? " " + saved.name : ""}, our meeting is scheduled for ${prettyDate}${saved.time ? " at " + saved.time : ""}.${saved.subject ? ` Agenda: ${saved.subject}.` : ""} Looking forward to it.`
    : "";

  // Rendered at the top of the page, not inside the host: a card with a
  // transform / filter (the lead journey) made `fixed` relative to the card,
  // so the form opened squeezed inside it.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center overflow-y-auto p-4 sm:p-6" onClick={close}>
      <div className="card-surface w-full max-w-2xl my-4 sm:my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-5 border-b">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-brand-cyan-light grid place-items-center">
              <Calendar className="size-5 text-brand-cyan" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">{saved ? "Meeting scheduled" : "Schedule meeting"}</h2>
              <p className="text-xs text-muted-foreground">A reminder fires the day before; action items become tasks.</p>
            </div>
          </div>
          <button onClick={close} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>

        <div className="p-5">
          {saved ? (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="size-12 mx-auto text-emerald-500" />
              <div>
                <div className="font-semibold">Meeting scheduled{prettyDate ? ` for ${prettyDate}` : ""}{saved.time ? ` at ${saved.time}` : ""}</div>
                {saved.subject && <div className="text-sm text-muted-foreground mt-0.5">{saved.subject}</div>}
              </div>
              <p className="text-sm text-muted-foreground">
                It is already on your{" "}
                <Link href="/dashboard/calendar" className="font-medium text-primary hover:underline">CRM Calendar</Link>.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {cal?.google && (
                  <a href={cal.google} target="_blank" rel="noreferrer" className="btn-secondary text-sm inline-flex items-center gap-1.5">
                    <CalendarPlus className="size-4" /> Add to Google Calendar
                  </a>
                )}
                {cal?.outlook && (
                  <a href={cal.outlook} target="_blank" rel="noreferrer" className="btn-secondary text-sm inline-flex items-center gap-1.5">
                    <CalendarPlus className="size-4" /> Outlook
                  </a>
                )}
                <button
                  onClick={() => { navigator.clipboard.writeText(inviteText); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
                  className="btn-secondary text-sm inline-flex items-center gap-1.5"
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy invite for WhatsApp"}
                </button>
              </div>
              {cal?.ics && (
                <DownloadButton url={cal.ics} filename="meeting.ics" className="text-xs text-muted-foreground underline hover:text-foreground">
                  Apple Calendar or another app? Download the .ics file
                </DownloadButton>
              )}
              <div>
                <button onClick={() => { onSuccess?.(saved.id); }} className="btn-primary text-sm">Done</button>
              </div>
            </div>
          ) : err ? (
            <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{err}</div>
          ) : !data ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : (
            <ScheduleMeetingForm
              investors={data.investors}
              leads={data.leads}
              families={data.families}
              preselectedLeadId={preselectedLeadId}
              preselectedInvestorId={preselectedInvestorId}
              preselectedCategory={preselectedCategory}
              defaultSubject={defaultSubject}
              onSuccess={(m) => setSaved({ ...m, name: subjectName })}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
