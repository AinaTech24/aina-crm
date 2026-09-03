"use client";

/**
 * Manual merge picker — search the book, pick two records, choose which survives.
 *
 * The duplicate detector only groups on exact-ish keys (PAN / phone / email /
 * name), so an operator who can SEE that two records are the same person —
 * a typo'd PAN, a maiden name, one record with no identifiers at all — had no
 * way to act on it. This is that path.
 *
 * The survivor choice is explicit and defaults to the record with more to lose
 * (higher AUM, then more folios). Merging is not symmetric — the loser is
 * retired — so making the user confirm which side survives is the whole point;
 * an auto-picked survivor is how the wrong record gets retired.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, GitMerge, Loader2, Search, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Candidate = {
  id: string;
  name: string;
  pan: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  aum: number;
  status: string | null;
  folios: number;
};

const inr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;

export function MergePicker() {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Candidate[]>([]);
  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  // Debounced search. `seq` guards against an earlier request resolving after a
  // later one and overwriting fresher results with stale ones.
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
        if (mine === seq.current) setResults(res.ok ? (j.results ?? []) : []);
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  function toggle(c: Candidate) {
    setPicked((prev) => {
      const has = prev.some((p) => p.id === c.id);
      if (has) {
        const next = prev.filter((p) => p.id !== c.id);
        if (survivorId === c.id) setSurvivorId(null);
        return next;
      }
      if (prev.length >= 2) return prev; // exactly two, and the pair is the point
      const next = [...prev, c];
      if (next.length === 2 && !survivorId) {
        // Default the survivor to the record with more at stake — bigger book
        // first, then more folios. Still shown as a choice, never silent.
        const [a, b] = next;
        const keep = a.aum !== b.aum ? (a.aum > b.aum ? a : b) : a.folios >= b.folios ? a : b;
        setSurvivorId(keep.id);
      }
      return next;
    });
  }

  async function doMerge() {
    if (picked.length !== 2 || !survivorId) return;
    const loser = picked.find((p) => p.id !== survivorId);
    if (!loser) return;
    setBusy(true);
    try {
      const res = await fetch("/api/investors/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ survivorId, loserId: loser.id, reason: reason.trim() || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        toast.error(j.error ?? `Merge failed (${res.status})`, "Merge");
        return;
      }
      toast.success(`Merged — ${j.reassigned ?? 0} record(s) moved to the surviving client`);
      setPicked([]);
      setSurvivorId(null);
      setReason("");
      setQ("");
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Merge");
    } finally {
      setBusy(false);
    }
  }

  const survivor = picked.find((p) => p.id === survivorId) ?? null;
  const loser = picked.find((p) => p.id !== survivorId) ?? null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <GitMerge className="size-4 text-brand-cyan" /> Merge two clients
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Search by name, PAN, email, mobile or address. Pick exactly two records, then choose which one survives.
        </p>
      </div>

      <div className="relative">
        <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search clients…"
          className="input-base w-full pl-9"
        />
        {searching && <Loader2 className="size-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>

      {q.trim().length >= 2 && results.length === 0 && !searching && (
        <p className="text-xs text-muted-foreground">No clients match that search.</p>
      )}

      {results.length > 0 && (
        <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
          {results.map((c) => {
            const on = picked.some((p) => p.id === c.id);
            const full = picked.length >= 2 && !on;
            return (
              <button
                key={c.id}
                type="button"
                disabled={full}
                onClick={() => toggle(c)}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition ${
                  on ? "bg-brand-cyan-light/40" : full ? "opacity-40 cursor-not-allowed" : "hover:bg-secondary/50"
                }`}
              >
                <span
                  className={`size-4 rounded border grid place-items-center shrink-0 ${
                    on ? "bg-brand-cyan border-brand-cyan text-white" : "border-border"
                  }`}
                >
                  {on && <Check className="size-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">{c.name}</span>
                  <span className="block text-[11px] text-muted-foreground truncate tabular-nums">
                    {[c.pan, c.phone, c.email, c.city].filter(Boolean).join(" · ") || "no identifiers"}
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
      )}

      {picked.length > 0 && (
        <div className="rounded-lg border border-border bg-secondary/20 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">Selected ({picked.length} of 2)</span>
            <button onClick={() => { setPicked([]); setSurvivorId(null); }} className="text-[11px] text-muted-foreground hover:underline">
              Clear
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {picked.map((c) => (
              <label
                key={c.id}
                className={`rounded-lg border p-2.5 cursor-pointer transition ${
                  survivorId === c.id ? "border-emerald-400 bg-emerald-50" : "border-border bg-card hover:border-border/80"
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="survivor"
                    checked={survivorId === c.id}
                    onChange={() => setSurvivorId(c.id)}
                    className="accent-emerald-600"
                  />
                  <span className="text-xs font-semibold">{survivorId === c.id ? "Keep this one" : "Merge away"}</span>
                </span>
                <span className="block mt-1.5 text-sm font-medium truncate">{c.name}</span>
                <span className="block text-[11px] text-muted-foreground tabular-nums">
                  {inr(c.aum)} · {c.folios} folio{c.folios === 1 ? "" : "s"} · {c.pan ?? "no PAN"}
                </span>
              </label>
            ))}
          </div>

          {picked.length === 2 && survivor && loser && (
            <>
              <div className="text-xs flex items-center gap-2 flex-wrap">
                <span className="chip text-[10px] bg-rose-50 text-rose-700">{loser.name}</span>
                <ArrowRight className="size-3.5 text-muted-foreground" />
                <span className="chip text-[10px] bg-emerald-50 text-emerald-700">{survivor.name}</span>
                <span className="text-muted-foreground">
                  — {loser.folios} folio{loser.folios === 1 ? "" : "s"} and all history move across; the merged record is retired.
                </span>
              </div>

              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why are these the same person? (optional, shown in the merge log)"
                className="input-base w-full text-xs"
                maxLength={300}
              />

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={doMerge}
                  disabled={busy}
                  className="btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <GitMerge className="size-3.5" />}
                  Merge into {survivor.name.split(" ")[0]}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Undo button for a logged merge. */
export function UnmergeButton({ mergeId, reversible }: { mergeId: string; reversible: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (!reversible) {
    return (
      <span
        className="text-[11px] text-muted-foreground"
        title="This merge moved more rows than could be logged individually, so it cannot be undone automatically."
      >
        not reversible
      </span>
    );
  }

  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/investors/unmerge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mergeId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        toast.error(j.error ?? `Un-merge failed (${res.status})`, "Un-merge");
        return;
      }
      toast.success(`Un-merged — ${j.restored ?? 0} record(s) returned`);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Un-merge");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return confirming ? (
    <span className="inline-flex items-center gap-1.5">
      <button onClick={run} disabled={busy} className="text-[11px] font-medium text-rose-600 hover:underline disabled:opacity-60">
        {busy ? "Undoing…" : "Confirm"}
      </button>
      <button onClick={() => setConfirming(false)} className="text-muted-foreground hover:text-foreground">
        <X className="size-3" />
      </button>
    </span>
  ) : (
    <button onClick={() => setConfirming(true)} className="text-[11px] text-brand-cyan hover:underline">
      Undo
    </button>
  );
}
