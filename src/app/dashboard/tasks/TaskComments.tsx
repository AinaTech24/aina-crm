"use client";

/**
 * TaskComments — the real, threaded comment log for a task (replaces the old
 * single prepend-only remarks blob as the interactive surface). Author +
 * timestamp per entry, @mention autocomplete over the firm's team (each
 * mentioned teammate gets a notification), and edit / delete your own.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Trash, AtSign, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";

type Employee = { id: string; name: string; email: string; roles: string[]; department: string | null };
type Comment = {
  id: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  mentions: string[];
  createdAt: string;
  updatedAt?: string;
};

/** Written once, createdAt and updatedAt are the same instant; an edit moves updatedAt. */
function wasEdited(c: Comment): boolean {
  return !!c.updatedAt && new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime() > 1000;
}

/** The ids to send: those whose "@Name" is still in the text. */
function mentionsIn(body: string, picked: Employee[]): string[] {
  return picked.filter((e) => body.includes(`@${e.name}`)).map((e) => e.id);
}

const addPicked = (list: Employee[], emp: Employee) => (list.some((x) => x.id === emp.id) ? list : [...list, emp]);

function initials(name?: string | null): string {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}
function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return formatDate(d, "dateTime");
}
/** Render a comment body, lightly highlighting @mention tokens. */
function renderBody(body: string) {
  const parts = body.split(/(@[\p{L}][\p{L}.'-]*(?:\s[\p{L}][\p{L}.'-]*)?)/gu);
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      <span key={i} className="font-semibold text-brand-cyan-deep">{p}</span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

/** A comment box with the @mention picker. Children sit inside it (the send button). */
function MentionInput({
  value, onChange, onPick, onSubmit, onCancel, team, placeholder, label, autoFocus, children,
}: {
  value: string;
  onChange: (value: string) => void;
  onPick: (emp: Employee) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  team: Employee[];
  placeholder?: string;
  label: string;
  autoFocus?: boolean;
  children?: React.ReactNode;
}) {
  const [mentionQ, setMentionQ] = useState<{ start: number; q: string } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // An editor opens with the caret after the existing text.
  useEffect(() => {
    const ta = taRef.current;
    if (!autoFocus || !ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [autoFocus]);

  // Detect an active "@token" ending at the caret so we can offer the picker.
  function onType(next: string) {
    onChange(next);
    const caret = taRef.current?.selectionStart ?? next.length;
    let i = caret - 1;
    while (i >= 0 && !/\s/.test(next[i]) && next[i] !== "@") i--;
    if (i >= 0 && next[i] === "@") setMentionQ({ start: i, q: next.slice(i + 1, caret) });
    else setMentionQ(null);
  }

  function pickMention(emp: Employee) {
    if (!mentionQ) return;
    const caret = taRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, mentionQ.start);
    const after = value.slice(caret);
    onChange(`${before}@${emp.name} ${after}`);
    onPick(emp);
    setMentionQ(null);
    requestAnimationFrame(() => taRef.current?.focus());
  }

  const matches = mentionQ
    ? team.filter((e) => e.name.toLowerCase().includes(mentionQ.q.toLowerCase())).slice(0, 6)
    : [];

  return (
    <div className="relative">
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onType(e.target.value)}
        onKeyDown={(e) => {
          if (mentionQ && matches.length && e.key === "Enter") { e.preventDefault(); pickMention(matches[0]); }
          else if (mentionQ && e.key === "Escape") setMentionQ(null);
          else if (e.key === "Escape" && onCancel) { e.preventDefault(); onCancel(); }
          else if (!mentionQ && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); }
        }}
        placeholder={placeholder}
        aria-label={label}
        maxLength={5000}
        rows={2}
        className="input-base text-xs bg-secondary border-border focus:bg-white transition-colors w-full pr-9"
      />
      {children}

      {/* @mention picker */}
      {mentionQ && matches.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-1 z-50 max-h-52 overflow-y-auto scrollbar-thin card-elevated bg-card p-1 animate-scale-in">
          {matches.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => pickMention(e)}
                className="w-full text-left rounded-md px-2 py-1.5 hover:bg-secondary flex items-center gap-2"
              >
                <span className="size-6 rounded-full bg-brand-cyan-light/60 text-brand-cyan-deep text-2xs font-bold flex items-center justify-center shrink-0">
                  {initials(e.name)}
                </span>
                <span className="text-xs font-medium truncate">{e.name}</span>
                {e.department && <span className="text-2xs text-muted-foreground ml-auto shrink-0">{e.department}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TaskComments({ taskId, currentUserId }: { taskId: string; currentUserId: string }) {
  const toast = useToast();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [team, setTeam] = useState<Employee[]>([]);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Employee[]>([]); // mentioned teammates
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string; picked: Employee[] } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tasks/${taskId}/comments`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setComments(Array.isArray(j.comments) ? j.comments : []); })
      .catch(() => { if (!cancelled) setComments([]); });
    fetch(`/api/employees`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setTeam((j.rows ?? []) as Employee[]); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [taskId]);

  async function submit() {
    const body = text.trim();
    if (!body || sending) return;
    // Only keep mentions whose "@Name" survived in the final text.
    const mentions = mentionsIn(body, picked);
    setSending(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, mentions }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Failed to add comment");
      setComments((c) => [...(c ?? []), j.comment]);
      setText("");
      setPicked([]);
      if (mentions.length) toast.success(`Comment added · ${mentions.length} teammate${mentions.length > 1 ? "s" : ""} notified`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't add comment", "Comment failed");
    } finally {
      setSending(false);
    }
  }

  async function saveEdit() {
    const body = editing?.text.trim();
    const original = (comments ?? []).find((c) => c.id === editing?.id);
    if (!editing || !original || !body || saving) return;
    if (body === original.body) { setEditing(null); return; }
    // Earlier mentions stay unless their "@Name" was removed. One whose name is
    // not in the team list cannot be checked, so it is kept.
    const earlier = (original.mentions ?? []).filter((id) => {
      const emp = team.find((e) => e.id === id);
      return !emp || body.includes(`@${emp.name}`);
    });
    const mentions = Array.from(new Set([...earlier, ...mentionsIn(body, editing.picked)]));
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, mentions }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Failed to save comment");
      setComments((list) => (list ?? []).map((c) =>
        c.id === j.comment.id ? { ...c, body: j.comment.body, mentions: j.comment.mentions, updatedAt: j.comment.updatedAt } : c
      ));
      setEditing(null);
    } catch (e: any) {
      // The editor stays open, so nothing typed is lost.
      toast.error(e?.message ?? "Couldn't save comment", "Edit failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const prev = comments;
    setComments((c) => (c ?? []).filter((x) => x.id !== id)); // optimistic
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setComments(prev ?? []);
      toast.error("Couldn't delete comment");
    }
  }

  return (
    <div className="space-y-3">
      {/* Composer */}
      <MentionInput
        value={text}
        onChange={setText}
        onPick={(emp) => setPicked((p) => addPicked(p, emp))}
        onSubmit={submit}
        team={team}
        placeholder="Write a comment…  Type @ to mention a teammate."
        label="New comment"
      >
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || sending}
          className="absolute right-2 bottom-2 p-1.5 rounded-md bg-brand-cyan text-white disabled:opacity-40 hover:brightness-110"
          aria-label="Post comment"
        >
          {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
        </button>
      </MentionInput>
      {picked.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <AtSign className="size-3 text-muted-foreground" />
          {picked.map((e) => (
            <span key={e.id} className="chip text-2xs bg-brand-cyan-light/50 text-brand-cyan-deep border border-brand-cyan/20">
              {e.name}
            </span>
          ))}
        </div>
      )}

      {/* Thread */}
      {comments == null ? (
        <div className="flex items-center gap-2 text-2xs text-muted-foreground py-2">
          <Loader2 className="size-3.5 animate-spin" /> Loading comments…
        </div>
      ) : comments.length === 0 ? (
        <div className="text-2xs text-muted-foreground text-center py-2">No comments yet.</div>
      ) : (
        <div className="space-y-3 max-h-72 overflow-y-auto pr-1 scrollbar-thin">
          {comments.map((c) => (
            <div key={c.id} className="group flex gap-2.5 items-start">
              <div className="size-6 rounded-full bg-secondary border text-2xs font-bold text-muted-foreground flex items-center justify-center flex-shrink-0 mt-0.5">
                {initials(c.authorName)}
              </div>
              <div className="flex-1 min-w-0 bg-secondary border border-slate-100 rounded-lg p-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-2xs font-semibold text-foreground truncate">{c.authorName ?? "Someone"}</span>
                  <span className="text-2xs text-muted-foreground">{whenLabel(c.createdAt)}</span>
                  {wasEdited(c) && (
                    <span className="text-2xs text-muted-foreground shrink-0" title={`Edited ${whenLabel(c.updatedAt!)}`}>· edited</span>
                  )}
                  {c.authorId === currentUserId && editing?.id !== c.id && (
                    <span className="ml-auto flex items-center -my-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => setEditing({ id: c.id, text: c.body, picked: [] })}
                        disabled={saving}
                        className="btn-icon size-6"
                        aria-label="Edit comment"
                        title="Edit comment"
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(c.id)}
                        className="btn-icon size-6 hover:text-rose-600"
                        aria-label="Delete comment"
                        title="Delete comment"
                      >
                        <Trash className="size-3" />
                      </button>
                    </span>
                  )}
                </div>
                {editing?.id === c.id ? (
                  <div className="space-y-2">
                    <MentionInput
                      value={editing.text}
                      onChange={(value) => setEditing((e) => (e ? { ...e, text: value } : e))}
                      onPick={(emp) => setEditing((e) => (e ? { ...e, picked: addPicked(e.picked, emp) } : e))}
                      onSubmit={saveEdit}
                      onCancel={() => setEditing(null)}
                      team={team}
                      label="Edit comment"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={saving}>
                        Cancel
                      </Button>
                      <Button variant="secondary" size="sm" onClick={saveEdit} loading={saving} disabled={!editing.text.trim()}>
                        Save comment
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-foreground whitespace-pre-wrap leading-relaxed break-words">
                    {renderBody(c.body)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
