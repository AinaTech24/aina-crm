"use client";

/**
 * "Clean up N empty families" — deletes the families with no client linked,
 * after a confirm that says exactly what goes and what stays. See
 * POST /api/families/cleanup-empty.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { buttonClass } from "@/components/ui/button-class";
import { notify } from "@/components/ui/Toast";

export function CleanupEmptyFamilies({ count }: { count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    const ok = await confirmDialog({
      title: `Delete ${count.toLocaleString("en-IN")} empty ${count === 1 ? "family" : "families"}?`,
      message:
        "These families have no clients linked — no holdings, SIPs or members. Deleting is permanent; each one is recorded in the audit log. Families that have clients but no AUM yet are not touched.",
      confirmLabel: "Delete empty families",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/families/cleanup-empty", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(j.error ?? "That didn't go through. Nothing was deleted.", "Clean-up failed");
        return;
      }
      // A toast, not inline text: once the refresh lands the count is 0 and
      // this button (with anything rendered beside it) unmounts.
      notify.success(
        `Deleted ${j.deleted} empty ${j.deleted === 1 ? "family" : "families"}.` +
          (j.kept ? ` ${j.kept} kept: a client was linked meanwhile or another record still uses them.` : "")
      );
      router.refresh();
    } catch {
      notify.error("Network error. Nothing was deleted.", "Clean-up failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={run} disabled={busy || count === 0} className={buttonClass("secondary", "sm")}>
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
      Clean up {count.toLocaleString("en-IN")} empty {count === 1 ? "family" : "families"}
    </button>
  );
}
