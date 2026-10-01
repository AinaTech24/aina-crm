"use client";

/**
 * Start a new discovery — find the client or lead it is for, and create the
 * fact-find.
 *
 * The search box used to sit in a box that shrank to its content (a centring
 * grid sized the track to the card), so the placeholder was cut off at "by na"
 * and every result was squeezed. Now a Radix dialog at a fixed width, opened
 * near the top so the list can grow downwards, with:
 *  · a debounced search that ignores late answers to an older query, so typing
 *    fast never shows results for what was typed three letters ago;
 *  · ↑ ↓ and Enter to pick without the mouse, Esc to close;
 *  · one list, clients first, each row saying whether it is a client or a lead.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Loader2, X, ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/Dialog";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/button-class";
import { formatPhone } from "@/lib/utils";
import { humanise } from "@/lib/format";

type Hit = {
  id: string;
  name: string;
  type: "investor" | "lead";
  pan?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Segment for a client, stage for a lead. */
  tag?: string | null;
};

const MIN_CHARS = 2;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

export function NewDiscoveryDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);
  const listRef = useRef<HTMLUListElement>(null);

  const term = q.trim();

  // Debounced search; a reply to an older query is dropped.
  useEffect(() => {
    if (term.length < MIN_CHARS) {
      setHits([]);
      setBusy(false);
      return;
    }
    const mine = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        const j = res.ok ? await res.json() : {};
        if (mine !== seq.current) return;
        const clients: Hit[] = (j.investors ?? []).slice(0, 8).map((h: any) => ({
          id: h.id, name: h.name, type: "investor", pan: h.pan, phone: h.phone, email: h.email, tag: h.segment_tag,
        }));
        const leads: Hit[] = (j.leads ?? []).slice(0, 6).map((h: any) => ({
          id: h.id, name: h.name, type: "lead", phone: h.phone, email: h.email, tag: h.stage ? humanise(String(h.stage)) : null,
        }));
        setHits([...clients, ...leads]);
        setActive(0);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [term]);

  // Keep the highlighted row in view while arrowing through the list.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function reset() {
    setQ("");
    setHits([]);
    setActive(0);
    setErr(null);
  }

  async function create(h: Hit) {
    setCreating(h.id);
    setErr(null);
    try {
      const res = await fetch("/api/discovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subjectType: h.type, subjectId: h.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.id) {
        setErr(j.error ?? "Couldn't start the discovery. Please try again.");
        return;
      }
      router.push(`/dashboard/discovery/${j.id}`);
    } finally {
      setCreating(null);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!hits.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % hits.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + hits.length) % hits.length); }
    else if (e.key === "Enter") { e.preventDefault(); const h = hits[active]; if (h && !creating) void create(h); }
  }

  const status = useMemo(() => {
    if (term.length < MIN_CHARS) return "hint";
    if (busy && hits.length === 0) return "loading";
    if (!busy && hits.length === 0) return "none";
    return "results";
  }, [term, busy, hits.length]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("primary", "md")}>
        <Plus className="size-4" /> New discovery
      </button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent
          showClose={false}
          className="top-24 max-w-xl translate-y-0 overflow-hidden p-0"
          onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector("input")?.focus(); }}
        >
          <div className="flex items-start justify-between gap-3 px-5 pt-5">
            <div>
              <DialogTitle>Start a financial discovery</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs">
                Pick the client or lead this fact-find is for.
              </DialogDescription>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn-icon -mr-2 -mt-1"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Search */}
          <div className="px-5 pb-3 pt-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Name, PAN, mobile or email"
                aria-label="Search clients and leads"
                role="combobox"
                aria-expanded={status === "results"}
                aria-controls="discovery-results"
                aria-activedescendant={status === "results" ? `discovery-hit-${active}` : undefined}
                className="input-base h-11 w-full pl-10 pr-10 text-sm"
              />
              {busy ? (
                <Loader2 className="absolute right-3.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
              ) : q ? (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          </div>

          {/* Results */}
          <div className="border-t border-border">
            {status === "hint" && (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                Start typing — at least {MIN_CHARS} letters of a name, or a PAN, mobile or email.
              </p>
            )}
            {status === "loading" && (
              <p className="flex items-center justify-center gap-2 px-5 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Searching…
              </p>
            )}
            {status === "none" && (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                No client or lead matches “{term}”.
              </p>
            )}
            {status === "results" && (
              <ul id="discovery-results" ref={listRef} role="listbox" className="max-h-80 overflow-y-auto p-2">
                {hits.map((h, i) => {
                  const on = i === active;
                  const sub = [h.pan, h.phone ? formatPhone(h.phone) : null, h.email].filter(Boolean).join(" · ");
                  return (
                    <li key={`${h.type}-${h.id}`} id={`discovery-hit-${i}`} data-index={i} role="option" aria-selected={on}>
                      <button
                        type="button"
                        onClick={() => create(h)}
                        onMouseMove={() => setActive(i)}
                        disabled={!!creating}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
                          on ? "bg-secondary" : "hover:bg-secondary/60"
                        }`}
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-primary" aria-hidden>
                          {initials(h.name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">{h.name}</span>
                            <Badge raw>{h.type === "investor" ? "Client" : "Lead"}</Badge>
                            {h.tag && <span className="truncate text-2xs text-muted-foreground">{h.tag}</span>}
                          </span>
                          {sub && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{sub}</span>}
                        </span>
                        {creating === h.id ? (
                          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                        ) : (
                          <ArrowRight className={`size-4 shrink-0 text-muted-foreground transition-opacity ${on ? "opacity-100" : "opacity-0"}`} aria-hidden />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {err && <p className="border-t border-border px-5 py-3 text-sm text-destructive">{err}</p>}
          </div>

          {/* Keyboard help */}
          <div className="flex items-center gap-4 border-t border-border bg-secondary/40 px-5 py-2.5 text-2xs text-muted-foreground">
            <span><kbd className="font-sans font-semibold">↑ ↓</kbd> to move</span>
            <span><kbd className="font-sans font-semibold">Enter</kbd> to start</span>
            <span><kbd className="font-sans font-semibold">Esc</kbd> to close</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
