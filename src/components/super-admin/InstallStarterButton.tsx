"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wand2 } from "lucide-react";

/** Adds the starter module guides as drafts. Repeating it only adds what is missing. */
export function InstallStarterButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/super-admin/kb-structure/starter", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `Failed (${res.status})`);
      setMsg(
        j.guidesCreated > 0
          ? `Added ${j.guidesCreated} draft guide${j.guidesCreated === 1 ? "" : "s"}. Open each, add screenshots and publish.`
          : "Nothing new to add — every starter guide is already here."
      );
      router.refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={run} disabled={busy} className="rounded-md border px-3 py-1.5 text-sm inline-flex items-center gap-1.5 hover:bg-accent disabled:opacity-50">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />} Add starter guides
      </button>
      {msg && <span className="text-xs text-muted-foreground max-w-xs">{msg}</span>}
    </div>
  );
}
