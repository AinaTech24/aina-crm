"use client";

/**
 * Installs the starter operations manual (POST /api/practice/starter-manual)
 * and refreshes the SOP library.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { notify } from "@/components/ui/Toast";

export function StarterManualButton({ missing, partial }: { missing: number; partial: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function install() {
    setBusy(true);
    try {
      const r = await fetch("/api/practice/starter-manual", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        notify.error(j.error ?? "Could not add the operations manual");
        return;
      }
      notify.success(
        j.installed > 0
          ? `Added ${j.installed} SOP${j.installed === 1 ? "" : "s"} and call scripts. Edit them to fit your firm.`
          : "Your manual already has every starter SOP.",
      );
      router.refresh();
    } catch {
      notify.error("Could not add the operations manual");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="primary" loading={busy} icon={<BookOpen className="size-4" aria-hidden />} onClick={install}>
      {partial ? `Add the ${missing} missing` : "Add the standard manual"}
    </Button>
  );
}
