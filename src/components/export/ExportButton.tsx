"use client";

/**
 * The Export button on a module's list. Click → choose the fields → download.
 *
 * - Shown only to people allowed to export this module ("Export data", or
 *   "Bulk export clients" for clients) — asked once per session.
 * - The file carries the list's current filters (the page's query string).
 * - The last choice of fields is remembered per module in this browser.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { notify } from "@/components/ui/Toast";

type Col = { key: string; label: string; group: string; default: boolean };

let allowed: Promise<Set<string>> | null = null;
function loadAllowed() {
  if (!allowed) {
    allowed = fetch("/api/export", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { modules: [] }))
      .then((j) => new Set<string>(Array.isArray(j.modules) ? j.modules : []))
      .catch(() => { allowed = null; return new Set<string>(); });
  }
  return allowed;
}

const storeKey = (m: string) => `export-fields:${m}`;
function readSaved(m: string): string[] | null {
  try { const v = localStorage.getItem(storeKey(m)); return v ? JSON.parse(v) : null; } catch { return null; }
}
function save(m: string, keys: string[]) {
  try { localStorage.setItem(storeKey(m), JSON.stringify(keys)); } catch { /* private window */ }
}

export function ExportButton({
  module,
  label = "Export",
  /** Extra filters to add to the page's own query string (e.g. a client page's id). */
  params,
  variant = "secondary",
}: {
  module: string;
  label?: string;
  params?: Record<string, string>;
  variant?: "secondary" | "ghost";
}) {
  const [ok, setOk] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    loadAllowed().then((s) => live && setOk(s.has(module)));
    return () => { live = false; };
  }, [module]);
  if (!ok) return null;
  return (
    <>
      <Button variant={variant} icon={<Download className="size-4" />} onClick={() => setOpen(true)}>{label}</Button>
      {open && <ExportDialog module={module} extra={params} onClose={() => setOpen(false)} />}
    </>
  );
}

function ExportDialog({ module, extra, onClose }: { module: string; extra?: Record<string, string>; onClose: () => void }) {
  const search = useSearchParams();
  const [title, setTitle] = useState("");
  const [cols, setCols] = useState<Col[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/export/${module}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? "Could not load the fields");
        return j;
      })
      .then((j) => {
        if (!live) return;
        const list: Col[] = j.columns ?? [];
        setTitle(j.label ?? "");
        setCols(list);
        const saved = readSaved(module);
        const keys = new Set(list.map((c) => c.key));
        const start = saved?.filter((k) => keys.has(k)) ?? [];
        setPicked(new Set(start.length ? start : list.filter((c) => c.default).map((c) => c.key)));
      })
      .catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [module]);

  const groups = useMemo(() => {
    const m = new Map<string, Col[]>();
    for (const c of cols ?? []) m.set(c.group, [...(m.get(c.group) ?? []), c]);
    return [...m.entries()];
  }, [cols]);

  // The page's own filters, plus anything the page adds.
  const qs = useMemo(() => {
    const p = new URLSearchParams(search?.toString() ?? "");
    for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
    return p;
  }, [search, extra]);
  const filtered = [...qs.keys()].some((k) => !["view", "tab", "page", "sort", "dir"].includes(k));

  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const setGroup = (g: Col[], on: boolean) => setPicked((s) => { const n = new Set(s); g.forEach((c) => (on ? n.add(c.key) : n.delete(c.key))); return n; });

  async function run() {
    if (!picked.size) { setErr("Choose at least one field."); return; }
    setBusy(true);
    setErr(null);
    try {
      const fields = (cols ?? []).filter((c) => picked.has(c.key)).map((c) => c.key);
      save(module, fields);
      const res = await fetch(`/api/export/${module}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fields, format, params: qs.toString() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? "Export failed");
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `${module}.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      const n = Number(res.headers.get("x-export-rows") ?? "0");
      notify.success(`Exported ${n.toLocaleString("en-IN")} ${n === 1 ? "row" : "rows"}`);
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export {title || "data"}</DialogTitle>
          <DialogDescription>
            Choose the fields to include. {filtered ? "The file has the filters applied on this page." : "The file has every record you can see in this list."}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {err && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{err}</p>}
          {cols === null && !err ? (
            <div className="h-40 animate-pulse rounded-lg bg-secondary/60" aria-label="Loading fields" />
          ) : cols && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{picked.size} of {cols.length} fields</span>
                <span className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setPicked(new Set(cols.map((c) => c.key)))}>Select all</Button>
                  <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>Clear</Button>
                  <Button variant="ghost" size="sm" onClick={() => setPicked(new Set(cols.filter((c) => c.default).map((c) => c.key)))}>Default</Button>
                </span>
              </div>
              <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
                {groups.map(([g, list]) => {
                  const all = list.every((c) => picked.has(c.key));
                  return (
                    <fieldset key={g} className="space-y-2">
                      <legend className="flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {g}
                        <button type="button" className="text-2xs font-medium normal-case tracking-normal text-foreground underline-offset-2 hover:underline" onClick={() => setGroup(list, !all)}>
                          {all ? "none" : "all"}
                        </button>
                      </legend>
                      <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                        {list.map((c) => (
                          <label key={c.key} className="flex cursor-pointer items-center gap-2 text-sm">
                            <input type="checkbox" checked={picked.has(c.key)} onChange={() => toggle(c.key)} />
                            <span className="truncate">{c.label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Format</span>
                <div className="dash-seg" role="group" aria-label="File format">
                  <button type="button" aria-pressed={format === "xlsx"} onClick={() => setFormat("xlsx")}>Excel (.xlsx)</button>
                  <button type="button" aria-pressed={format === "csv"} onClick={() => setFormat("csv")}>CSV</button>
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={run} disabled={busy || !cols || !picked.size}
            icon={busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}>
            {busy ? "Exporting…" : `Export ${picked.size} field${picked.size === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
