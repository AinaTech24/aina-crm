"use client";

/**
 * Merge by search — two searches, the way the firm asked for it (14 Oct 2026):
 *
 *   1. Main client       the record that stays
 *   2. Client to merge   the record that goes into it
 *
 * With both chosen, the two sit side by side and "Merge" opens the SAME
 * dialog Find Duplicates uses (MergeCompareDialog) with the main client
 * already set as the record to keep — so the field-by-field choice, the PAN
 * guard, the preview of what moves and the undo are the ones every merge has.
 * Everything runs through src/lib/investors/merge.ts.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeftRight, GitMerge, Loader2, Search, X } from "lucide-react";
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

const identifiers = (c: Candidate) =>
  [c.pan, c.phone, c.email, c.address ?? c.city].filter(Boolean).join(" · ") || "No PAN, mobile or email";

export function MergeClientTool() {
  const router = useRouter();
  const [main, setMain] = useState<Candidate | null>(null);
  const [other, setOther] = useState<Candidate | null>(null);
  const [merging, setMerging] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ClientPicker
          step="1"
          title="Main client"
          hint="This record stays."
          picked={main}
          onPick={setMain}
          exclude={other?.id}
        />
        <ClientPicker
          step="2"
          title="Client to merge"
          hint="This record goes into the main client."
          picked={other}
          onPick={setOther}
          exclude={main?.id}
        />
      </div>

      {main && other && (
        <div className="card-surface p-5 space-y-4">
          <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
            <ChosenCard label="Client to merge" c={other} />
            <div className="flex justify-center text-muted-foreground" aria-hidden>
              <ArrowDown className="size-5 md:-rotate-90" />
            </div>
            <ChosenCard label="Main client — stays" c={main} highlight />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setMain(other); setOther(main); }}
              className={buttonClass("ghost")}
            >
              <ArrowLeftRight className="size-4" aria-hidden /> Swap
            </button>
            <button type="button" onClick={() => setMerging(true)} className={buttonClass("primary")}>
              <GitMerge className="size-4" aria-hidden /> Merge
            </button>
          </div>
        </div>
      )}

      {merging && main && other && (
        <MergeCompareDialog
          members={[toMember(main), toMember(other)]}
          initialSurvivorId={main.id}
          onClose={() => setMerging(false)}
          onMerged={() => {
            setMerging(false);
            setMain(null);
            setOther(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/** One search box: type, pick a client from the results; the pick shows with Change. */
function ClientPicker({
  step, title, hint, picked, onPick, exclude,
}: {
  step: string;
  title: string;
  hint: string;
  picked: Candidate | null;
  onPick: (c: Candidate | null) => void;
  exclude?: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);
  const inputId = `merge-search-${step}`;

  // Debounced search; `seq` stops a slow earlier request overwriting fresher results.
  useEffect(() => {
    const term = q.trim();
    if (picked || term.length < 2) {
      setResults([]);
      setSearching(false);
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
  }, [q, picked]);

  const shown = results.filter((c) => c.id !== exclude);

  return (
    <div className="card-surface p-5">
      <label htmlFor={inputId} className="block text-sm font-semibold">
        {step}. {title}
      </label>
      <p className="text-xs text-muted-foreground">{hint}</p>

      {picked ? (
        <div className="mt-3 flex items-start gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{picked.name}</div>
            <div className="text-2xs text-muted-foreground truncate tabular-nums">{identifiers(picked)}</div>
            <div className="text-2xs text-muted-foreground tabular-nums">
              {picked.aum > 0 ? inr(picked.aum) : "No AUM"} · {picked.folios} folio{picked.folios === 1 ? "" : "s"}
            </div>
          </div>
          <button type="button" onClick={() => { onPick(null); setQ(""); }} className={buttonClass("ghost", "sm")}>
            <X className="size-3.5" aria-hidden /> Change
          </button>
        </div>
      ) : (
        <>
          <div className="relative mt-3">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              id={inputId}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, PAN, mobile or email"
              className="input-base w-full pl-9"
              autoComplete="off"
            />
            {searching && <Loader2 className="size-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
          {q.trim().length >= 2 && !searching && shown.length === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">No clients match that search.</p>
          )}
          {shown.length > 0 && (
            <ul className="mt-3 max-h-72 overflow-y-auto divide-y divide-border rounded-lg border border-border">
              {shown.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onPick(c)}
                    className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-secondary/50 transition"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium truncate">{c.name}</span>
                      <span className="block text-2xs text-muted-foreground truncate tabular-nums">{identifiers(c)}</span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block text-xs font-medium tabular-nums">{c.aum > 0 ? inr(c.aum) : "No AUM"}</span>
                      <span className="block text-2xs text-muted-foreground">{c.folios} folio{c.folios === 1 ? "" : "s"}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function ChosenCard({ label, c, highlight }: { label: string; c: Candidate; highlight?: boolean }) {
  return (
    <div className={`rounded-lg px-4 py-3 ${highlight ? "border border-primary/40 bg-primary/5" : "bg-secondary/70"}`}>
      <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold truncate">{c.name}</div>
      <div className="text-2xs text-muted-foreground truncate tabular-nums">{identifiers(c)}</div>
      <div className="text-2xs text-muted-foreground tabular-nums">
        {c.aum > 0 ? inr(c.aum) : "No AUM"} · {c.folios} folio{c.folios === 1 ? "" : "s"}
      </div>
    </div>
  );
}
