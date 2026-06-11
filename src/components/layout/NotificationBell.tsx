"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, AlertTriangle, CheckCircle2, Info, AlertOctagon, Cake } from "lucide-react";

type Notification = {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
  severity: "info" | "success" | "warning" | "critical";
  readAt?: string | null;
  createdAt: string;
};

const SEVERITY = {
  info: { icon: Info, color: "text-blue-600" },
  success: { icon: CheckCircle2, color: "text-emerald-600" },
  warning: { icon: AlertTriangle, color: "text-amber-600" },
  critical: { icon: AlertOctagon, color: "text-rose-600" },
} as const;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  // Poll every 30s for unread count
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/notifications");
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled) return;
        setItems(j.notifications ?? []);
        setUnread(j.unreadCount ?? 0);
      } catch {}
    }
    load();
    const i = setInterval(load, 90_000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, []);

  // Click-outside to close
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function markAllRead() {
    await fetch("/api/notifications/mark-read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    setItems((arr) => arr.map((n) => ({ ...n, readAt: new Date().toISOString() })));
    setUnread(0);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-1.5 hover:bg-accent"
        aria-label="Notifications"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 size-4 grid place-items-center rounded-full bg-rose-600 text-white text-[10px] font-semibold">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 border bg-card rounded-md shadow-lg w-80 max-h-[70vh] overflow-y-auto z-40">
          <div className="border-b px-3 py-2 flex items-center justify-between">
            <div className="font-medium text-sm">Notifications</div>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-primary hover:underline">
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No notifications yet.</div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                // Today's-birthday reminder is a live, pinned nudge — distinct
                // look (cake + violet wash), a "Today" label, and no unread dot.
                const isBday = n.kind === "birthday_today";
                const Sev = SEVERITY[n.severity] ?? SEVERITY.info;
                const Icon = isBday ? Cake : Sev.icon;
                const Inner = (
                  <div className={`flex items-start gap-2 px-3 py-2 hover:bg-accent ${isBday ? "bg-violet-50/60 dark:bg-violet-950/40" : ""} ${!isBday && n.readAt ? "opacity-60" : ""}`}>
                    <Icon className={`size-4 mt-0.5 flex-shrink-0 ${isBday ? "text-violet-600" : Sev.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium leading-tight">{n.title}</div>
                      {n.body && <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</div>}
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {isBday
                          ? "Today · tap to wish them"
                          : new Date(n.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                      </div>
                    </div>
                    {!isBday && !n.readAt && <span className="size-1.5 rounded-full bg-primary mt-1.5" />}
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.linkUrl ? (
                      <Link href={n.linkUrl} onClick={() => setOpen(false)}>{Inner}</Link>
                    ) : (
                      Inner
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
