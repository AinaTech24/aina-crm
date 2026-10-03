"use client";

/**
 * Sub-distributor lookup — picks a record from the Sub-distributors module.
 * Used on the new-lead form + anywhere else we attribute work to a
 * sub-distributor.
 *
 * It reads GET /api/sub-distributors/lookup (active records; name, code, ARN,
 * city only), which anyone who may create or edit leads can call. It used to
 * read the compliance-only register list, so for RMs and back office it
 * returned 403 and "No sub-distributors match" for every search — the field
 * looked like a plain text box. Now it also opens the list on click (no typing
 * needed), shows it IS a lookup (search icon + arrow), and says plainly when
 * the module has no active sub-distributors yet.
 *
 * Controlled by the parent via { value, displayName, onSelect, onClear }.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Loader2, Search, X } from "lucide-react";

type Row = { id: string; name: string; code: string | null; arnNumber: string | null; city: string | null };

export function SubDistributorLookup({
  value,
  displayName,
  onSelect,
  onClear,
  placeholder = "Search sub-distributors by name, code, ARN or city…",
}: {
  value: string | null;
  displayName: string | null;
  onSelect: (id: string, name: string) => void;
  onClear: () => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [results, setResults] = useState<Row[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Load the list as soon as it opens, then filter as the user types (250ms).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(
      async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/sub-distributors/lookup?q=${encodeURIComponent(q.trim())}`);
          if (!res.ok) throw new Error(String(res.status));
          const j = await res.json();
          if (!cancelled) {
            setResults(j.subDistributors ?? []);
            setFailed(false);
          }
        } catch {
          if (!cancelled) {
            setResults([]);
            setFailed(true);
          }
        } finally {
          if (!cancelled) setBusy(false);
        }
      },
      q.trim() ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  // The picked sub-distributor, with a clear button.
  if (value && displayName && !open) {
    return (
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-primary">
          <span className="text-xs font-medium">{displayName}</span>
          <button
            type="button"
            onClick={() => {
              onClear();
              setQ("");
              setOpen(true);
            }}
            className="hover:text-destructive"
            aria-label={`Remove ${displayName}`}
            title="Change"
          >
            <X className="size-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-label="Sub-distributor"
        className="input-base w-full pl-9 pr-9 text-sm"
      />
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-card shadow-lg" role="listbox">
          {busy && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Loading…
            </div>
          )}
          {!busy && failed && (
            <div className="px-3 py-2 text-xs text-destructive">Could not load sub-distributors. Try again.</div>
          )}
          {!busy && !failed && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {q.trim() ? (
                "No active sub-distributor matches. Try a different name, code or ARN."
              ) : (
                <>
                  No active sub-distributors yet.{" "}
                  <Link href="/dashboard/sub-distributors/new" className="font-medium text-primary hover:underline">
                    Add one in Sub-distributors
                  </Link>
                </>
              )}
            </div>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={r.id === value}
              onClick={() => {
                onSelect(r.id, r.name);
                setOpen(false);
                setQ("");
              }}
              className="w-full border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted"
            >
              <div className="text-sm font-medium">{r.name}</div>
              <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                {r.code && <span className="font-mono">{r.code}</span>}
                {r.arnNumber && <span className="font-mono">ARN: {r.arnNumber}</span>}
                {r.city && <span>· {r.city}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
