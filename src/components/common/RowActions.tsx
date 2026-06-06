"use client";

/**
 * Reusable Edit / Delete actions menu for list rows.
 *
 *   <RowActions
 *      editHref="/dashboard/leads/<id>"
 *      deleteUrl="/api/leads/<id>"
 *      itemLabel="lead"
 *      itemName={lead.name}
 *   />
 *
 * Edit is a plain link to the detail/edit page. Delete posts a DELETE to the
 * resource URL after a branded ConfirmDialog (no native confirm()); success +
 * failure are surfaced via the toast system (no native alert()).
 *
 * Variants:
 *   - `permanent`: if true, says "Permanently delete" (for hard delete paths)
 *   - `verb`: override "Delete" label (e.g. "Archive", "Deactivate")
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MoreHorizontal, Pencil, Trash2, Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

export function RowActions({
  editHref,
  deleteUrl,
  itemLabel = "item",
  itemName,
  verb = "Delete",
  permanent = false,
  onDeleted,
}: {
  editHref?: string;
  deleteUrl?: string;
  itemLabel?: string;
  itemName?: string;
  verb?: string;
  permanent?: boolean;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const subject = itemName ? `"${itemName}"` : itemLabel;
  const past = verb.endsWith("e") ? `${verb}d` : `${verb}ed`; // Delete→Deleted, Archive→Archived, Lock→Locked
  const confirmMessage = permanent
    ? `Permanently delete ${subject}? This cannot be undone.`
    : `${verb} ${subject}?`;

  async function doDelete() {
    if (!deleteUrl) return;
    setBusy(true);
    try {
      const res = await fetch(deleteUrl, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? `Request failed (HTTP ${res.status})`, `${verb} failed`);
        return;
      }
      toast.success(`${past} ${subject}`);
      onDeleted?.();
      router.refresh();
      setConfirmOpen(false);
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", `${verb} failed`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="rounded-md p-1 hover:bg-accent text-muted-foreground hover:text-foreground"
        aria-label={`Actions for ${itemLabel}`}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 w-44 rounded-md border bg-popover shadow-md py-1 text-sm">
          {editHref && (
            <Link
              href={editHref}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent"
              onMouseDown={(e) => e.preventDefault()}
            >
              <Pencil className="size-3.5" /> Edit
            </Link>
          )}
          {deleteUrl && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false);
                setConfirmOpen(true);
              }}
              disabled={busy}
              className="w-full text-left flex items-center gap-2 px-3 py-1.5 hover:bg-rose-50 text-rose-700 disabled:opacity-50"
            >
              <Trash2 className="size-3.5" /> {verb}
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`${verb} ${itemLabel}?`}
        message={confirmMessage}
        confirmLabel={verb}
        tone="danger"
        busy={busy}
        onConfirm={doDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
