"use client";

/**
 * "New task" on a family's page. The task is ABOUT the family
 * (subject_type 'family'), and optionally about one member too, so it shows on
 * the family page and — when a member is picked — on that client's page.
 * Assigned to whoever creates it unless the task rules say otherwise.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ListPlus, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/Dialog";
import { DateField } from "@/components/ui/DateField";
import { ThemeSelect } from "@/components/ui/ThemeSelect";
import { buttonClass } from "@/components/ui/button-class";
import { useToast } from "@/components/ui/Toast";

export function AddFamilyTaskButton({
  familyId,
  familyName,
  members,
  triggerClassName,
}: {
  familyId: string;
  familyName: string;
  members: Array<{ id: string; name: string }>;
  triggerClassName?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState("normal");
  const [memberId, setMemberId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setDueAt("");
    setPriority("normal");
    setMemberId("");
    setErr(null);
  }

  async function save() {
    if (title.trim().length < 2) {
      setErr("Give the task a title.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          type: "follow_up",
          subjectType: "family",
          subjectId: familyId,
          ...(memberId ? { relatedInvestorId: memberId } : {}),
          priority,
          ...(dueAt ? { dueAt: new Date(`${dueAt}T10:00:00`).toISOString() } : {}),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? "Could not create the task.");
        return;
      }
      toast.success("Task created");
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      setErr("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={triggerClassName ?? buttonClass("secondary", "sm")}>
        <ListPlus className="size-4" /> New task
      </button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent>
          <DialogTitle>New task for {familyName}</DialogTitle>
          <DialogDescription className="mt-0.5 text-xs">Shows on this family&apos;s page and in your task list.</DialogDescription>

          <div className="mt-4 space-y-3">
            <label className="block">
              <div className="mb-1 text-xs font-medium">What needs doing</div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={300}
                autoFocus
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <div className="mb-1 text-xs font-medium">Due</div>
                <DateField value={dueAt} onChange={(e: any) => setDueAt(e.target.value)} aria-label="Due date" />
              </label>
              <label className="block">
                <div className="mb-1 text-xs font-medium">Priority</div>
                <ThemeSelect
                  value={priority}
                  onChange={setPriority}
                  options={[
                    ["low", "Low"],
                    ["normal", "Normal"],
                    ["high", "High"],
                    ["urgent", "Urgent"],
                  ]}
                />
              </label>
            </div>
            {members.length > 0 && (
              <label className="block">
                <div className="mb-1 text-xs font-medium">About a member <span className="font-normal text-muted-foreground">· optional</span></div>
                <ThemeSelect
                  value={memberId}
                  onChange={setMemberId}
                  options={[["", "The whole family"], ...members.map((m) => [m.id, m.name] as [string, string])]}
                />
              </label>
            )}
            {err && (
              <div role="alert" className="text-sm text-destructive">
                {err}
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setOpen(false)} className={buttonClass("secondary")}>
              Cancel
            </button>
            <button type="button" onClick={save} disabled={busy} className={buttonClass("primary")}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Create task
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
