"use client";

/**
 * Add or edit a position's contract: title, purpose, the results it answers
 * for and what it may approve (one per line).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { notify } from "@/components/ui/Toast";

/** One result / approval per line, trimmed, bullets, blanks and duplicates dropped. */
function linesToList(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*[-*•]\s*/, "").trim().slice(0, 300);
    if (line && !out.includes(line)) out.push(line);
  }
  return out.slice(0, 30);
}

export type PositionDraft = {
  id?: string;
  title: string;
  purpose: string | null;
  results: string[];
  approvals: string[];
};

export function PositionEditDialog({
  open,
  onOpenChange,
  position,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent = a new position. */
  position?: PositionDraft | null;
}) {
  const router = useRouter();
  const editing = !!position?.id;
  const [title, setTitle] = useState(position?.title ?? "");
  const [purpose, setPurpose] = useState(position?.purpose ?? "");
  const [results, setResults] = useState((position?.results ?? []).join("\n"));
  const [approvals, setApprovals] = useState((position?.approvals ?? []).join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 2) { setError("Give the position a title"); return; }
    setSaving(true);
    try {
      const body = {
        title: title.trim(),
        purpose: purpose.trim() || null,
        results: linesToList(results),
        approvals: linesToList(approvals),
      };
      const r = await fetch(editing ? `/api/practice/positions/${position!.id}` : "/api/practice/positions", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { notify.error(j.error ?? "Could not save the position"); return; }
      notify.success(editing ? "Position saved" : "Position added");
      onOpenChange(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <form onSubmit={save}>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${position!.title}` : "Add a position"}</DialogTitle>
            <DialogDescription>
              The position contract: what the job is for and what it answers for, whoever does it.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <Field label="Title" required error={error}>
              {(id, describedBy, invalid) => (
                <input id={id} aria-describedby={describedBy} aria-invalid={invalid} className="input-base"
                  value={title} maxLength={120} onChange={(e) => { setTitle(e.target.value); setError(null); }} />
              )}
            </Field>
            <Field label="Purpose" optional hint="One sentence: why the firm has this job.">
              {(id, describedBy) => (
                <textarea id={id} aria-describedby={describedBy} className="input-base" rows={2}
                  value={purpose} maxLength={1000} onChange={(e) => setPurpose(e.target.value)} />
              )}
            </Field>
            <Field label="Results this position answers for" optional hint="One per line.">
              {(id, describedBy) => (
                <textarea id={id} aria-describedby={describedBy} className="input-base" rows={4}
                  value={results} onChange={(e) => setResults(e.target.value)} />
              )}
            </Field>
            <Field label="May approve" optional hint="One per line.">
              {(id, describedBy) => (
                <textarea id={id} aria-describedby={describedBy} className="input-base" rows={3}
                  value={approvals} onChange={(e) => setApprovals(e.target.value)} />
              )}
            </Field>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" type="submit" loading={saving}>{editing ? "Save" : "Add position"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
