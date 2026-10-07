"use client";

/**
 * Pick the household head from the existing client book when creating a family.
 *
 * Why this exists: the create form asked only for a typed "Family / organisation
 * name", so a household began life with no link to anyone. The head was then
 * added later as an ordinary member, and the typed name drifted from it — which
 * is how you end up with a family called "ADESH MANOCHA FAMILY" whose head is
 * someone else entirely. Choosing the head first makes the name a consequence of
 * the data instead of a second, hand-maintained copy of it.
 *
 * The name stays editable. A firm that names households by organisation
 * ("Sharma Trust", "Acme Pvt Ltd Employees") must not be forced into
 * "<person> Family" — so we fill, and stop touching it the moment the user types.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, UserCheck, X } from "lucide-react";

export type HeadCandidate = {
  id: string;
  name: string;
  pan: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  aum: number;
  folios: number;
};

const inr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;

export function FamilyHeadPicker({
  value,
  onPick,
}: {
  value: HeadCandidate | null;
  onPick: (c: HeadCandidate | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<HeadCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (value || term.length < 2) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/investors/merge-search?q=${encodeURIComponent(term)}`, { cache: "no-store" });
        const j = await res.json().catch(() => ({}));
        if (mine !== seq.current) return;
        // A failed request must not read as "no clients found" — that blames the
        // search term for a request that never succeeded.
        if (!res.ok) throw new Error(j?.error ?? `Search failed (${res.status})`);
        setResults(j.results ?? []);
        setErr(null);
      } catch (e: any) {
        if (mine === seq.current) {
          setResults([]);
          setErr(e?.message ?? "Could not search clients.");
        }
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, value]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
            <UserCheck className="size-3.5" /> Head of family
          </span>
          <span className="block text-sm font-medium truncate">{value.name}</span>
          <span className="block text-2xs text-muted-foreground tabular-nums truncate">
            {[value.pan, value.phone, value.city].filter(Boolean).join(" · ") || "no identifiers"} · {inr(value.aum)} ·{" "}
            {value.folios} folio{value.folios === 1 ? "" : "s"}
          </span>
        </span>
        <button
          type="button"
          onClick={() => { onPick(null); setQ(""); }}
          className="text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Clear head of family"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search an existing client by name, PAN, mobile…"
          className="w-full border rounded-md pl-9 pr-8 py-2 text-sm bg-background"
        />
        {loading && <Loader2 className="size-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>

      {err && <p className="mt-1 text-2xs text-rose-600">{err}</p>}

      {!err && q.trim().length >= 2 && !loading && results.length === 0 && (
        <p className="mt-1 text-2xs text-muted-foreground">
          No client matches. You can still name the household below and link members later.
        </p>
      )}

      {results.length > 0 && (
        <div className="mt-1.5 max-h-52 overflow-y-auto rounded-md border border-border divide-y divide-border">
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onPick(c); setResults([]); }}
              className="w-full text-left px-3 py-2 hover:bg-secondary/50 flex items-center justify-between gap-3"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium truncate">{c.name}</span>
                <span className="block text-2xs text-muted-foreground truncate tabular-nums">
                  {[c.pan, c.phone, c.city].filter(Boolean).join(" · ") || "no identifiers"}
                </span>
              </span>
              <span className="text-right shrink-0">
                <span className="block text-xs font-medium tabular-nums">{inr(c.aum)}</span>
                <span className="block text-2xs text-muted-foreground">{c.folios} folio{c.folios === 1 ? "" : "s"}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
