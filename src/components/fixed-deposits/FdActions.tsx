"use client";

/** The FD detail page's actions: edit, renew, mark matured, close early, cancel, delete. */

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Pencil, RefreshCw, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { buttonClass } from "@/components/ui/button-class";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";

export function FdActions({ id, status, investorId }: { id: string; status: string; investorId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function patch(next: string, ok: string) {
    setBusy(next);
    try {
      const res = await fetch(`/api/fixed-deposits/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return notify.error(j.error ?? "Could not update");
      notify.success(ok);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function closeEarly() {
    const yes = await confirmDialog({
      title: "Close this FD early?",
      message: "Use this when the client broke the deposit before maturity. The maturity reminder is cancelled.",
      confirmLabel: "Close early",
    });
    if (yes) await patch("closed_early", "Marked closed early");
  }

  async function cancel() {
    const yes = await confirmDialog({ title: "Cancel this application?", message: "The deposit was never placed.", confirmLabel: "Cancel application", tone: "danger" });
    if (yes) await patch("cancelled", "Application cancelled");
  }

  async function remove() {
    const yes = await confirmDialog({
      title: "Delete this FD?",
      message: "Removes it from the client and the FD list, and cancels its maturity reminder. Use it for a record entered by mistake.",
      confirmLabel: "Delete", tone: "danger",
    });
    if (!yes) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/fixed-deposits/${id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return notify.error(j.error ?? "Could not delete");
      notify.success("FD deleted");
      router.push(`/dashboard/investors/${investorId}#fixed_deposits`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {status === "active" && (
        <Button variant="primary" loading={busy === "matured"} icon={<CheckCircle2 className="size-4" />}
          onClick={() => patch("matured", "Marked matured")}>
          Mark matured
        </Button>
      )}
      {status === "applied" && (
        <Button variant="primary" loading={busy === "active"} icon={<CheckCircle2 className="size-4" />}
          onClick={() => patch("active", "Receipt issued — FD is active")}>
          Receipt issued
        </Button>
      )}
      {(status === "active" || status === "matured") && (
        <Link href={`/dashboard/fixed-deposits/new?renew=${id}`} className={buttonClass("secondary")}>
          <RefreshCw className="size-4" aria-hidden /> Renew
        </Link>
      )}
      <Link href={`/dashboard/fixed-deposits/${id}/edit`} className={buttonClass("secondary")}>
        <Pencil className="size-4" aria-hidden /> Edit
      </Link>
      {status === "active" && (
        <Button variant="ghost" loading={busy === "closed_early"} onClick={closeEarly}>Close early</Button>
      )}
      {status === "applied" && (
        <Button variant="ghost" loading={busy === "cancelled"} icon={<XCircle className="size-4" />} onClick={cancel}>Cancel</Button>
      )}
      <Button variant="ghost" className="text-destructive" aria-label="Delete FD" loading={busy === "delete"}
        icon={<Trash2 className="size-4" />} onClick={remove} />
    </>
  );
}
