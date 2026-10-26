"use client";

/** "Start from the standard MFD positions" — seeds the default positions, holders and process owners. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { notify } from "@/components/ui/Toast";

export function PositionSeedButton({ label = "Start from the standard MFD positions" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function seed() {
    setBusy(true);
    try {
      const r = await fetch("/api/practice/positions/seed", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { notify.error(j.error ?? "Could not set up the positions"); return; }
      notify.success(
        `${j.positionsCreated ?? 0} positions added, ${j.holdersAdded ?? 0} holders suggested from roles. Check each one.`,
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return <Button variant="primary" onClick={seed} loading={busy}>{label}</Button>;
}
