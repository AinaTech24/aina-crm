"use client";

/**
 * Row actions on Manage dashboards: Share, Clone, Delete, Restore. Share opens
 * the same dialog as the dashboard's own ⋯ menu (D8: "from ⋯ > Share, and
 * from Manage dashboards"). A role dashboard that is a full page of its own
 * has no cards to copy, so it has no Clone.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button-class";
import { notify } from "@/components/ui/Toast";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { ShareDialog, type ShareNames, type ShareRowDto } from "./ShareDialog";

export function ManageRowActions({
  id,
  name,
  deleted,
  canDelete,
  canClone = true,
  share,
}: {
  id: string;
  name: string;
  deleted: boolean;
  canDelete: boolean;
  canClone?: boolean;
  /** Present when this viewer may change whom it is shared with. */
  share?: { shares: ShareRowDto[]; locked: boolean; audience: string | null; names: ShareNames; onlyBranch: string | null };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);

  async function call(url: string, method: string, ok: string) {
    setBusy(true);
    try {
      const res = await fetch(url, { method });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Something went wrong");
      notify.success(ok);
      return body as { id?: string };
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Something went wrong");
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (deleted) {
    return canDelete ? (
      <button
        type="button"
        className={buttonClass("secondary", "sm")}
        disabled={busy}
        onClick={async () => {
          if (await call(`/api/dashboards/${id}/restore`, "POST", "Dashboard restored")) router.refresh();
        }}
      >
        Restore
      </button>
    ) : null;
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {share && (
        <button type="button" className={buttonClass("ghost", "sm")} disabled={busy} onClick={() => setSharing(true)}>
          Share
        </button>
      )}
      {sharing && share && (
        <ShareDialog
          dashboardId={id}
          name={name}
          shares={share.shares}
          locked={share.locked}
          names={share.names}
          onlyBranch={share.onlyBranch}
          audience={share.audience}
          onClose={() => setSharing(false)}
        />
      )}
      {canClone && (
        <button
          type="button"
          className={buttonClass("ghost", "sm")}
          disabled={busy}
          onClick={async () => {
            const r = await call(`/api/dashboards/${id}/clone`, "POST", "Dashboard cloned");
            if (r?.id) router.push(`/dashboard/${r.id}/edit`);
          }}
        >
          Clone
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          className={buttonClass("ghost", "sm")}
          disabled={busy}
          onClick={async () => {
            const ok = await confirmDialog({
              title: `Delete “${name}”?`,
              message: "It moves to Recently deleted, where it can be restored for 30 days.",
              confirmLabel: "Delete",
              tone: "danger",
            });
            if (ok && (await call(`/api/dashboards/${id}`, "DELETE", "Dashboard deleted"))) router.refresh();
          }}
        >
          Delete
        </button>
      )}
    </div>
  );
}
