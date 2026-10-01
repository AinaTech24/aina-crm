"use client";

/**
 * Delete a meeting that was entered by mistake (DELETE
 * /api/review-meetings/[id]/purge). Asks first; the server refuses a meeting
 * with notes, an outcome or action items — those can only be cancelled — and
 * that reason is shown as it comes back.
 *
 * `variant="icon"` is the list row's trash icon; `"button"` is the meeting
 * page's labelled button, which returns to the meetings list afterwards.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { buttonClass } from "@/components/ui/button-class";

export function DeleteMeetingButton({
  id,
  variant = "icon",
  className = "",
}: {
  id: string;
  variant?: "icon" | "button";
  className?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function doDelete() {
    setBusy(true);
    try {
      const res = await fetch(`/api/review-meetings/${id}/purge`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't delete the meeting");
      toast.success("Meeting deleted");
      setConfirm(false);
      if (variant === "button") router.push("/dashboard/review-meetings");
      else router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't delete the meeting", "Not deleted");
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setConfirm(true); }}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
          title="Delete meeting (entered by mistake)"
          aria-label="Delete meeting"
          data-no-row-nav
        >
          <Trash2 className="size-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          disabled={busy}
          className={buttonClass("ghost", "sm", `gap-1.5 text-rose-600 hover:bg-rose-50 ${className}`)}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Delete
        </button>
      )}
      <ConfirmDialog
        open={confirm}
        title="Delete this meeting?"
        message="Use this for a meeting entered by mistake. It is removed from every list and its reminder is cancelled. A meeting that has notes, an outcome or action items can only be cancelled."
        confirmLabel="Delete meeting"
        cancelLabel="Keep"
        tone="danger"
        busy={busy}
        onConfirm={doDelete}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
