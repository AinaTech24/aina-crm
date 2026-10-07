"use client";

/**
 * Status-transition buttons for the Proposal detail page.
 *
 *   - "Mark as Sent"   → status='sent', stamps sentAt
 *   - "Mark Accepted"  → status='accepted', stamps acceptedAt
 *   - "Mark Rejected"  → status='rejected', stamps rejectedAt + reason
 *   - "Edit"           → the builder, while it is still a draft
 *   - "Revise"         → a new version once it has been sent; the sent one is
 *                        kept as the record of what the client saw
 *
 * `group` splits them on the page: "manage" is the record (Edit, Revise),
 * "decide" the client's answer (Mark as Sent / Accepted / Rejected).
 *
 * Server enforces the same transitions through PATCH /api/proposals/[id].
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Send, CheckCircle2, XCircle, Loader2, Pencil, GitBranch } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { promptDialog } from "@/components/ui/ConfirmProvider";

export function ProposalStatusActions({
  id,
  status,
  version = 1,
  group = "all",
}: {
  id: string;
  status: string;
  version?: number;
  group?: "manage" | "decide" | "all";
}) {
  const manage = group !== "decide";
  const decide = group !== "manage";
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const LABEL: Record<string, string> = { sent: "marked as sent", accepted: "marked accepted", rejected: "marked rejected" };
  async function transition(next: string, extra: any = {}) {
    setBusy(next);
    try {
      const res = await fetch(`/api/proposals/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next, ...extra }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? `Failed (${res.status})`, "Couldn't update proposal");
        return;
      }
      toast.success(`Proposal ${LABEL[next] ?? next}.`);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Couldn't update proposal");
    } finally {
      setBusy(null);
    }
  }

  const canSend = status === "draft" || status === "ready";
  const canEdit = canSend;
  // A client who asked for changes may still agree by phone — or say no.
  const canAccept = status === "sent" || status === "viewed" || status === "changes_requested";
  const canReject = canAccept;
  const canRevise = ["sent", "viewed", "changes_requested", "rejected", "expired"].includes(status);
  // The client asked for a change: revising is what the RM came here to do.
  const askedForChange = status === "changes_requested";

  async function revise() {
    setBusy("revise");
    try {
      const res = await fetch(`/api/proposals/${id}/revise`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Failed (${res.status})`, "Couldn't revise");
        return;
      }
      toast.success(`Version ${j.version} created — the old link is withdrawn.`);
      router.push(`/dashboard/proposals/${j.id}/edit`);
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Couldn't revise");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {manage && canEdit && (
        <Link href={`/dashboard/proposals/${id}/edit`} className="btn-secondary text-xs">
          <Pencil className="size-3.5" /> Edit
        </Link>
      )}
      {manage && canRevise && (
        <button
          onClick={revise}
          disabled={!!busy}
          className={`${askedForChange ? "btn-primary" : "btn-secondary"} text-xs`}
          title="The sent version is kept as the record of what the client saw"
        >
          {busy === "revise" ? <Loader2 className="size-3.5 animate-spin" /> : <GitBranch className="size-3.5" />}
          Revise (creates v{version + 1})
        </button>
      )}
      {decide && canSend && (
        <button
          onClick={() => transition("sent")}
          disabled={!!busy}
          // Sending it from here is the main step; this records a send made elsewhere.
          className="btn-secondary text-xs"
          title="Sent it another way (in person, your own email)? Record it as sent."
        >
          {busy === "sent" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          Mark as Sent
        </button>
      )}
      {decide && canAccept && (
        <button
          onClick={() => transition("accepted")}
          disabled={!!busy}
          className={`${askedForChange ? "btn-secondary" : "btn-primary"} text-xs`}
          style={askedForChange ? undefined : { backgroundImage: "linear-gradient(135deg,hsl(165 70% 35%),hsl(165 75% 28%))" }}
        >
          {busy === "accepted" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="size-3.5" />
          )}
          Mark Accepted
        </button>
      )}
      {decide && canReject && (
        <button
          onClick={async () => {
            const reason = await promptDialog({
              title: "Mark this proposal rejected?",
              message: "A reason helps the next person picking up this client.",
              label: "Reason for rejection",
              placeholder: "e.g. went with another advisor",
              confirmLabel: "Mark rejected",
              multiline: true,
              optional: true,
              maxLength: 500,
            });
            if (reason === null) return;
            void transition("rejected", { rejectionReason: reason });
          }}
          disabled={!!busy}
          className="btn-secondary text-xs"
        >
          {busy === "rejected" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <XCircle className="size-3.5" />
          )}
          Mark Rejected
        </button>
      )}
    </div>
  );
}
