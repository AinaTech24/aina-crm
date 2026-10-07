"use client";

/**
 * SchemeAutocomplete — the one scheme picker in the CRM. It searches the
 * firm's Scheme Master (GET /api/mf/schemes, source=master): every scheme
 * field picks from that module, never free text. Picking also hands back the
 * scheme's AMC, category, NAV and riskometer band.
 *
 *   <SchemeAutocomplete onSelect={(s) => { setScheme(s.schemeName); setAmc(s.amc); }} />
 *
 * - Pick-only by default: typed text that is not a picked scheme is never
 *   committed, and leaving the box reverts it to the last pick. `onClear`
 *   fires when the user starts changing a picked scheme, so the form drops it.
 * - `amc` narrows the list to one AMC (scheme_master.amc_code).
 * - `source="universe"` searches the whole AMFI list instead — only the Scheme
 *   Master page itself uses it, to ADD a scheme to the master.
 * - `allowFreeText` keeps the old behaviour for a non-MF line (PMS / AIF),
 *   where there is no master to pick from.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Search, Loader2, Check } from "lucide-react";

export type SchemeRisk = { band: number; label: string; tone: string };
export type SchemePick = {
  schemeCode: string;
  schemeName: string;
  amc: string | null;
  category: string | null;
  nav: number | null;
  navDate: string | null;
  /** SEBI riskometer band: the Scheme Master's Risk, else derived from the
   *  scheme category (best-effort). */
  risk?: SchemeRisk | null;
  /** Regular / Direct — the Scheme Master's Plan, else from the scheme name. */
  plan?: "regular" | "direct" | null;
};

export function SchemeAutocomplete({
  onSelect,
  onQueryChange,
  onClear,
  defaultValue = "",
  placeholder = "Search the Scheme Master…",
  className = "",
  size = "md",
  amc,
  source = "master",
  plan,
  allowFreeText = false,
  id,
  "aria-describedby": describedBy,
}: {
  onSelect: (s: SchemePick) => void;
  /** Fires on every keystroke — only meaningful with `allowFreeText`. */
  onQueryChange?: (q: string) => void;
  /** The user started changing a picked scheme: the form should drop it. */
  onClear?: () => void;
  defaultValue?: string;
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
  /** Narrow to one AMC (its scheme_master.amc_code / amc_master.code). */
  amc?: string | null;
  source?: "master" | "universe";
  /** "regular" lists Regular plans only — what a proposal may recommend. */
  plan?: "regular";
  allowFreeText?: boolean;
  id?: string;
  "aria-describedby"?: string;
}) {
  const [q, setQ] = useState(defaultValue);
  const [picked, setPicked] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SchemePick[]>([]);
  const [masterEmpty, setMasterEmpty] = useState(false);
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);
  const strict = !allowFreeText;

  // A parent that resets the field (new line, cleared form) re-seeds it —
  // except the empty value our own onClear just caused, mid-typing.
  const clearedByMe = useRef(false);
  useEffect(() => {
    if (clearedByMe.current && !defaultValue) { clearedByMe.current = false; return; }
    clearedByMe.current = false;
    setQ(defaultValue);
    setPicked(defaultValue);
  }, [defaultValue]);

  function close() {
    setOpen(false);
    // Pick-only: whatever was typed but not picked goes back to the last pick.
    if (strict) setQ((cur) => (cur === picked ? cur : picked));
  }

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  useEffect(() => {
    const query = q.trim();
    const browsingAmc = source === "master" && !!amc && open;
    if (query.length < 2 && !browsingAmc) {
      setResults([]);
      setBusy(false); // clear a leftover spinner when the query is cleared back under 2 chars
      return;
    }
    if (query === picked && !open) return;
    const id = ++reqId.current;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const p = new URLSearchParams({ q: query, limit: "20", source });
        if (amc && source === "master") p.set("amc", amc);
        if (plan) p.set("plan", plan);
        const res = await fetch(`/api/mf/schemes?${p}`);
        const j = await res.json().catch(() => ({}));
        if (id === reqId.current) {
          setResults(Array.isArray(j.schemes) ? j.schemes : []);
          setMasterEmpty(!!j.masterEmpty);
          setActive(-1);
        }
      } finally {
        if (id === reqId.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, amc, source, plan, open, picked]);

  function pick(s: SchemePick) {
    onSelect(s);
    setQ(s.schemeName);
    setPicked(s.schemeName);
    setOpen(false);
  }

  function type(v: string) {
    setQ(v);
    setOpen(true);
    if (allowFreeText) onQueryChange?.(v);
    else if (picked && v !== picked) { setPicked(""); clearedByMe.current = true; onClear?.(); }
  }

  const sizes = size === "sm" ? "h-8 text-xs pl-8 pr-2.5" : "h-9 text-sm pl-9 pr-3";
  const showList = open && (q.trim().length >= 2 || (source === "master" && !!amc));

  return (
    <div ref={ref} className={`relative ${className}`}>
      <div className="relative">
        <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${size === "sm" ? "size-3.5" : "size-4"} text-muted-foreground`} />
        <input
          id={id}
          aria-describedby={describedBy}
          role="combobox"
          aria-expanded={showList}
          aria-autocomplete="list"
          value={q}
          onChange={(e) => type(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter" && active >= 0 && results[active]) { e.preventDefault(); pick(results[active]); }
            else if (e.key === "Escape" || e.key === "Tab") close();
          }}
          placeholder={placeholder}
          className={`w-full rounded-lg border border-border bg-card font-medium ${sizes} focus:outline-none focus:border-brand-cyan/60 focus:ring-2 focus:ring-brand-cyan/15`}
        />
        {busy && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-brand-cyan" />}
      </div>

      {showList && (
        <ul className="absolute left-0 right-0 top-full mt-1 z-50 max-h-72 overflow-y-auto scrollbar-thin card-elevated bg-card p-1 animate-scale-in">
          {results.length === 0 && !busy && (
            <li className="px-2.5 py-2 text-xs text-muted-foreground">
              {masterEmpty && source === "master" ? (
                <>Your Scheme Master is empty. <Link href="/dashboard/schemes" className="font-medium text-foreground underline">Open Scheme Master</Link> and sync it from AMFI.</>
              ) : source === "master" ? (
                <>No scheme in your Scheme Master matches “{q.trim()}”{amc ? " for this AMC" : ""}. Add it in <Link href="/dashboard/schemes" className="font-medium text-foreground underline">Scheme Master</Link>.</>
              ) : (
                <>No schemes match “{q.trim()}”.</>
              )}
            </li>
          )}
          {results.map((s, i) => (
            <li key={s.schemeCode}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(s)}
                className={`w-full text-left rounded-md px-2.5 py-1.5 transition ${i === active ? "bg-brand-cyan-light/60" : "hover:bg-secondary"}`}
              >
                <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Check className={`size-3 text-brand-cyan shrink-0 ${s.schemeName === picked ? "" : "opacity-0"}`} />
                  <span className="truncate">{s.schemeName}</span>
                  {s.risk && (
                    <span className={`shrink-0 chip text-2xs leading-none px-1.5 py-0.5 border ${s.risk.tone}`} title={`Risk: ${s.risk.label}`}>
                      {s.risk.label}
                    </span>
                  )}
                </div>
                <div className="text-2xs text-muted-foreground pl-[1.125rem] flex items-center gap-2">
                  {s.amc && <span className="truncate">{s.amc}</span>}
                  {s.category && <span className="truncate">· {s.category}</span>}
                  {s.nav != null && <span className="tabular-nums shrink-0">· NAV ₹{s.nav.toFixed(2)}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
