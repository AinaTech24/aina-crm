"use client";

/**
 * Delete a package from the AINA packages grid. The package card is itself a
 * <Link>, so this button is rendered as an absolutely-positioned overlay
 * *outside* the anchor (see packages/page.tsx) to avoid nesting a button in an
 * anchor. Confirms via ConfirmDialog; surfaces 409 "package in use" via toast.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

export function DeletePackageButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function doDelete() {
    setBusy(true);
    try {
      const res = await fetch(`/api/super-admin/packages/${id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? "Could not delete package", "Delete failed");
        setOpen(false);
        return;
      }
      toast.success(`“${name}” deleted`);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Network error — please try again", "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Delete ${name}`}
        title="Delete package"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className="size-7 grid place-items-center rounded-md border border-border bg-card text-muted-foreground hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-colors"
      >
        <Trash2 className="size-3.5" />
      </button>
      <ConfirmDialog
        open={open}
        title={`Delete “${name}”?`}
        message="This permanently removes the package. Tenants currently subscribed to it will block the delete — disable the package instead if it's in use."
        confirmLabel="Delete package"
        tone="danger"
        busy={busy}
        onConfirm={doDelete}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
