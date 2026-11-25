"use client";

/**
 * Delete one opportunity from its own page — the trash button and confirmation Business Entries has
 * on an entry. Removes it for good (DELETE /api/opportunities/[id]); its open follow-ups end and what
 * was removed stays in the audit trail. Goes back to the Opportunities list afterwards.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

export function DeleteOpportunityButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/opportunities/${id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? "Could not delete", "Delete failed");
        return;
      }
      toast.success("Opportunity deleted");
      router.push("/dashboard/opportunities");
      router.refresh();
    } catch {
      toast.error("Network error. Try again.", "Delete failed");
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        className="size-9 grid place-items-center rounded-lg border border-border text-muted-foreground hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-colors disabled:opacity-50"
        title="Delete"
        aria-label="Delete opportunity"
      >
        <Trash2 className="size-4" />
      </button>
      <ConfirmDialog
        open={open}
        title="Delete opportunity?"
        message={`${label}. Delete removes it and its journey for good and cannot be undone. Its open follow-up tasks are cancelled; a proposal already made for it stays.`}
        confirmLabel="Delete"
        tone="danger"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
