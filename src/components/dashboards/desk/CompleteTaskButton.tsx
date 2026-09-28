"use client";

/**
 * Mark a task complete from the desk, without opening it.
 *
 * PATCH /api/tasks/[id] { status: "completed" } — the route owns the rules:
 * only the assignee (or someone with task.edit.all) may complete it, and a
 * task that needs approval goes for approval instead of closing. The button
 * only renders for a viewer who holds a task-edit capability; the API is
 * still the gate.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { notify } from "@/components/ui/Toast";

export function CompleteTaskButton({ taskId, title }: { taskId: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function complete(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not complete the task");
      setDone(true);
      // The route returns the task as saved: a task that needs approval comes
      // back still open, submitted for sign-off.
      notify.success(j?.status === "completed" ? "Task completed." : "Submitted for approval.");
      router.refresh();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "Could not complete the task");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={complete}
      disabled={busy || done}
      aria-label={`Complete task: ${title}`}
      title="Mark complete"
      className="inline-grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-success/10 hover:text-success disabled:opacity-50"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
    </button>
  );
}
