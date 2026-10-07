"use client";

/**
 * After a lead's meeting is marked completed: "Send the minutes of meeting?"
 *
 *   1. ask      — yes / no
 *   2. agenda   — what was discussed; required (the MOM is built from it).
 *                 Saved back to the meeting when it was edited here.
 *   3. preview  — To, subject and body, all editable, beside a preview of the
 *                 mail; optional attachments; Send.
 *
 * Sending goes through POST /api/communications/compose — the same consent +
 * compliance gate and `communications` row as every client email, which also
 * appends the firm's signature and the MF disclaimer.
 */

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileText, Loader2, Mail, Paperclip, Send, X } from "lucide-react";
import { notify } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";

export type MomActionItem = { title: string; assigneeId?: string; dueAt?: string };

export type MomMeeting = {
  id: string;
  subject?: string | null;
  meeting_date?: string | null;
  meeting_mode?: string | null;
};

const MODE_LABELS: Record<string, string> = {
  office: "at our office",
  client_place: "at your place",
  online: "online",
  phone: "over the phone",
  in_person: "in person",
};

const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const MIN_AGENDA = 10;

type Attachment = { name: string; size: number; base64: string };

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** The MOM as plain text — the composer turns it into the HTML mail. */
export function buildMomBody(args: {
  recipientName: string;
  meeting: MomMeeting;
  agenda: string;
  items: MomActionItem[];
  team: Array<{ id: string; name: string }>;
  senderName: string;
}): string {
  const { meeting: m } = args;
  const when = m.meeting_date ? formatDate(m.meeting_date) : "";
  const how = m.meeting_mode ? MODE_LABELS[m.meeting_mode] ?? "" : "";
  const nameOf = (id?: string) => args.team.find((t) => t.id === id)?.name;
  const steps = args.items
    .filter((it) => it.title.trim())
    .map((it, i) => {
      const who = nameOf(it.assigneeId);
      const due = it.dueAt ? formatDate(String(it.dueAt).slice(0, 10)) : "";
      return `${i + 1}. ${it.title.trim()}${who ? ` — ${who}` : ""}${due ? `, by ${due}` : ""}`;
    });
  return [
    `Dear ${args.recipientName || "Sir/Madam"},`,
    "",
    `Thank you for your time${when ? ` on ${when}` : ""}${how ? ` ${how}` : ""}. Please find below the minutes of our meeting.`,
    "",
    "What we discussed:",
    args.agenda.trim(),
    ...(steps.length ? ["", "Next steps:", ...steps] : []),
    "",
    "Please reply to this email if anything needs to be added or corrected.",
    "",
    "Regards,",
    args.senderName,
  ].join("\n");
}

export function MomComposer({
  leadId,
  meeting,
  agenda: savedAgenda,
  items,
  team,
  me,
  onFinish,
}: {
  leadId: string;
  meeting: MomMeeting;
  agenda: string;
  items: MomActionItem[];
  team: Array<{ id: string; name: string }>;
  me: string | null;
  /** Called when the flow ends — sent or skipped. */
  onFinish: () => void;
}) {
  const [step, setStep] = useState<"ask" | "agenda" | "preview">("ask");
  const [lead, setLead] = useState<{ name: string; email: string | null } | null>(null);
  const [agenda, setAgenda] = useState(savedAgenda);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/leads/${leadId}`)
      .then((r) => r.json())
      .then((j) => { if (alive) setLead({ name: j?.name ?? "", email: j?.email ?? null }); })
      .catch(() => { if (alive) setLead({ name: "", email: null }); });
    return () => { alive = false; };
  }, [leadId]);

  // The team list labels people "Name (Role)"; the mail is signed with the name.
  const senderName = useMemo(
    () => (team.find((t) => t.id === me)?.name ?? "").replace(/\s*\([^)]*\)\s*$/, ""),
    [team, me],
  );
  const totalBytes = files.reduce((n, f) => n + f.size, 0);

  async function toPreview() {
    if (agenda.trim().length < MIN_AGENDA) {
      setErr("Write what was discussed — the minutes are built from it.");
      return;
    }
    setErr(null);
    // Keep the meeting record in step with what the client is told.
    if (agenda.trim() !== savedAgenda.trim()) {
      setBusy(true);
      const res = await fetch(`/api/review-meetings/${meeting.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discussionPoints: agenda.trim() }),
      }).catch(() => null);
      setBusy(false);
      if (!res?.ok) {
        setErr("Could not save the agenda to the meeting. Try again.");
        return;
      }
    }
    setTo((t) => t || lead?.email || "");
    setSubject((s) => s || `Minutes of our meeting${meeting.meeting_date ? ` — ${formatDate(meeting.meeting_date)}` : ""}`);
    setBody(buildMomBody({ recipientName: lead?.name ?? "", meeting, agenda, items, team, senderName }));
    setStep("preview");
  }

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setErr(null);
    const picked = Array.from(list);
    if (files.length + picked.length > MAX_FILES) {
      setErr(`Attach up to ${MAX_FILES} files.`);
      return;
    }
    if (totalBytes + picked.reduce((n, f) => n + f.size, 0) > MAX_BYTES) {
      setErr("Attachments can be 10 MB in total.");
      return;
    }
    const read = await Promise.all(picked.map(async (f) => ({ name: f.name, size: f.size, base64: await readBase64(f) })));
    setFiles((s) => [...s, ...read]);
  }

  async function send() {
    const email = to.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr("Enter the email address to send to."); return; }
    if (!subject.trim()) { setErr("Enter a subject."); return; }
    if (body.trim().length < MIN_AGENDA) { setErr("The email is empty."); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/communications/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadId,
          // Only when it differs from the lead's own address (or there is none).
          toEmail: email.toLowerCase() !== (lead?.email ?? "").toLowerCase() ? email : undefined,
          subject: subject.trim(),
          body: body.trim(),
          category: "transactional",
          attachments: files.length ? files.map((f) => ({ filename: f.name, contentBase64: f.base64 })) : undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 422) {
        const why = (j.findings ?? []).filter((f: any) => f.severity === "block").map((f: any) => f.message).join(" ");
        setErr(`Compliance check stopped this mail. ${why}`.trim());
        return;
      }
      if (!res.ok || j.status === "failed") {
        setErr(j.error ?? j.reason ?? `The mail could not be sent (error ${res.status}).`);
        return;
      }
      if (j.status === "skipped") {
        setErr(`Not sent: ${String(j.reason ?? "the client has opted out of email").replace(/_/g, " ")}.`);
        return;
      }
      notify.success(`Minutes of meeting sent to ${email}.`, "MOM sent");
      onFinish();
    } catch {
      setErr("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "ask") {
    return (
      <div className="rounded-lg border border-border p-5 text-center space-y-4">
        <CheckCircle2 className="size-8 mx-auto text-emerald-600" aria-hidden />
        <div>
          <div className="font-semibold">Meeting marked completed</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Do you want to send the minutes of meeting (MOM){lead?.name ? ` to ${lead.name}` : ""}?
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" onClick={onFinish} className="btn-secondary text-sm">No, skip</button>
          <button type="button" onClick={() => setStep("agenda")} className="btn-primary text-sm inline-flex items-center gap-1.5">
            <Mail className="size-4" aria-hidden /> Yes, send MOM
          </button>
        </div>
      </div>
    );
  }

  if (step === "agenda") {
    return (
      <div className="rounded-lg border border-border p-4 space-y-4">
        <div>
          <div className="font-semibold text-sm">Minutes of meeting · 1 of 2</div>
          <p className="text-xs text-muted-foreground">Check what was discussed — the email is written from this and the next actions.</p>
        </div>
        <div>
          <label htmlFor="mom-agenda" className="mb-1 block text-xs font-medium">Meeting agenda — what was discussed</label>
          <textarea
            id="mom-agenda"
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
            rows={6}
            placeholder="e.g. Reviewed the current portfolio; discussed a monthly SIP of ₹10,000 for retirement; client to share bank details for the mandate."
            className="input-base text-sm w-full"
          />
          {agenda.trim().length < MIN_AGENDA && (
            <p className="mt-1 text-2xs text-amber-700">The agenda is empty or too short — add the points discussed.</p>
          )}
        </div>
        {items.some((it) => it.title.trim()) && (
          <div>
            <div className="text-xs font-medium">Next actions (included)</div>
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
              {items.filter((it) => it.title.trim()).map((it, i) => <li key={i}>{it.title}</li>)}
            </ul>
          </div>
        )}
        {err && <div role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{err}</div>}
        <div className="flex justify-between gap-2">
          <button type="button" onClick={onFinish} className="btn-ghost text-sm">Skip MOM</button>
          <button type="button" onClick={toPreview} disabled={busy || !lead} className="btn-primary text-sm inline-flex items-center gap-1.5">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" aria-hidden />} Preview email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div>
        <div className="font-semibold text-sm">Minutes of meeting · 2 of 2 — check and send</div>
        <p className="text-xs text-muted-foreground">Edit anything below. Your firm&apos;s signature and the mutual-fund disclaimer are added automatically.</p>
      </div>

      <div className="grid gap-3">
        <div>
          <label htmlFor="mom-to" className="mb-1 block text-xs font-medium">To</label>
          <input id="mom-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" className="input-base text-sm w-full" />
          {!lead?.email && <p className="mt-1 text-2xs text-muted-foreground">This lead has no email on file — type the address to send to.</p>}
        </div>
        <div>
          <label htmlFor="mom-subject" className="mb-1 block text-xs font-medium">Subject</label>
          <input id="mom-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="input-base text-sm w-full" />
        </div>
        <div>
          <label htmlFor="mom-body" className="mb-1 block text-xs font-medium">Message</label>
          <textarea id="mom-body" value={body} onChange={(e) => setBody(e.target.value)} rows={12} className="input-base text-sm w-full font-[inherit]" />
        </div>
      </div>

      {/* Preview — how the client reads it */}
      <div>
        <div className="mb-1 text-xs font-medium">Preview</div>
        <div className="rounded-lg border border-border bg-secondary/40 p-4">
          <div className="rounded-md bg-card p-4 shadow-sm">
            <div className="text-2xs text-muted-foreground">To: {to || "—"}</div>
            <div className="mt-0.5 text-sm font-semibold">{subject || "(no subject)"}</div>
            <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">{body}</div>
            {files.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
                {files.map((f) => (
                  <span key={f.name} className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-2xs">
                    <Paperclip className="size-3" aria-hidden /> {f.name}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-3 border-t border-dashed border-border pt-2 text-2xs text-muted-foreground">+ firm signature with ARN, and the mutual-fund disclaimer</div>
          </div>
        </div>
      </div>

      {/* Attachments */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-medium">Attachments <span className="font-normal text-muted-foreground">(optional · up to {MAX_FILES} files, 10 MB)</span></div>
          <label className="btn-secondary text-xs inline-flex cursor-pointer items-center gap-1.5">
            <Paperclip className="size-3.5" aria-hidden /> Attach files
            <input type="file" multiple className="sr-only" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
        {files.length > 0 && (
          <ul className="mt-2 space-y-1">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-md bg-secondary/50 px-2 py-1.5 text-xs">
                <span className="min-w-0 truncate">{f.name} <span className="text-muted-foreground">· {kb(f.size)}</span></span>
                <button type="button" onClick={() => setFiles((s) => s.filter((_, idx) => idx !== i))} className="btn-icon" aria-label={`Remove ${f.name}`}>
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {err && <div role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{err}</div>}

      <div className="flex flex-wrap justify-between gap-2">
        <button type="button" onClick={() => { setErr(null); setStep("agenda"); }} disabled={busy} className="btn-ghost text-sm">Back</button>
        <div className="flex gap-2">
          <button type="button" onClick={onFinish} disabled={busy} className="btn-secondary text-sm">Don&apos;t send</button>
          <button type="button" onClick={send} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-1.5">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" aria-hidden />} Send mail
          </button>
        </div>
      </div>
    </div>
  );
}
