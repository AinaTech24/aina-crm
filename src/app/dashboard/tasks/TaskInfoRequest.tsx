"use client";

/**
 * "Need information" on a task (lib/tasks/info-request.ts).
 *
 *   - The assignee asks a question — by default to whoever assigned the task —
 *     and the task waits ("blocked") until it is answered.
 *   - While it waits, everyone opening the task sees who it is waiting on, and
 *     the person asked gets a box to answer in, right here.
 *   - Both the question and the answer are also posted to the comments below.
 */

import { useEffect, useState } from "react";
import { HelpCircle, Loader2, MessageCircleQuestion, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { notify } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";
import { openInfoRequest } from "@/lib/tasks/info-request";

type Person = { id: string; name: string };

export function TaskInfoRequest({
  taskId,
  meta,
  status,
  assigneeId,
  createdById,
  currentUserId,
  canManageAll,
  onChanged,
}: {
  taskId: string;
  meta: unknown;
  status: string;
  assigneeId: string | null;
  createdById: string | null;
  currentUserId: string;
  canManageAll: boolean;
  onChanged: () => void;
}) {
  const open = openInfoRequest(meta);
  const closed = status === "completed" || status === "cancelled";
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [askTo, setAskTo] = useState<string>(createdById && createdById !== currentUserId ? createdById : "");
  const [answer, setAnswer] = useState("");
  const [team, setTeam] = useState<Person[] | null>(null);
  const [busy, setBusy] = useState(false);

  // The team list, only once someone starts asking.
  useEffect(() => {
    if (!asking || team) return;
    fetch("/api/employees")
      .then((r) => (r.ok ? r.json() : { employees: [] }))
      .then((j) => setTeam(((j.rows ?? []) as Person[]).filter((p) => p.id !== currentUserId)))
      .catch(() => setTeam([]));
  }, [asking, team, currentUserId]);

  async function send(payload: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/info-request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(j.error ?? "That didn't go through.");
        return;
      }
      notify.success(done);
      setAsking(false);
      setQuestion("");
      setAnswer("");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (open) {
    const canAnswer = open.askedToId === currentUserId || createdById === currentUserId || canManageAll;
    const isAsker = open.askedById === currentUserId;
    return (
      <div className="rounded-lg border border-warning/50 bg-warning/5 p-3 space-y-2">
        <div className="flex items-start gap-2 text-sm">
          <MessageCircleQuestion className="size-4 mt-0.5 shrink-0 text-amber-700" aria-hidden />
          <div className="min-w-0">
            <div className="font-semibold text-foreground">
              {open.askedToId === currentUserId
                ? `${open.askedByName ?? "Your teammate"} needs information from you`
                : `Waiting for information from ${open.askedToName ?? "a teammate"}`}
            </div>
            <div className="text-xs text-muted-foreground">
              Asked by {isAsker ? "you" : open.askedByName ?? "the assignee"} · {formatDate(open.askedAt, "dateTime")}
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">{open.question}</p>
          </div>
        </div>
        {canAnswer && !closed && (
          <div className="space-y-2 pl-6">
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={3}
              maxLength={5000}
              placeholder="Type the information they need…"
              aria-label="Your answer"
              className="input-base w-full text-sm"
            />
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !answer.trim()}
              icon={busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              onClick={() => send({ action: "answer", answer: answer.trim() }, "Answer sent")}
            >
              Send answer
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Asking is for whoever is doing the task.
  if (closed || assigneeId !== currentUserId) return null;

  if (!asking) {
    return (
      <Button variant="secondary" size="sm" icon={<HelpCircle className="size-4" />} onClick={() => setAsking(true)}>
        Need information
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-2">
      <div className="text-sm font-semibold">What do you need to finish this task?</div>
      <label className="block text-xs">
        <span className="text-muted-foreground">Ask</span>
        <select value={askTo} onChange={(e) => setAskTo(e.target.value)} className="input-base mt-1 w-full text-sm">
          {!askTo && <option value="">Choose a teammate…</option>}
          {createdById && createdById !== currentUserId && !team?.some((p) => p.id === createdById) && (
            <option value={createdById}>Whoever assigned this task</option>
          )}
          {(team ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.id === createdById ? " (assigned this task)" : ""}
            </option>
          ))}
        </select>
      </label>
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={3}
        maxLength={3000}
        placeholder="e.g. Which bank account should the redemption go to?"
        aria-label="Your question"
        className="input-base w-full text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={busy || !question.trim() || !askTo}
          icon={busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          onClick={() => send({ action: "ask", question: question.trim(), askToId: askTo }, "Question sent — the task is waiting for the answer")}
        >
          Send question
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAsking(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
