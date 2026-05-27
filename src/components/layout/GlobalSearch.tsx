"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, Users, Sparkles, FileText, Repeat, LifeBuoy, FolderArchive, Loader2 } from "lucide-react";

type Results = {
  investors?: any[];
  leads?: any[];
  folios?: any[];
  sips?: any[];
  serviceRequests?: any[];
  documents?: any[];
};

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Results>({});
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl-K to open
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced search
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults({});
      return;
    }
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const j = await res.json();
        setResults(j);
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const total =
    (results.investors?.length ?? 0) +
    (results.leads?.length ?? 0) +
    (results.folios?.length ?? 0) +
    (results.sips?.length ?? 0) +
    (results.serviceRequests?.length ?? 0) +
    (results.documents?.length ?? 0);

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className="flex items-center gap-2 text-xs text-muted-foreground border border-border bg-card rounded-lg px-3 py-2 shadow-sm hover:shadow hover:border-brand-cyan/40 hover:text-foreground min-w-[260px] transition-all duration-150"
      >
        <Search className="size-3.5 text-brand-cyan" />
        <span className="flex-1 text-left">Search investors, leads, folios…</span>
        <kbd className="hidden md:inline border border-border rounded px-1.5 py-0.5 text-[10px] bg-secondary/60 font-mono">
          Ctrl K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-brand-navy/40 backdrop-blur-md grid place-items-start pt-[12vh] px-4 animate-fade-in"
          onClick={() => setOpen(false)}
        >
          <div
            className="card-elevated max-w-2xl w-full max-h-[70vh] flex flex-col overflow-hidden animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-border bg-secondary/30 p-3.5 flex items-center gap-2.5">
              <Search className="size-4 text-brand-cyan" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, PAN, mobile, folio, ticket, SIP scheme…"
                className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
              />
              {busy && <Loader2 className="size-3.5 animate-spin text-brand-cyan" />}
              <kbd className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5 bg-card font-mono">
                Esc
              </kbd>
            </div>

            <div className="flex-1 overflow-y-auto p-2 text-sm">
              {q.length < 2 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  Type at least 2 characters. Try a name, PAN, mobile, folio number, or ticket #.
                </div>
              ) : total === 0 && !busy ? (
                <div className="p-6 text-center text-xs text-muted-foreground">No results for "{q}".</div>
              ) : (
                <div className="space-y-3">
                  <Group icon={Users} label="Investors" items={results.investors ?? []} onPick={() => setOpen(false)}
                    href={(r) => `/dashboard/investors/${r.id}`}
                    primary={(r) => r.name}
                    secondary={(r) => `${r.pan ?? "—"} · ${r.segment_tag ?? "—"}`}
                  />
                  <Group icon={Sparkles} label="Leads" items={results.leads ?? []} onPick={() => setOpen(false)}
                    href={(r) => `/dashboard/leads/${r.id}`}
                    primary={(r) => r.name}
                    secondary={(r) => `${r.stage} · ${r.source}`}
                  />
                  <Group icon={FileText} label="Folios" items={results.folios ?? []} onPick={() => setOpen(false)}
                    href={(r) => r.investor_id ? `/dashboard/investors/${r.investor_id}` : `/dashboard/investors`}
                    primary={(r) => `${r.folio_number}`}
                    secondary={(r) => `${r.amc_name} · ${r.investor_name ?? "—"}`}
                  />
                  <Group icon={Repeat} label="SIPs" items={results.sips ?? []} onPick={() => setOpen(false)}
                    href={(r) => `/dashboard/sips`}
                    primary={(r) => r.scheme_name}
                    secondary={(r) => `₹${r.amount}/mo · ${r.investor_name ?? "—"} · ${r.status}`}
                  />
                  <Group icon={LifeBuoy} label="Service requests" items={results.serviceRequests ?? []} onPick={() => setOpen(false)}
                    href={() => `/dashboard/service-requests`}
                    primary={(r) => r.subject}
                    secondary={(r) => `${r.ticket_no} · ${r.investor_name ?? "—"} · ${r.status}`}
                  />
                  <Group icon={FolderArchive} label="Documents" items={results.documents ?? []} onPick={() => setOpen(false)}
                    href={() => `/dashboard/documents`}
                    primary={(r) => r.name}
                    secondary={(r) => r.category}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Group({
  icon: Icon,
  label,
  items,
  href,
  primary,
  secondary,
  onPick,
}: {
  icon: any;
  label: string;
  items: any[];
  href: (r: any) => string;
  primary: (r: any) => string;
  secondary: (r: any) => string;
  onPick: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="px-2 py-1.5 text-[10px] uppercase tracking-[0.1em] font-bold text-muted-foreground/80 flex items-center gap-1.5">
        <Icon className="size-3 text-brand-cyan" /> {label}
        <span className="ml-auto text-muted-foreground/50 normal-case font-medium">
          {items.length}
        </span>
      </div>
      <ul className="space-y-0.5">
        {items.map((r) => (
          <li key={r.id}>
            <Link
              href={href(r)}
              onClick={onPick}
              className="block px-2.5 py-2 rounded-lg hover:bg-brand-cyan-light/40 hover:translate-x-0.5 transition-all duration-100"
            >
              <div className="font-medium text-sm">{primary(r)}</div>
              <div className="text-xs text-muted-foreground">{secondary(r)}</div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
