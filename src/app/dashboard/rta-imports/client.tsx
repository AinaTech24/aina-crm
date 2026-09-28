"use client";

/**
 * Client-side controls for the RTA imports page — manual file upload dialog,
 * automated IMAP catch-all mailbox sync button, and FP sync trigger.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, RefreshCw, Loader2, Mail, CheckCircle2 } from "lucide-react";
import { UploadDialog } from "@/components/rta/UploadDialog";
import { buttonClass } from "@/components/ui/button-class";

/** The page's one primary action. */
export function RtaUploadButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("primary")}>
        <Upload className="size-4" /> Upload file
      </button>
      <UploadDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** A "What to do next" step that opens the upload dialog on its file type. */
export function RtaUploadStep({ kind, children }: { kind: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-left font-medium text-foreground hover:underline">
        {children}
      </button>
      <UploadDialog open={open} onClose={() => setOpen(false)} defaultKind={kind} />
    </>
  );
}

/**
 * On-demand RTA Mailbox Poller trigger — polls the catch-all mailbox
 * for newly arrived CAMS / KFintech emails and processes attachments immediately.
 */
export function RtaMailboxSyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function syncMailbox() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/rta/sync-mailbox", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(j.error || "Mailbox sync failed");
      } else {
        setMsg(j.message || "Mailbox checked successfully");
        router.refresh();
      }
    } catch {
      setMsg("Network error while checking mailbox");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={syncMailbox}
        disabled={busy}
        className={buttonClass("secondary")}
        title="Check catch-all mailbox for new CAMS & KFintech mailbacks"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
        <span>{busy ? "Checking Mailbox…" : "Sync Mailbox Now"}</span>
      </button>
      {msg && (
        <span className="text-2xs text-muted-foreground max-w-xs text-right truncate" title={msg}>
          {msg}
        </span>
      )}
    </div>
  );
}
