"use client";

/**
 * Recent RTA uploads table — Recent / Trash tabs, row selection + select-all,
 * and bulk Move-to-trash / Recover / Delete-permanently. Soft-deleted rows move
 * to Trash (recoverable); permanent delete removes the history row only (the
 * imported transactions/folios are untouched).
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Trash2, RotateCcw, RefreshCw, KeyRound, Download, Stethoscope } from "lucide-react";
import { RTA_FILE_TYPE_BY_KIND } from "@/lib/rta/file-types";
import { formatRelative, formatDate } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { confirmDialog, promptDialog } from "@/components/ui/ConfirmProvider";

type Row = {
  id: string;
  source: string;
  kind: string;
  period_start: string;
  period_end: string;
  file_name: string;
  status: string;
  rows_total: number | null;
  rows_imported: number | null;
  rows_skipped: number | null;
  rows_failed: number | null;
  created_at: string;
  uploaded_by_name: string | null;
  remarks: string | null;
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-emerald-50 text-emerald-700",
    partial: "bg-amber-50 text-amber-700",
    failed: "bg-rose-50 text-rose-700",
    rejected: "bg-secondary text-muted-foreground",
    parsing: "bg-blue-50 text-blue-700",
    uploaded: "bg-blue-50 text-blue-700",
  };
  return (
    <span className={`text-2xs px-2 py-0.5 rounded-full ${map[status] ?? "bg-secondary text-muted-foreground"}`}>
      {status}
    </span>
  );
}

/**
 * A row is worth re-importing when the file is still stored AND something was
 * left on the table: rows skipped (a transaction feed that outran its folio
 * master), a hard failure, or an archive that no saved password opened at the
 * time. A completed import purges its own file, so there is nothing to re-read.
 */
function canReimport(r: Row): boolean {
  if (r.status === "completed" || r.status === "uploaded" || r.status === "parsing") return false;
  return (
    (r.rows_skipped ?? 0) > 0 ||
    (r.rows_failed ?? 0) > 0 ||
    r.status === "failed" ||
    r.status === "rejected" ||
    r.status === "partial"
  );
}

function reimportHint(r: Row): string {
  if (r.status === "rejected") return "Re-import — retries with every password saved since";
  if ((r.rows_skipped ?? 0) > 0) return `Re-import — retries the ${r.rows_skipped} skipped row(s)`;
  return "Re-import this file";
}

export function RtaImportsTable({ recent, trashed }: { recent: Row[]; trashed: Row[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"recent" | "trash">("recent");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [purgeIds, setPurgeIds] = useState<string[] | null>(null); // non-null = confirm open
  const [reimporting, setReimporting] = useState<string | null>(null);
  const [reimportMsg, setReimportMsg] = useState<string | null>(null);

  /**
   * A file no saved password opens: the person who made the request knows its
   * password (a registrar lets one be set on every request, so they differ).
   * Type it once for this file, and say whether to keep it for the next ones.
   */
  async function reimportWithPassword(id: string, canSave: boolean) {
    const typed = await promptDialog({
      title: "This file's ZIP password",
      message: "The password you typed for this report when you requested it from the registrar. It is tried on this file only, unless you choose to keep it.",
      label: "ZIP password",
      secret: true,
      confirmLabel: "Open the file",
    });
    if (!typed) return;
    const save = canSave
      ? await confirmDialog({
          title: "Keep this password for the next files?",
          message: "Files from the registrar that use the same password will then import on their own.",
          confirmLabel: "Keep it",
          cancelLabel: "Only this file",
        })
      : false;
    await reimport(id, { password: typed, save });
  }

  /** "Why won't this open?" — what the archive is and whether any password passes its exact check. */
  const [diag, setDiag] = useState<Record<string, string>>({});
  const [diagBusy, setDiagBusy] = useState<string | null>(null);
  async function diagnose(id: string) {
    const typed = await promptDialog({
      title: "Check this file against a password",
      message: "Type the password you believe locks this file. It is only tested here — never saved or shown. The saved passwords are tested too.",
      label: "Password",
      secret: true,
      confirmLabel: "Check the file",
    });
    if (typed === null) return;
    setDiagBusy(id);
    try {
      const res = await fetch(`/api/rta-imports/${id}/diagnose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: typed }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setDiag((d) => ({ ...d, [id]: j.error ?? "Could not check this file." })); return; }
      const lines = [
        `${j.file} — ${(j.sizeBytes / 1024).toFixed(0)} KB, ${j.startsWithPK ? "a ZIP" : "NOT a ZIP"}. Tested ${j.typedTried ? "your password + " : ""}${j.savedTried} saved password(s).`,
        ...j.entries.map((e: { name: string; kind: string; method: string; matches: Array<{ who: string; form: string }> }) =>
          `• ${e.name}: ${e.kind}, ${e.method}${e.matches.length ? ` — OPENED by ${e.matches.map((m) => `${m.who} (${m.form})`).join(", ")}` : e.kind.startsWith("AES") ? " — no tested password fits" : ""}`),
        `Result: ${j.verdict}`,
      ];
      setDiag((d) => ({ ...d, [id]: lines.join("\n") }));
    } finally {
      setDiagBusy(null);
    }
  }

  async function reimport(id: string, extra?: { password: string; save: boolean }) {
    setReimporting(id);
    setReimportMsg(null);
    try {
      const res = await fetch(`/api/rta-imports/${id}/reimport`, {
        method: "POST",
        ...(extra ? { headers: { "content-type": "application/json" }, body: JSON.stringify(extra) } : {}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setReimportMsg(j.error ?? "Could not re-import this file"); return; }
      // The worker picks it up within a second or two; the in-flight poller
      // above then refreshes until it reaches a terminal state.
      setReimportMsg(
        extra && j.alreadySaved
          ? "Queued — but that password is already saved, so nothing new is being tried. If the file is refused again it was locked with a different password."
          : "Re-import queued — this row will update shortly.",
      );
      router.refresh();
    } finally {
      setReimporting(null);
    }
  }

  // Live-refresh while any recent import is still in flight (uploaded/parsing) —
  // an auto-imported file lands as 'uploaded', then the worker parses it a few
  // seconds later. Poll the server data until every row reaches a terminal state
  // so the table doesn't sit on a stale "uploaded · 0 rows".
  useEffect(() => {
    const inFlight = recent.some((r) => r.status === "uploaded" || r.status === "parsing");
    if (!inFlight) return;
    const id = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(id);
  }, [recent, router]);

  const rows = tab === "recent" ? recent : trashed;

  function switchTab(t: "recent" | "trash") {
    setTab(t);
    setSel(new Set());
  }
  function toggle(id: string) {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSel((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  async function bulk(action: "trash" | "restore" | "purge", idsArg?: string[]) {
    const ids = idsArg ?? [...sel];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/rta-imports/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, action }),
      });
      if (res.ok) {
        setSel(new Set());
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs">
          <button
            onClick={() => switchTab("recent")}
            className={`px-3 py-1.5 ${tab === "recent" ? "bg-brand-cyan text-white" : "bg-card text-muted-foreground hover:bg-secondary"}`}
          >
            Recent uploads
          </button>
          <button
            onClick={() => switchTab("trash")}
            className={`px-3 py-1.5 border-l border-border inline-flex items-center gap-1.5 ${tab === "trash" ? "bg-brand-cyan text-white" : "bg-card text-muted-foreground hover:bg-secondary"}`}
          >
            <Trash2 className="size-3.5" /> Trash{trashed.length ? ` (${trashed.length})` : ""}
          </button>
        </div>

        {tab === "recent" && recent.some((r) => r.status === "rejected") && (
          <div className="text-xs text-amber-900 border border-amber-200 rounded-md px-3 py-2 bg-amber-50 space-y-1">
            <div className="font-medium">
              {recent.filter((r) => r.status === "rejected").length} file(s) could not be opened — no saved password fits.
            </div>
            <div>
              A registrar lets a different ZIP password be set on every request, so a file can be refused while others from the same
              registrar import. Save that password under{" "}
              <Link href="/dashboard/settings/integrations" className="underline">Settings → Integrations → RTA Mailback</Link> and the
              waiting files import on their own — or press the key button on a row to open just that file. Using the same password on
              every request avoids this.
            </div>
            <div>
              If other files from the same registrar are importing, the saved password is right for those — these were requested with a
              different one. Type that password once below: it opens every waiting file that uses it, and is kept for the next ones.
            </div>
            <button
              type="button"
              disabled={busy || !!reimporting}
              onClick={() => {
                const first = recent.find((r) => r.status === "rejected" && (r.source === "cams" || r.source === "kfintech"));
                if (first) void reimportWithPassword(first.id, true);
              }}
              className="btn-secondary text-xs mt-1"
            >
              <KeyRound className="size-3.5" /> Enter the password for these files
            </button>
          </div>
        )}

        {reimportMsg && (
          <div className="text-2xs text-muted-foreground border rounded-md px-2.5 py-1.5 bg-secondary/40">
            {reimportMsg}
          </div>
        )}

        {sel.size > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">{sel.size} selected</span>
            {tab === "recent" ? (
              <button onClick={() => bulk("trash")} disabled={busy} className="btn-secondary text-xs">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Move to trash
              </button>
            ) : (
              <button onClick={() => bulk("restore")} disabled={busy} className="btn-secondary text-xs">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Recover
              </button>
            )}
            <button
              onClick={() => setPurgeIds([...sel])}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
            >
              <Trash2 className="size-3.5" /> Delete permanently
            </button>
          </div>
        )}
      </div>

      <div className="card-surface overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            {tab === "recent"
              ? "No files imported yet. Click Upload RTA file above to start."
              : "Trash is empty."}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                <tr>
                  <th className="w-8 px-4 py-2">
                    <input type="checkbox" checked={rows.length > 0 && sel.size === rows.length} onChange={toggleAll} aria-label="Select all" />
                  </th>
                  <th className="text-left py-2 font-medium">When</th>
                  <th className="text-left py-2 font-medium">File</th>
                  <th className="text-left py-2 font-medium">Type</th>
                  <th className="text-left py-2 font-medium">Source</th>
                  <th className="text-left py-2 font-medium">Period</th>
                  <th className="text-right py-2 font-medium">Rows</th>
                  <th className="text-left py-2 font-medium pl-4">Status</th>
                  <th className="text-left py-2 font-medium">By</th>
                  <th className="text-right py-2 font-medium pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={`border-b last:border-0 hover:bg-accent/40 ${sel.has(r.id) ? "bg-brand-cyan-light/10" : ""}`}>
                    <td className="px-4 py-2.5">
                      <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label="Select row" />
                    </td>
                    <td className="py-2.5 text-muted-foreground tabular-nums">{formatRelative(r.created_at)}</td>
                    <td className="py-2.5 font-medium truncate max-w-[18rem]" title={r.file_name}>
                      <Link href={`/dashboard/rta-imports/${r.id}`} className="text-brand-cyan-deep hover:underline">
                        {r.file_name}
                      </Link>
                    </td>
                    <td className="py-2.5 text-xs">
                      {RTA_FILE_TYPE_BY_KIND[r.kind as keyof typeof RTA_FILE_TYPE_BY_KIND]?.label ?? r.kind}
                    </td>
                    <td className="py-2.5 text-xs uppercase tracking-wide">{r.source}</td>
                    <td className="py-2.5 text-xs text-muted-foreground tabular-nums">
                      {formatDate(r.period_start)} → {formatDate(r.period_end)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      <span className="text-emerald-700 font-medium">{r.rows_imported ?? 0}</span>
                      {(r.rows_skipped ?? 0) > 0 && <span className="text-amber-700"> · {r.rows_skipped} skip</span>}
                      {(r.rows_failed ?? 0) > 0 && <span className="text-rose-700"> · {r.rows_failed} fail</span>}
                    </td>
                    <td className="py-2.5 pl-4">
                      <StatusBadge status={r.status} />
                      {r.remarks && (r.status === "failed" || r.status === "partial" || r.status === "rejected") && (
                        <div className="text-2xs text-rose-600 mt-0.5 max-w-[24rem] line-clamp-3 whitespace-normal" title={r.remarks}>{r.remarks}</div>
                      )}
                      {diag[r.id] && (
                        <pre className="mt-1 max-w-[34rem] whitespace-pre-wrap rounded-md border border-border bg-secondary/50 p-2 text-2xs text-foreground font-sans">{diag[r.id]}</pre>
                      )}
                    </td>
                    <td className="py-2.5 text-xs text-muted-foreground">{r.uploaded_by_name ?? "—"}</td>
                    <td className="py-2.5 pr-4 text-right">
                      {tab === "recent" ? (
                        <>
                          {canReimport(r) && (
                            <button
                              onClick={() => reimport(r.id)}
                              disabled={busy || reimporting === r.id}
                              className="text-muted-foreground hover:text-brand-cyan p-1 disabled:opacity-50"
                              title={reimportHint(r)}
                              aria-label="Re-import this file"
                            >
                              {reimporting === r.id
                                ? <Loader2 className="size-3.5 animate-spin" />
                                : <RefreshCw className="size-3.5" />}
                            </button>
                          )}
                          {r.status === "rejected" && (
                            <>
                            <button
                              onClick={() => diagnose(r.id)}
                              disabled={busy || diagBusy === r.id}
                              className="btn-icon"
                              title="Why won't this open? Test a password against the file"
                              aria-label="Check this file against a password"
                            >
                              {diagBusy === r.id ? <Loader2 className="size-3.5 animate-spin" /> : <Stethoscope className="size-3.5" />}
                            </button>
                            <a
                              href={`/api/rta-imports/${r.id}/file`}
                              className="btn-icon"
                              title="Download the file exactly as received — to try it on your computer with your password"
                              aria-label="Download the stored file"
                            >
                              <Download className="size-3.5" />
                            </a>
                            </>
                          )}
                          {r.status === "rejected" && (
                            <button
                              onClick={() => reimportWithPassword(r.id, r.source === "cams" || r.source === "kfintech")}
                              disabled={busy || reimporting === r.id}
                              className="text-muted-foreground hover:text-brand-cyan p-1 disabled:opacity-50"
                              title="Open this file with its own ZIP password"
                              aria-label="Enter this file's ZIP password"
                            >
                              <KeyRound className="size-3.5" />
                            </button>
                          )}
                          <button onClick={() => bulk("trash", [r.id])} disabled={busy} className="text-muted-foreground hover:text-rose-600 p-1" title="Move to trash" aria-label="Move to trash">
                            <Trash2 className="size-3.5" />
                          </button>
                        </>
                      ) : (
                        <button onClick={() => bulk("restore", [r.id])} disabled={busy} className="text-muted-foreground hover:text-emerald-600 p-1" title="Recover" aria-label="Recover">
                          <RotateCcw className="size-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={purgeIds !== null}
        title="Delete import records?"
        message={
          purgeIds
            ? `Permanently delete ${purgeIds.length} import record${purgeIds.length === 1 ? "" : "s"}? This cannot be undone. Your imported transactions and folios are kept — only the upload history rows are removed.`
            : undefined
        }
        confirmLabel="Delete permanently"
        tone="danger"
        busy={busy}
        onConfirm={async () => {
          const ids = purgeIds ?? [];
          await bulk("purge", ids);
          setPurgeIds(null);
        }}
        onCancel={() => setPurgeIds(null)}
      />
    </section>
  );
}
