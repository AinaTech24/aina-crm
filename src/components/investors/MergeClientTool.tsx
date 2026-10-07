"use client";

/**
 * Merge by search — find the records yourself, tick them, then "Compare &
 * merge" opens the SAME dialog Find Duplicates uses (MergeCompareDialog):
 * choose which records take part, which one is the primary, and field by
 * field which value the merged record keeps. One merge screen everywhere, so
 * nobody has to learn two.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, GitMerge, Loader2, Search, X } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
import { MergeCompareDialog, type Member } from "@/components/investors/DuplicateMerge";

type Candidate = {
  id: string;
  name: string;
  pan: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  address?: string | null;
  aum: number;
  folios: number;
};

const inr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;

const toMember = (c: Candidate): Member => ({
  id: c.id,
  name: c.name,
  pan: c.pan,
  phone: c.phone,
  email: c.email,
  aum: c.aum,
  folios: c.folios,
  rm_name: null,
});

export function MergeClientTool() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Candidate[]>([]);
  const [comparing, setComparing] = useState(false);
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
        if (mine === seq.current) setResults(res.ok ? (j.results ?? []) : []);
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const isPicked = (id: string) => picked.some((p) => p.id === id);
  function toggle(c: Candidate) {
    setPicked((prev) => (prev.some((p) => p.id === c.id) ? prev.filter((p) => p.id !== c.id) : [...prev, c]));
  }

  return (
    <div className="space-y-4">
      {/* Step 1 — find */}
      <div className="card-surface p-5">
        <h2 className="text-sm font-semibold">1. Find the records</h2>
        <p className="text-xs text-muted-foreground">Search by name, PAN, email, mobile or address, and tick every record that is the same person.</p>
        <div className="relative mt-3">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type at least 2 characters…"
            aria-label="Search clients to merge"
            className="input-base w-full pl-9"
            autoFocus
          />
          {searching && <Loader2 className="size-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>

        {q.trim().length >= 2 && (
          results.length === 0 && !searching ? (
            <p className="mt-3 text-xs text-muted-foreground">No clients match that search.</p>
          ) : (
            <ul className="mt-3 max-h-80 overflow-y-auto divide-y divide-border rounded-lg border border-border">
              {results.map((c) => {
                const on = isPicked(c.id);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => toggle(c)}
                      aria-pressed={on}
                      className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition ${on ? "bg-primary/5" : "hover:bg-secondary/50"}`}
                    >
                      <span className={`size-4 rounded border grid place-items-center shrink-0 ${on ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>
                        {on && <Check className="size-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium truncate">{c.name}</span>
                        <span className="block text-2xs text-muted-foreground truncate tabular-nums">
                          {[c.pan, c.phone, c.email, c.address ?? c.city].filter(Boolean).join(" · ") || "no identifiers"}
                        </span>
                      </span>
                      <span className="text-right shrink-0">
                        <span className="block text-xs font-medium tabular-nums">{c.aum > 0 ? inr(c.aum) : "No AUM"}</span>
                        <span className="block text-2xs text-muted-foreground">{c.folios} folio{c.folios === 1 ? "" : "s"}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        )}
      </div>

      {/* Step 2 — compare & merge */}
      <div className="card-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">2. Compare and merge</h2>
            <p className="text-xs text-muted-foreground">
              {picked.length === 0
                ? "The records you tick appear here."
                : picked.length === 1
                  ? "Tick at least one more record."
                  : "Next you choose the primary record and which value to keep for each field."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setComparing(true)}
            disabled={picked.length < 2}
            className={buttonClass("primary")}
          >
            <GitMerge className="size-4" aria-hidden /> Compare &amp; merge {picked.length >= 2 ? `(${picked.length})` : ""}
          </button>
        </div>
        {picked.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {picked.map((c) => (
              <li key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 py-1 pl-3 pr-1 text-xs">
                <span className="font-medium">{c.name}</span>
                {c.pan && <span className="font-mono text-muted-foreground">{c.pan}</span>}
                <button type="button" onClick={() => toggle(c)} className="btn-icon size-6" aria-label={`Remove ${c.name}`}>
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {comparing && (
        <MergeCompareDialog
          members={picked.map(toMember)}
          onClose={() => setComparing(false)}
          onMerged={() => {
            setPicked([]);
            setQ("");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
