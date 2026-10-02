"use client";

/**
 * The Notes card on a lead or a client: write a note, and read every note
 * logged about the person — from this box, "Log call / visit", check-ins and
 * the mobile call sync — newest first, with who wrote it and when.
 *
 * Reads GET /api/{leads|investors}/[id]/notes (lib/notes/record-notes.ts).
 * Writes a lead note through POST /api/leads/[id]/notes (it also refreshes the
 * lead's last contact) and a client note through POST /api/activities as kind
 * "note", the route "Log call / visit" uses.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, StickyNote } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { InlineEmpty } from "@/components/common/EmptyState";
import { buttonClass } from "@/components/ui/button-class";
import { notify } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";

type Note = { id: string; kind: string; at: string; title: string; body?: string | null; meta?: string | null };

const MAX = 4000;

export function RecordNotes({
  subject,
  internalNote,
}: {
  subject: { type: "lead" | "investor"; id: string };
  /** The record's single "Internal notes" field, shown under the log when set. */
  internalNote?: string | null;
}) {
  const router = useRouter();
  const base = subject.type === "lead" ? `/api/leads/${subject.id}` : `/api/investors/${subject.id}`;
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}/notes`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "failed");
      setNotes(Array.isArray(j.notes) ? j.notes : []);
      setFailed(false);
    } catch {
      setFailed(true);
      setNotes([]);
    }
  }, [base]);

  useEffect(() => { void load(); }, [load]);

  async function add() {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      const res =
        subject.type === "lead"
          ? await fetch(`${base}/notes`, {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
              body: JSON.stringify({ note: text, activityType: "note" }),
            })
          : await fetch("/api/activities", {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
              body: JSON.stringify({ subjectType: "investor", subjectId: subject.id, kind: "note", notes: text }),
            });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `Couldn't save the note (${res.status})`);
      setDraft("");
      notify.success("Note added");
      await load();
      // The page's timeline and "last contact" read the same rows.
      router.refresh();
    } catch (e: any) {
      notify.error(e?.message ?? "Couldn't save the note", "Not saved");
    } finally {
      setSaving(false);
    }
  }

  const shown = notes && !showAll ? notes.slice(0, 5) : notes ?? [];

  const body = (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor={`note-${subject.id}`} className="sr-only">Add a note</label>
        <textarea
          id={`note-${subject.id}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX))}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void add(); }}
          rows={3}
          placeholder={subject.type === "lead" ? "What did you discuss with this lead?" : "What did you discuss with this client?"}
          className="input-base w-full resize-y"
          disabled={saving}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xs text-muted-foreground">Ctrl + Enter to save</span>
          <button type="button" onClick={add} disabled={!draft.trim() || saving} className={buttonClass("primary", "sm", "gap-1.5")}>
            {saving && <Loader2 className="size-3.5 animate-spin" />} Add note
          </button>
        </div>
      </div>

      {notes === null ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading notes…</div>
      ) : failed ? (
        <p className="text-sm text-muted-foreground">Couldn&apos;t load the notes. Refresh the page to try again.</p>
      ) : notes.length === 0 ? (
        <InlineEmpty message="No notes yet. Notes you add here, and notes on logged calls and visits, show up here." />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {shown.map((n) => (
            <li key={n.id} className="px-3 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2 text-2xs text-muted-foreground">
                <span className="font-medium text-foreground">{n.title}</span>
                <span>{formatDate(n.at, "dateTime")}</span>
                {n.meta && <span>· {n.meta}</span>}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
      {notes && notes.length > 5 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className={buttonClass("ghost", "sm")}>
          {showAll ? "Show fewer" : `Show all ${notes.length} notes`}
        </button>
      )}

      {internalNote && internalNote.trim() && (
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Internal notes</div>
          <p className="whitespace-pre-wrap text-sm">{internalNote}</p>
        </div>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader title="Notes" icon={<StickyNote className="size-4" />} />
      <CardBody>{body}</CardBody>
    </Card>
  );
}
