"use client";

/**
 * Merge Client — search the book, collect any number of records into a
 * summary table, preview which one survives, confirm.
 *
 * Flow (deliberately three steps, because a merge retires records):
 *   1. Search by name / PAN / email / mobile / address → tick clients.
 *   2. "Merge Client Summary" — the ticked records side by side, with a
 *      checkbox per row so one can be left out without starting over.
 *   3. "Preview Merge Client" → choose the survivor (defaults to the record
 *      with the most to lose: biggest book, then most folios), see exactly what
 *      moves, add a reason, confirm. Losers merge one by one via
 *      POST /api/investors/merge — the same engine as the system merge, so
 *      every merge here is reversible from Differ Clients.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, GitMerge, Loader2, Search, ShieldAlert, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Candidate = {
  id: string;
  name: string;
  pan: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  ucc?: string | null;
  address?: string | null;
  aum: number;
  status: string | null;
  folios: number;
};

const inr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Short, stable, human-readable id: the exchange UCC when the firm has one, else the record id's first 8 chars. */
const clientId = (c: Candidate) => c.ucc || c.id.slice(0, 8).toUpperCase();

export function MergeClientTool() {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(true);
  const [picked, setPicked] = useState<Candidate[]>([]);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<"pick" | "preview">("pick");
  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const seq = useRef(0);

  // Debounced search; `seq` stops a slow earlier request overwriting fresher results.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/investors/merge-search?q=${encodeURIComponent(term)}`, { cache: "no-store" });
        const j = await res.json().catch(() => ({}));
        if (mine === seq.current) {
          setResults(res.ok ? (j.results ?? []) : []);
          setResultsOpen(true);
        }
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  function toggle(c: Candidate) {
    setPicked((prev) => {
      if (prev.some((p) => p.id === c.id)) {
        setIncluded((s) => { const n = new Set(s); n.delete(c.id); return n; });
        return prev.filter((p) => p.id !== c.id);
      }
      setIncluded((s) => new Set(s).add(c.id));
      return [...prev, c];
    });
  }
  function remove(id: string) {
    setPicked((prev) => prev.filter((p) => p.id !== id));
    setIncluded((s) => { const n = new Set(s); n.delete(id); return n; });
  }
  function toggleIncluded(id: string) {
    setIncluded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  const allIncluded = picked.length > 0 && picked.every((p) => included.has(p.id));
  function toggleAll() {
    setIncluded(allIncluded ? new Set() : new Set(picked.map((p) => p.id)));
  }

  const selected = useMemo(() => picked.filter((p) => included.has(p.id)), [picked, included]);

  function openPreview() {
    if (selected.length < 2) return;
    // Default survivor: biggest book, then most folios. Shown as a choice, never silent.
    const keep = [...selected].sort((a, b) => b.aum - a.aum || b.folios - a.folios)[0];
    setSurvivorId(keep.id);
    setStep("preview");
  }

  async function confirmMerge() {
    if (!survivorId) return;
    const survivor = selected.find((s) => s.id === survivorId);
    const losers = selected.filter((s) => s.id !== survivorId);
    if (!survivor || losers.length === 0) return;
    setBusy(true);
    let moved = 0;
    let done = 0;
    try {
      for (const loser of losers) {
        setProgress(`Merging ${loser.name} into ${survivor.name}… (${done + 1} of ${losers.length})`);
        const res = await fetch("/api/investors/merge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ survivorId, loserId: loser.id, reason: reason.trim() || undefined }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) {
          toast.error(`${loser.name}: ${j.error ?? `merge failed (${res.status})`}`, "Merge stopped");
          break;
        }
        moved += Number(j.reassigned ?? 0);
        done++;
      }
      if (done > 0) {
        toast.success(`Merged ${done} client${done === 1 ? "" : "s"} into ${survivor.name} — ${moved} record${moved === 1 ? "" : "s"} moved across`);
        setPicked([]);
        setIncluded(new Set());
        setStep("pick");
        setSurvivorId(null);
        setReason("");
        setQ("");
        router.refresh();
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Merge");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const survivor = selected.find((s) => s.id === survivorId) ?? null;
  const losers = selected.filter((s) => s.id !== survivorId);

  /* ───────────────────────── Preview step ───────────────────────── */
  if (step === "preview" && survivor) {
    const loserFolios = losers.reduce((n, l) => n + l.folios, 0);
    const loserAum = losers.reduce((n, l) => n + l.aum, 0);
    return (
      <div className="space-y-4">
        <div className="card-surface p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold">Preview merge</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Choose the record that survives. Every other record's folios, SIPs, transactions and history move to it, and those records are retired.
              </p>
            </div>
            <button type="button" onClick={() => setStep("pick")} className="btn-secondary text-xs inline-flex items-center gap-1.5">
              <ArrowLeft className="size-3.5" /> Back to summary
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 pr-3 font-medium w-28">Keep</th>
                  <th className="text-left py-2 pr-3 font-medium">Client Name</th>
                  <th className="text-left py-2 pr-3 font-medium">Client ID</th>
                  <th className="text-left py-2 pr-3 font-medium">PAN</th>
                  <th className="text-right py-2 pr-3 font-medium">AUM</th>
                  <th className="text-right py-2 pr-3 font-medium">Folios</th>
                  <th className="text-left py-2 font-medium">What happens</th>
                </tr>
              </thead>
              <tbody>
                {selected.map((c) => {
                  const keep = c.id === survivorId;
                  return (
                    <tr key={c.id} className={`border-b last:border-0 ${keep ? "bg-emerald-50/50" : ""}`}>
                      <td className="py-2.5 pr-3">
                        <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold">
                          <input type="radio" name="survivor" checked={keep} onChange={() => setSurvivorId(c.id)} />
                          {keep ? "Survives" : "Merge away"}
                        </label>
                      </td>
                      <td className="py-2.5 pr-3 font-medium">{c.name}</td>
                      <td className="py-2.5 pr-3 font-mono text-xs text-muted-foreground">{clientId(c)}</td>
                      <td className="py-2.5 pr-3 font-mono text-xs">{c.pan ?? "—"}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{inr(c.aum)}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{c.folios}</td>
                      <td className="py-2.5 text-xs text-muted-foreground">
                        {keep ? (
                          <span className="text-emerald-700 font-medium">Kept — receives everything below</span>
                        ) : (
                          <>Moves {c.folios} folio{c.folios === 1 ? "" : "s"} and all history, then is retired</>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 rounded-lg border border-border bg-secondary/30 px-4 py-3 text-xs flex flex-wrap gap-x-6 gap-y-1">
            <span><strong>{losers.length}</strong> record{losers.length === 1 ? "" : "s"} merge into <strong>{survivor.name}</strong></span>
            <span><strong>{loserFolios}</strong> folio{loserFolios === 1 ? "" : "s"} move</span>
            <span><strong>{inr(loserAum)}</strong> joins the survivor's book</span>
            <span className="text-muted-foreground">Reversible from Differ Clients</span>
          </div>

          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are these the same person? (optional — shown in the merge log)"
            className="input-base w-full text-xs mt-3"
            maxLength={300}
          />

          {progress && (
            <div className="mt-3 text-xs text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" /> {progress}
            </div>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setStep("pick")} disabled={busy} className="btn-secondary text-sm">Cancel</button>
            <button type="button" onClick={confirmMerge} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-1.5">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <GitMerge className="size-4" />}
              Merge {losers.length} into {survivor.name.split(" ")[0]}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ───────────────────────── Pick step ───────────────────────── */
  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="card-surface p-5">
        <h2 className="font-semibold">Search by Name / PAN / Email / Mobile / Address</h2>
        <div className="relative mt-3">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type at least 2 characters…"
            className="input-base w-full pl-9"
            autoFocus
          />
          {searching && <Loader2 className="size-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>

        {q.trim().length >= 2 && (
          <div className="mt-3 rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setResultsOpen((o) => !o)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold bg-secondary/40 hover:bg-secondary/70"
              aria-expanded={resultsOpen}
            >
              <span>Clients ({results.length})</span>
              <span className="text-muted-foreground text-xs">{resultsOpen ? "Hide" : "Show"}</span>
            </button>
            {resultsOpen && (
              results.length === 0 && !searching ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">No clients match that search.</p>
              ) : (
                <div className="max-h-72 overflow-y-auto divide-y divide-border">
                  {results.map((c) => {
                    const on = picked.some((p) => p.id === c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggle(c)}
                        className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition ${on ? "bg-accent/60" : "hover:bg-secondary/50"}`}
                      >
                        <span className={`size-4 rounded border grid place-items-center shrink-0 ${on ? "bg-primary border-primary text-white" : "border-border"}`}>
                          {on && <Check className="size-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium truncate">{c.name}</span>
                          <span className="block text-[11px] text-muted-foreground truncate tabular-nums">
                            {[c.pan, c.phone, c.email, c.address ?? c.city].filter(Boolean).join(" · ") || "no identifiers"}
                          </span>
                        </span>
                        <span className="text-right shrink-0">
                          <span className="block text-xs font-medium tabular-nums">{inr(c.aum)}</span>
                          <span className="block text-[11px] text-muted-foreground">{c.folios} folio{c.folios === 1 ? "" : "s"}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="card-surface p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold">Merge Client Summary</h2>
          <span className="text-xs text-muted-foreground">
            {picked.length === 0 ? "Tick clients above to add them here" : `${selected.length} of ${picked.length} selected for merge`}
          </span>
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground bg-secondary/40 border-b">
              <tr>
                <th className="py-2.5 px-3 w-10">
                  <input type="checkbox" checked={allIncluded} onChange={toggleAll} disabled={picked.length === 0} aria-label="Select all for merge" className="size-3.5" />
                </th>
                <th className="text-left py-2.5 px-3 font-medium">Client Name</th>
                <th className="text-left py-2.5 px-3 font-medium">Client ID</th>
                <th className="text-left py-2.5 px-3 font-medium">PAN</th>
                <th className="text-left py-2.5 px-3 font-medium">Mobile</th>
                <th className="text-left py-2.5 px-3 font-medium">Email</th>
                <th className="text-left py-2.5 px-3 font-medium">Address</th>
                <th className="py-2.5 px-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {picked.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm text-muted-foreground">No data available in table</td>
                </tr>
              ) : (
                picked.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-secondary/30">
                    <td className="py-2.5 px-3">
                      <input type="checkbox" checked={included.has(c.id)} onChange={() => toggleIncluded(c.id)} aria-label={`Include ${c.name}`} className="size-3.5" />
                    </td>
                    <td className="py-2.5 px-3 font-medium">{c.name}</td>
                    <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground" title={c.id}>{clientId(c)}</td>
                    <td className="py-2.5 px-3 font-mono text-xs">{c.pan ?? ""}</td>
                    <td className="py-2.5 px-3 tabular-nums text-xs">{c.phone ?? ""}</td>
                    <td className="py-2.5 px-3 text-xs">{c.email ?? ""}</td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground max-w-[220px] truncate" title={c.address ?? c.city ?? ""}>{c.address ?? c.city ?? ""}</td>
                    <td className="py-2.5 px-3">
                      <button type="button" onClick={() => remove(c.id)} className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${c.name}`}>
                        <X className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-xs text-muted-foreground">
            Showing {picked.length} {picked.length === 1 ? "entry" : "entries"}
            {selected.length === 1 && <span className="ml-2 inline-flex items-center gap-1 text-amber-700"><ShieldAlert className="size-3" /> select at least two to merge</span>}
          </span>
          <button
            type="button"
            onClick={openPreview}
            disabled={selected.length < 2}
            className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <GitMerge className="size-4" /> Preview Merge Client
          </button>
        </div>
      </div>
    </div>
  );
}
