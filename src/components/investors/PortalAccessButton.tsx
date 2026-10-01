"use client";

import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Link2Off, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/Dialog";

type AccessStatus = { active: boolean; access?: { expiresAt: string; lastAccessedAt: string | null } | null };

export function PortalAccessButton({
  investorId, triggerClassName,
}: {
  investorId: string;
  /** Replaces the trigger's look — a record menu passes its row class. */
  triggerClassName?: string;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<AccessStatus>({ active: false });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    const response = await fetch(`/api/investors/${investorId}/portal-access`, { cache: "no-store" });
    if (response.ok) setStatus(await response.json());
  }

  useEffect(() => { void refresh(); }, [investorId]);

  async function createAndCopy() {
    setBusy(true);
    try {
      const response = await fetch(`/api/investors/${investorId}/portal-access`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresInDays: 30 }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not create portal link");
      await navigator.clipboard.writeText(body.accessUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast.success("Portal link copied", "The secure link expires in 30 days and replaces any older link.");
      await refresh();
    } catch (error) {
      toast.error("Portal link failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      const response = await fetch(`/api/investors/${investorId}/portal-access`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not revoke portal access");
      setStatus({ active: false });
      toast.success("Portal access revoked");
    } catch (error) {
      toast.error("Revoke failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const expiry = status.access?.expiresAt
    ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(status.access.expiresAt))
    : null;

  return (
    <Dialog>
      <DialogTrigger className={triggerClassName ?? "btn-secondary text-xs"}>
        <KeyRound className="size-4 shrink-0 text-muted-foreground" /> Client portal link
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Client portal link</DialogTitle>
          <DialogDescription>
            {status.active
              ? `Active until ${expiry}. Creating a new link switches the old one off.`
              : "A private link that lets the client see their portfolio, goals and service requests. It expires in 30 days."}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={createAndCopy} disabled={busy} className="btn-primary flex-1 justify-center text-xs">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : status.active ? "Replace & copy" : "Create & copy"}
          </button>
          {status.active && (
            <button type="button" onClick={revoke} disabled={busy} className="btn-secondary px-2.5" title="Revoke portal link" aria-label="Revoke portal link">
              <Link2Off className="size-3.5" />
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

