"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Loader2 } from "lucide-react";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";

/**
 * Re-grade every active client's service tier (A/B/C) from AUM and SIP.
 * Lives in the Clients page's More menu; the result is a toast, so nothing
 * floats over the menu it was launched from.
 */
export function RecomputeTiersButton({ triggerClassName }: { triggerClassName?: string } = {}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function go() {
    if (!(await confirmDialog({ title: "Recompute service tiers for every active client?", message: "Each client is re-graded A, B or C from their current AUM and SIP. Tiers you set by hand will be overwritten.", confirmLabel: "Recompute" }))) return;
    setBusy(true);
    try {
      const res = await fetch("/api/investors/recompute-tiers", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(j.error ?? `That didn't go through (${res.status}).`, "Tiers not recomputed");
        return;
      }
      const c = (j.counts ?? {}) as Record<string, number>;
      notify.success(
        `Tier A ${c.A ?? 0} · Tier B ${c.B ?? 0} · Tier C ${c.C ?? 0}`,
        `${Number(j.recomputed ?? 0).toLocaleString("en-IN")} clients re-graded`,
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      className={triggerClassName ?? "rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent disabled:opacity-50"}
      title="Top 20% by AUM → A (quarterly), next 30% → B (half-yearly), rest → C (annual)"
    >
      {busy ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <Layers className="size-4 shrink-0 text-muted-foreground" />}
      {busy ? "Recomputing…" : "Recompute service tiers"}
    </button>
  );
}
