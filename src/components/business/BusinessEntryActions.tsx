"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Mail, Trash2, Loader2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export function BusinessEntryActions({ id, status, hasEmail }: { id: string; status: string; hasEmail: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<"email" | "delete" | "confirm" | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  async function sendEmail() {
    if (!hasEmail) { toast.warning("This client has no email on file.", "Can't email"); return; }
    setBusy("email");
    try {
      const res = await fetch(`/api/business-entries/${id}/email`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (res.ok) { toast.success("Confirmation emailed to the client"); router.refresh(); }
      else toast.error(j.error ?? "Could not send email", "Email failed");
    } finally { setBusy(null); }
  }

  async function setConfirmed() {
    setBusy("confirm");
    try {
      const res = await fetch(`/api/business-entries/${id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "confirmed" }),
      });
      if (res.ok) { toast.success("Marked confirmed"); router.refresh(); }
      else toast.error("Could not update", "Failed");
    } finally { setBusy(null); }
  }

  /** mode "cancel": mark cancelled and stay on the record; "delete": remove it for good and go back to the list. */
  async function remove(mode: "cancel" | "delete") {
    setBusy("delete");
    try {
      const res = await fetch(`/api/business-entries/${id}?mode=${mode}`, { method: "DELETE" });
      if (res.ok) {
        if (mode === "delete") { toast.success("Entry deleted"); router.push("/dashboard/business-entries"); }
        else toast.success("Entry marked cancelled — it stays on record");
        router.refresh();
      } else {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? (mode === "delete" ? "Could not delete" : "Could not cancel"), mode === "delete" ? "Delete failed" : "Cancel failed");
      }
    } finally { setBusy(null); setConfirmDel(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`/dashboard/business-entries/${id}/edit`} className="btn-secondary text-sm inline-flex items-center gap-1.5">
        <Pencil className="size-4" /> Edit
      </Link>
      {status === "draft" && (
        <button onClick={setConfirmed} disabled={busy === "confirm"} className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
          {busy === "confirm" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Mark confirmed
        </button>
      )}
      {/* A cancelled entry is not business: emailing it would mark it "emailed" and count it again. */}
      {status !== "cancelled" && (
        <button onClick={sendEmail} disabled={busy === "email"} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50" title={hasEmail ? "Email the client a summary" : "Client has no email on file"}>
          {busy === "email" ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />} Email client
        </button>
      )}
      <button onClick={() => setConfirmDel(true)} disabled={busy === "delete"} className="size-9 grid place-items-center rounded-lg border border-border text-muted-foreground hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-colors disabled:opacity-50" title="Delete">
        <Trash2 className="size-4" />
      </button>
      <ConfirmDialog
        open={confirmDel}
        title="Delete business entry?"
        message={
          status === "cancelled"
            ? "This entry is already cancelled. Delete removes it and its scheme lines for good and cannot be undone."
            : "Mark cancelled keeps the entry on record but it stops counting as business. Delete removes it and its scheme lines for good and cannot be undone."
        }
        confirmLabel="Delete"
        tone="danger"
        busy={busy === "delete"}
        secondary={status === "cancelled" ? undefined : { label: "Mark cancelled", onClick: () => remove("cancel") }}
        onConfirm={() => remove("delete")}
        onCancel={() => setConfirmDel(false)}
      />
    </div>
  );
}
