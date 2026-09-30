"use client";

/**
 * §54 — universal claim search. Every claim in the viewer's scope, open or
 * closed, by what the CRM holds on it; a result opens the claim drawer.
 * There is no claim-number or hospital field to search.
 *
 * Sits in the dashboard's header row, so results float over the page rather
 * than pushing it down, and close when focus leaves the box or on Escape.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { ClaimHit } from "@/lib/dashboard/claims/search";
import { openClaim } from "./ClaimLink";
import { StatusBadge, dayOf } from "./parts";

export function ClaimSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ClaimHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits(null);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await fetch(`/api/claims-control/search?q=${encodeURIComponent(term)}`);
        const j = await r.json().catch(() => ({ hits: [] }));
        if (mine === seq.current) setHits(r.ok ? (j.hits as ClaimHit[]) : []);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div
      id="search"
      role="search"
      className="relative w-full scroll-mt-40 sm:w-64"
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <label htmlFor="claim-search" className="sr-only">Search claims</label>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input id="claim-search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
        placeholder="Search claims"
        title="Client, policy number, mobile, PAN, insurer, vehicle number, RM or owner"
        className="input-base pl-8" />
      {busy && <Loader2 className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
      {open && hits && (
        <div className="absolute left-0 top-full z-40 mt-1 max-h-80 w-80 overflow-y-auto rounded-lg border border-border bg-card shadow-lg sm:w-96">
          {hits.length === 0 ? <p className="px-3 py-3 text-xs text-muted-foreground">No claim matches “{q.trim()}”.</p> : (
            <ul className="divide-y divide-border/60">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => { openClaim(h.id); setOpen(false); }} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-accent">
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-foreground">{h.client}</span>
                      <span className="block truncate text-2xs text-muted-foreground">{[h.insurer, h.policyNumber, dayOf(h.openedOn), `matched ${h.matched.toLowerCase()}`].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs"><StatusBadge status={h.status} /> <span className="tabular-nums">{formatMoney(h.claimed)}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
