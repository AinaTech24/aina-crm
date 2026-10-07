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
 *   - `menuItem`: one labelled row ("Delete client") for a record's More menu
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MoreHorizontal, Pencil, Trash2, Loader2, type LucideIcon } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { MENU_ITEM_DANGER } from "@/components/ui/menu-item-class";

export function RowActions({
  editHref,
  deleteUrl,
  itemLabel = "item",
  itemName,
  verb = "Delete",
  permanent = false,
  onDeleted,
  redirectTo,
  inline = false,
  menuItem = false,
  deleteIcon: DeleteIcon = Trash2,
  items,
}: {
  editHref?: string;
  deleteUrl?: string;
  itemLabel?: string;
  itemName?: string;
  verb?: string;
  permanent?: boolean;
  onDeleted?: () => void;
  /** When set, navigate here after a successful delete (e.g. back to the list
   *  from a detail page) instead of refreshing the current — now gone — record. */
  redirectTo?: string;
  /** Render Edit + Delete as two side-by-side icon buttons instead of a "⋯" menu. */
  inline?: boolean;
  /** Render the destructive action as one labelled row inside a record's More menu. */
  menuItem?: boolean;
  /** Icon for the destructive action in inline mode (e.g. Archive, Ban). Defaults to Trash2. */
  deleteIcon?: LucideIcon;
  /** Extra navigation entries shown at the top of the ⋯ menu (menu mode only). */
  items?: { label: string; href: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<CSSProperties | null>(null);

  // The ⋯ menu floats on <body> beside its button. Drawn inside the row it was
  // clipped by the table's scroll box — on a one-row list only a sliver of
  // "Edit" showed and Close was out of reach (Service Requests, 2026-10-07).
  // It opens upward when there is no room below, and closes when the page
  // scrolls or resizes rather than drifting away from its button.
  function toggleMenu() {
    if (open) return setOpen(false);
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) {
      const rows = (items?.length ?? 0) + (editHref ? 1 : 0) + (deleteUrl ? 1 : 0);
      const height = rows * 34 + 16;
      const right = Math.max(8, window.innerWidth - r.right);
      setMenuPos(
        r.bottom + 4 + height > window.innerHeight && r.top > height
          ? { position: "fixed", right, bottom: window.innerHeight - r.top + 4 }
          : { position: "fixed", right, top: r.bottom + 4 },
      );
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
      setConfirmOpen(false);
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", `${verb} failed`);
    } finally {
      setBusy(false);
    }
  }

  // Menu-row variant — "Delete client" as the last row of a record's More
  // menu. Same confirm and toasts; the label says what is being deleted, which
  // a bare red bin at the bottom of a menu did not.
  if (menuItem) {
    if (!deleteUrl) return null;
    return (
      <>
        <button type="button" onClick={() => setConfirmOpen(true)} disabled={busy} className={MENU_ITEM_DANGER}>
          {busy ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <DeleteIcon className="size-4 shrink-0" />}
          {verb} {itemLabel}
        </button>
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
      </>
    );
  }

  // Inline variant — two explicit icon buttons (no dropdown). The ConfirmDialog
  // still gates the delete; success/failure still go through the toast system.
  if (inline) {
    return (
      <div className="inline-flex items-center justify-end gap-1" data-no-row-nav>
        {editHref && (
          <Link
            href={editHref}
            className="btn-icon"
            aria-label={`Edit ${itemLabel}`}
            title="Edit"
          >
            <Pencil className="size-4" />
          </Link>
        )}
        {deleteUrl && (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={busy}
            className="rounded-md p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-50"
            aria-label={`${verb} ${itemLabel}`}
            title={verb}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <DeleteIcon className="size-4" />}
          </button>
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

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleMenu}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="btn-icon text-muted-foreground hover:text-foreground"
        aria-label={`Actions for ${itemLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
      </button>
      {open && menuPos && typeof document !== "undefined" && createPortal(
        <div
          role="menu"
          style={menuPos}
          // A portal still bubbles React events through the row; a click here
          // must not also count as a click on the row (which opens the record).
          onClick={(e) => e.stopPropagation()}
          className="z-50 w-48 rounded-lg border bg-popover shadow-lg py-1 text-sm animate-fade-in"
          data-no-row-nav
        >
          {items?.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent"
              onMouseDown={(e) => e.preventDefault()}
            >
              {it.label}
            </Link>
          ))}
          {items && items.length > 0 && (editHref || deleteUrl) && <div className="my-1 border-t border-border" />}
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
              className="w-full text-left flex items-center gap-2 px-3 py-1.5 hover:bg-destructive/10 text-destructive disabled:opacity-50"
            >
              <DeleteIcon className="size-3.5" /> {verb}
            </button>
          )}
        </div>,
        document.body,
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
