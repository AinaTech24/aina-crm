"use client";

/**
 * Active / Inactive — a visible button in the client page's header.
 *
 * Inactive is for a client who has stopped transacting (and, with a date of
 * demise, a client who has died): marking one stops their live SIPs and cancels
 * orders still pending (lib/investors/demise.ts). Processed transactions are
 * the registrar's history and stay. Making the client Active again does not
 * restart a stopped SIP — that is a fresh registration at the registrar.
 * Exited / closed clients have their own "Reactivate client" in More.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";

export function ClientActiveToggle({ investorId, name, status }: { investorId: string; name: string; status: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (status === "exited" || status === "closed") return null;
  const inactive = status === "inactive";

  async function run() {
    const ok = await confirmDialog(
      inactive
        ? {
            title: `Mark ${name} as Active?`,
            message: "The client goes back to Active. SIPs that were stopped stay stopped — a stopped SIP is restarted by a new registration.",
            confirmLabel: "Mark active",
          }
        : {
            title: `Mark ${name} as Inactive?`,
            message:
              "Their active SIPs will be stopped and orders still pending will be cancelled in the CRM. " +
              "Processed transactions are kept as history. Use this when the client has stopped investing or has passed away (record the date of death on their details).",
            confirmLabel: "Mark inactive",
          },
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/investors/${investorId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: inactive ? "active" : "inactive" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(j.error ?? `That didn't go through (${res.status}).`);
        return;
      }
      const d = j.demise as { sipsStopped: number; ordersCancelled: number } | undefined;
      notify.success(
        inactive
          ? `${name} is Active again`
          : `${name} marked Inactive${d ? ` — ${d.sipsStopped} SIP${d.sipsStopped === 1 ? "" : "s"} stopped, ${d.ordersCancelled} pending order${d.ordersCancelled === 1 ? "" : "s"} cancelled` : ""}`,
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" loading={busy} onClick={run}
      icon={inactive ? <UserCheck className="size-4" aria-hidden /> : <UserX className="size-4" aria-hidden />}>
      {inactive ? "Mark active" : "Mark inactive"}
    </Button>
  );
}
