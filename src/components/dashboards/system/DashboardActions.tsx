"use client";

/**
 * The dashboard's ⋯ menu (D7): Edit layout · Clone · Share · Set as my default
 * · Export PDF · Delete. Edit, Share and Delete are hidden when the dashboard
 * is locked for this viewer; Clone is there for every dashboard made of cards
 * (a role dashboard that is a full page of its own has none to copy).
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { notify } from "@/components/ui/Toast";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { ShareDialog, type ShareNames, type ShareRowDto } from "./ShareDialog";

export function DashboardActions({
  dashboardId,
  name,
  canEdit,
  canShare,
  canDelete = canShare,
  canClone = true,
  isDefault,
  shares,
  locked,
  shareNames,
  onlyBranch,
  audience = null,
}: {
  dashboardId: string;
  name: string;
  canEdit: boolean;
  canShare: boolean;
  /** Delete — never a role dashboard, which can still be shared. */
  canDelete?: boolean;
  canClone?: boolean;
  /** A role dashboard: the roles it is for, in words (the share dialog's default audience). */
  audience?: string | null;
  isDefault: boolean;
  shares: ShareRowDto[];
  locked: boolean;
  shareNames: ShareNames | null;
  onlyBranch: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function call(url: string, init: RequestInit, ok: string) {
    const res = await fetch(url, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? "Something went wrong");
    notify.success(ok);
    return body as { id?: string };
  }

  const item = "block w-full text-left px-3 py-2 text-sm rounded-md hover:bg-secondary";

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn-icon" aria-label="Dashboard actions" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 w-52 rounded-lg border border-border bg-card p-1 shadow-lg">
          {canEdit && (
            <button type="button" className={item} onClick={() => router.push(`/dashboard/${dashboardId}/edit`)}>
              Edit layout
            </button>
          )}
          {canClone && (
            <button
              type="button"
              className={item}
              onClick={async () => {
                setOpen(false);
                try {
                  const r = await call(`/api/dashboards/${dashboardId}/clone`, { method: "POST" }, "Dashboard cloned");
                  if (r.id) router.push(`/dashboard/${r.id}/edit`);
                } catch (e) {
                  notify.error(e instanceof Error ? e.message : "Could not clone");
                }
              }}
            >
              Clone
            </button>
          )}
          {canShare && shareNames && (
            <button type="button" className={item} onClick={() => { setOpen(false); setSharing(true); }}>
              Share
            </button>
          )}
          {!isDefault && (
            <button
              type="button"
              className={item}
              onClick={async () => {
                setOpen(false);
                try {
                  await call(`/api/dashboards/${dashboardId}/prefs`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ default: true }),
                  }, "Set as your default dashboard");
                  router.refresh();
                } catch (e) {
                  notify.error(e instanceof Error ? e.message : "Could not set the default");
                }
              }}
            >
              Set as my default
            </button>
          )}
          <button type="button" className={item} onClick={() => { setOpen(false); setTimeout(() => window.print(), 50); }}>
            Export PDF
          </button>
          {canDelete && (
            <button
              type="button"
              className={`${item} text-rose-700`}
              onClick={async () => {
                setOpen(false);
                const ok = await confirmDialog({
                  title: `Delete “${name}”?`,
                  message: "It moves to Recently deleted, where it can be restored for 30 days.",
                  confirmLabel: "Delete",
                  tone: "danger",
                });
                if (!ok) return;
                try {
                  await call(`/api/dashboards/${dashboardId}`, { method: "DELETE" }, "Dashboard deleted");
                  router.push("/dashboard");
                } catch (e) {
                  notify.error(e instanceof Error ? e.message : "Could not delete");
                }
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
      {sharing && shareNames && (
        <ShareDialog
          dashboardId={dashboardId}
          name={name}
          shares={shares}
          locked={locked}
          names={shareNames}
          onlyBranch={onlyBranch}
          audience={audience}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  );
}
