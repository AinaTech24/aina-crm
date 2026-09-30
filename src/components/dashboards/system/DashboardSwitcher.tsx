"use client";

/**
 * The dashboard name as a dropdown, Zoho-style (D7): searchable, keyboard
 * friendly, grouped into Favourites · Assigned to me · Created by me · Shared
 * with me · Other users' dashboards (managers only), with "+ New dashboard" and
 * "Manage dashboards" at the foot. The star beside it favourites the current one.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Lock, Star } from "lucide-react";
import { notify } from "@/components/ui/Toast";

export type SwitcherItem = {
  id: string;
  name: string;
  isSystem: boolean;
  locked: boolean;
  isFavourite: boolean;
  isMyDefault: boolean;
  ownerName: string | null;
  group: "assigned" | "mine" | "shared" | "others";
};

const GROUPS: Array<{ key: string; label: string; pick: (i: SwitcherItem) => boolean }> = [
  { key: "fav", label: "Favourites", pick: (i) => i.isFavourite },
  { key: "assigned", label: "Assigned to me", pick: (i) => i.group === "assigned" },
  { key: "mine", label: "Created by me", pick: (i) => i.group === "mine" },
  { key: "shared", label: "Shared with me", pick: (i) => i.group === "shared" },
  { key: "others", label: "Other users' dashboards", pick: (i) => i.group === "others" },
];

export function DashboardSwitcher({
  current,
  items,
  isFavourite,
}: {
  current: { id: string; name: string };
  items: SwitcherItem[];
  isFavourite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [fav, setFav] = useState(isFavourite);
  const [cursor, setCursor] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setFav(isFavourite), [isFavourite]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    setTimeout(() => input.current?.focus(), 0);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (i: SwitcherItem) => !needle || i.name.toLowerCase().includes(needle);
    return GROUPS.map((g) => ({ ...g, list: items.filter((i) => g.pick(i) && match(i)) })).filter((g) => g.list.length);
  }, [items, q]);
  const flat = groups.flatMap((g) => g.list);

  function go(id: string) {
    setOpen(false);
    router.push(`/dashboard/${id}`);
  }

  async function toggleFav() {
    const next = !fav;
    setFav(next);
    const res = await fetch(`/api/dashboards/${current.id}/prefs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favourite: next }),
    });
    if (!res.ok) {
      setFav(!next);
      notify.error("Could not update favourites");
    } else {
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0" ref={ref}>
      <h1 className="sr-only">{current.name}</h1>
      <div className="relative min-w-0">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 -ml-2 hover:bg-secondary min-w-0"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => {
            setOpen((o) => !o);
            setCursor(0);
          }}
        >
          <span className="page-title truncate">{current.name}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1 z-50 w-80 rounded-xl border border-border bg-card shadow-xl">
            <div className="p-2 border-b border-border">
              <label htmlFor="dash-search" className="sr-only">Find a dashboard</label>
              <input
                id="dash-search"
                ref={input}
                className="input-base w-full text-sm"
                placeholder="Find a dashboard"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(flat.length - 1, c + 1)); }
                  if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
                  if (e.key === "Enter" && flat[cursor]) go(flat[cursor].id);
                  if (e.key === "Escape") setOpen(false);
                }}
              />
            </div>
            <div className="max-h-80 overflow-y-auto py-1" role="listbox" aria-label="Dashboards">
              {groups.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No dashboard matches.</p>}
              {groups.map((g) => (
                <div key={g.key} className="py-1">
                  <div className="px-3 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">{g.label}</div>
                  {g.list.map((i) => {
                    const idx = flat.indexOf(i);
                    return (
                      <button
                        key={`${g.key}:${i.id}`}
                        type="button"
                        role="option"
                        aria-selected={i.id === current.id}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-secondary ${idx === cursor ? "bg-secondary" : ""} ${i.id === current.id ? "font-semibold" : ""}`}
                        onMouseEnter={() => setCursor(idx)}
                        onClick={() => go(i.id)}
                      >
                        <span className="flex-1 truncate">{i.name}</span>
                        {i.isMyDefault && <span className="text-xs text-muted-foreground">Default</span>}
                        {i.locked && <Lock className="size-3 text-muted-foreground" aria-label="Locked" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border p-2 text-sm">
              <Link href="/dashboard/new" className="font-medium text-primary hover:underline" onClick={() => setOpen(false)}>
                + New dashboard
              </Link>
              <Link href="/dashboard/manage" className="text-muted-foreground hover:text-foreground hover:underline" onClick={() => setOpen(false)}>
                Manage dashboards
              </Link>
            </div>
          </div>
        )}
      </div>
      <button
        type="button"
        className="btn-icon shrink-0"
        aria-pressed={fav}
        aria-label={fav ? "Remove from favourites" : "Add to favourites"}
        title={fav ? "Remove from favourites" : "Add to favourites"}
        onClick={toggleFav}
      >
        <Star className={`size-4 ${fav ? "fill-amber-400 text-amber-500" : "text-muted-foreground"}`} aria-hidden />
      </button>
    </div>
  );
}
