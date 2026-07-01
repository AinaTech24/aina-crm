"use client";

/**
 * Client-side bits of the RTA imports page — the upload button + the
 * dialog. Kept separate so the server page stays a pure React Server
 * Component.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, RefreshCw, Loader2 } from "lucide-react";
import { UploadDialog } from "@/components/rta/UploadDialog";

export function RtaUploadButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary text-sm">
        <Upload className="size-4" /> Upload RTA file
      </button>
      <UploadDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * Mailback sync button — the PRIMARY (automated) import path. Kicks off an
 * API-pull sync, polls the resulting import row to completion, then refreshes
 * the dashboard. (Manual upload is the backfill fallback.)
 */
export function FpSyncButton() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setSyncing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/integrations/fp/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "Sync could not be started");
        return;
      }
      const importId = data.importId as string;
      const startedAt = Date.now();
      while (Date.now() - startedAt < 5 * 60 * 1000) {
        await new Promise((r) => setTimeout(r, 2000));
        let row: any = null;
        try {
          const sres = await fetch(`/api/rta-imports/${importId}`, { cache: "no-store" });
          if (sres.ok) row = await sres.json();
        } catch {
          /* transient — keep polling */
        }
        const st = row?.status as string | undefined;
        if (st === "completed" || st === "partial" || st === "failed" || st === "rejected") {
          setMsg(row?.remarks ?? `Sync ${st}`);
          router.refresh();
          break;
        }
      }
    } catch (e: any) {
      setMsg(e?.message ?? "Network error");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={run} disabled={syncing} className="btn-secondary text-sm disabled:opacity-50">
        {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        {syncing ? "Syncing mailback…" : "Sync mailback"}
      </button>
      {msg && (
        <span className="text-[11px] text-muted-foreground max-w-xs text-right truncate" title={msg}>
          {msg}
        </span>
      )}
    </div>
  );
}
