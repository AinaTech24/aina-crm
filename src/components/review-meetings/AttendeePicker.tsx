"use client";

/**
 * The meeting Attendees lookup: one search over team members, clients and
 * leads (GET /api/review-meetings/attendee-search). Picking a record links the
 * attendee to it, which is what makes the meeting show up for that person. A
 * name the CRM does not know (a client's CA, an AMC RM) is added as a guest.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { roleForKind, type AttendeeHit, type MeetingAttendee } from "@/lib/review-meetings/attendee-kinds";

const GROUP_LABEL: Record<AttendeeHit["kind"], string> = { user: "Team", client: "Clients", lead: "Leads" };

export function AttendeePicker({ onPick, taken }: {
  onPick: (a: MeetingAttendee) => void;
  /** `kind:refId` of attendees already on the meeting. */
  taken: Set<string>;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<AttendeeHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
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
        const r = await fetch(`/api/review-meetings/attendee-search?q=${encodeURIComponent(term)}`);
        const j = await r.json().catch(() => ({ hits: [] }));
        if (mine === seq.current) {
          setHits(r.ok ? (j.hits as AttendeeHit[]) : []);
          setActive(0);
        }
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const term = q.trim();
  // Every pickable row in display order; the guest row comes last.
  const rows: Array<{ hit?: AttendeeHit; guest?: string }> = [
    ...(hits ?? []).filter((h) => !taken.has(`${h.kind}:${h.id}`)).map((hit) => ({ hit })),
    ...(term.length >= 2 ? [{ guest: term }] : []),
  ];

  function pick(i: number) {
    const row = rows[i];
    if (!row) return;
    if (row.hit) {
      const h = row.hit;
      onPick({ name: h.name, kind: h.kind, refId: h.id, role: roleForKind(h.kind), isExternal: h.kind !== "user" });
    } else if (row.guest) {
      onPick({ name: row.guest, kind: "guest", role: "other", isExternal: true });
    }
    setQ("");
    setHits(null);
    setOpen(false);
  }

  let lastKind: string | null = null;
  return (
    <div
      className="relative"
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <label htmlFor="attendee-search" className="sr-only">Add an attendee</label>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        id="attendee-search"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(active); }
          else if (e.key === "Escape") setOpen(false);
        }}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && rows.length > 0}
        aria-controls="attendee-results"
        placeholder="Search team, clients or leads…"
        className="input-base pl-9"
      />
      {busy && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}

      {open && rows.length > 0 && (
        <ul
          id="attendee-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-lg"
        >
          {rows.map((row, i) => {
            const heading = row.hit && row.hit.kind !== lastKind ? GROUP_LABEL[row.hit.kind] : null;
            if (row.hit) lastKind = row.hit.kind;
            return (
              <li key={row.hit ? `${row.hit.kind}:${row.hit.id}` : "guest"} role="presentation">
                {heading && <div className="px-3 pb-1 pt-2 text-2xs font-semibold text-muted-foreground">{heading}</div>}
                {row.guest && <div className="mx-3 my-1 border-t border-border/60" />}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                  className={cn("flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                    i === active ? "bg-accent" : "hover:bg-accent")}
                >
                  {row.hit ? (
                    <>
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{row.hit.name}</span>
                      {row.hit.detail && <span className="shrink-0 truncate text-2xs text-muted-foreground">{row.hit.detail}</span>}
                    </>
                  ) : (
                    <>
                      <UserPlus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">
                        Add <span className="font-medium text-foreground">“{row.guest}”</span> as a guest
                      </span>
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
