"use client";

/**
 * "Mark as exited" / "Reactivate client" — the client page's More menu.
 *
 * A client with no business today is EXITED, not deleted (the firm's request,
 * 2026-10-15): the record keeps its history, family, RM, notes and documents,
 * leaves the client list and the dashboard counts, and comes back by itself
 * when the registrar shows new money (lib/investors/client-return.ts) — or
 * here, with one click.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, RotateCcw } from "lucide-react";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";
import { MENU_ICON, MENU_ITEM } from "@/components/ui/menu-item-class";

export function ClientExitButton({ investorId, name, status }: { investorId: string; name: string; status: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const exited = status === "exited" || status === "closed";

  async function run() {
    const ok = await confirmDialog(
      exited
        ? { title: `Reactivate ${name}?`, message: "The client goes back to Active, in the client list and the dashboards.", confirmLabel: "Reactivate" }
        : {
            title: `Mark ${name} as exited?`,
            message:
              "The client leaves the client list and the dashboard counts, but nothing is deleted — history, family, RM, notes and documents stay. " +
              "When they invest again the CRM makes them Active by itself.",
            confirmLabel: "Mark as exited",
          },
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/investors/${investorId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: exited ? "active" : "exited" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        notify.error(j.error ?? `That didn't go through (${res.status}).`);
        return;
      }
      notify.success(exited ? `${name} is Active again` : `${name} marked as exited`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={run} disabled={busy} className={MENU_ITEM}>
      {exited ? <RotateCcw className={MENU_ICON} aria-hidden /> : <LogOut className={MENU_ICON} aria-hidden />}
      {exited ? "Reactivate client" : "Mark as exited"}
    </button>
  );
}
