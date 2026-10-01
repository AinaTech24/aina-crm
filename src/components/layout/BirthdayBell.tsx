"use client";

/**
 * Header birthday widget (cake icon) — adopted from the Sanchay birthday
 * popup. Shows client birthdays bucketed Past / Today / Tomorrow with a
 * count badge, and a "View all" link to the filtered client list.
 *
 * Data: GET /api/birthdays (role-scoped — firm-wide for owners, own-book for
 * RMs). Polls every 5 min and refreshes when opened.
 *
 * Today's rows carry "Send wish": the same WhatsApp click-to-chat and greeting
 * as My Day, sent from the advisor's own WhatsApp, and it clears the client
 * from My Day's birthday list too.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Cake, ArrowRight, MessageCircle, Check } from "lucide-react";
import { formatDate } from "@/lib/format";
import { Tooltip } from "@/components/ui/Tooltip";
import { buttonClass } from "@/components/ui/button-class";

type Item = {
  id: string;
  name: string;
  dob: string;
  turning: number | null;
  /** Mobile in wa.me form (country code, digits only), or null when none is on file. */
  waPhone: string | null;
};
type Bucket = "past" | "today" | "tomorrow";

/** Same greeting My Day sends (src/app/dashboard/command-center/page.tsx). */
function wishText(name: string): string {
  return `Dear ${name}, wishing you a very happy birthday! 🎂 May the year ahead bring you health, happiness and prosperity.`;
}

export function BirthdayBell() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Bucket>("today");
  const [data, setData] = useState<{ past: Item[]; today: Item[]; tomorrow: Item[] }>({
    past: [],
    today: [],
    tomorrow: [],
  });
  // Wished this session — the row confirms instead of offering the button again.
  const [wished, setWished] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  function sendWish(it: Item) {
    if (!it.waPhone) return;
    window.open(`https://wa.me/${it.waPhone}?text=${encodeURIComponent(wishText(it.name))}`, "_blank", "noopener,noreferrer");
    setWished((s) => new Set(s).add(it.id));
    // Drop it from My Day's "Birthdays today" as well, exactly as wishing there does.
    void fetch("/api/command-center/snooze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemKey: `birthdays_today:${it.id}`, action: "dismiss" }),
    }).catch(() => {});
  }

  async function load() {
    try {
      const res = await fetch("/api/birthdays");
      if (!res.ok) return;
      const j = await res.json();
      setData({ past: j.past ?? [], today: j.today ?? [], tomorrow: j.tomorrow ?? [] });
    } catch {}
  }

  useEffect(() => {
    load();
    const i = setInterval(load, 15 * 60_000);
    return () => clearInterval(i);
  }, []);

  // Default to whichever bucket has people, preferring Today → Tomorrow → Past.
  useEffect(() => {
    if (data.today.length) setTab("today");
    else if (data.tomorrow.length) setTab("tomorrow");
    else if (data.past.length) setTab("past");
  }, [data]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const todayCount = data.today.length;
  const items = data[tab];

  const TABS: { key: Bucket; label: string }[] = [
    { key: "past", label: "Past" },
    { key: "today", label: "Today" },
    { key: "tomorrow", label: "Tomorrow" },
  ];

  return (
    <div className="relative" ref={ref}>
      <Tooltip label="Birthdays today" hidden={open}>
        <button
          type="button"
          onClick={() => { setOpen((o) => !o); if (!open) load(); }}
          className="relative size-9 rounded-full bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground grid place-items-center transition-colors"
          aria-label="Birthdays today"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <Cake className="size-4" />
          {todayCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 size-4 grid place-items-center rounded-full bg-rose-500 text-white text-2xs font-semibold">
              {todayCount > 9 ? "9+" : todayCount}
            </span>
          )}
        </button>
      </Tooltip>

      {open && (
        // 24rem: the client's full name and the three tab labels ("Tomorrow
        // (12)") need the room beside Send wish. The bell only shows from sm up
        // (layout.tsx), where 24rem still clears the left edge.
        <div className="absolute right-0 top-full mt-2 border bg-card rounded-lg shadow-lg w-96 z-40 overflow-hidden">
          {/* Tabs */}
          <div className="grid grid-cols-3 border-b">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                  tab === t.key
                    ? "bg-brand-cyan-deep text-white"
                    : "bg-secondary/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
                {data[t.key].length > 0 && (
                  <span className={`ml-1 ${tab === t.key ? "text-white/80" : "text-muted-foreground"}`}>
                    ({data[t.key].length})
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* List */}
          {items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Cake className="size-9 text-muted-foreground/40 mx-auto mb-2" />
              <div className="text-sm text-muted-foreground">
                No birthdays {tab === "today" ? "today" : tab === "tomorrow" ? "tomorrow" : "in the last 30 days"}.
              </div>
            </div>
          ) : (
            <ul className="divide-y max-h-[50vh] overflow-y-auto">
              {items.map((it) => (
                <li key={it.id} className="flex items-center gap-2 pr-3 hover:bg-accent transition-colors">
                  <Link
                    href={`/dashboard/investors/${it.id}`}
                    onClick={() => setOpen(false)}
                    className="flex flex-1 min-w-0 items-center gap-2.5 py-2.5 pl-4"
                  >
                    <span className="size-8 rounded-full bg-violet-50 text-violet-600 grid place-items-center flex-shrink-0">
                      <Cake className="size-4" />
                    </span>
                    <div className="flex-1 min-w-0">
                      {/* The full name, wrapping if it must — never cut to "Rajinder Kumar …". */}
                      <div className="text-sm font-medium break-words">{it.name}</div>
                      <div className="text-2xs text-muted-foreground">
                        {tab === "today"
                          ? it.turning ? `Turns ${it.turning} today 🎉` : "Birthday today 🎉"
                          : tab === "tomorrow"
                          ? it.turning ? `Turns ${it.turning} tomorrow` : "Birthday tomorrow"
                          : `Birthday ${fmtDM(it.dob)}`}
                      </div>
                    </div>
                    {tab !== "today" && <ArrowRight className="size-3.5 text-muted-foreground" />}
                  </Link>
                  {tab === "today" &&
                    (wished.has(it.id) ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
                        <Check className="size-3.5" /> Wished
                      </span>
                    ) : it.waPhone ? (
                      <button
                        type="button"
                        onClick={() => sendWish(it)}
                        title={`Opens WhatsApp with a birthday greeting for ${it.name}`}
                        className={buttonClass("secondary", "sm", "shrink-0")}
                      >
                        <MessageCircle className="size-3.5" /> Send wish
                      </button>
                    ) : (
                      // A disabled button can't say why; the reason is the label.
                      <span className="shrink-0 text-xs text-muted-foreground">No mobile</span>
                    ))}
                </li>
              ))}
            </ul>
          )}

          {/* View all — respects the selected tab (today / tomorrow / past). */}
          {(() => {
            const va =
              tab === "tomorrow"
                ? { href: "/dashboard/investors?birthday_tomorrow=1", label: "View all tomorrow's birthdays" }
                : tab === "past"
                ? { href: "/dashboard/investors?birthday_past=1", label: "View all recent birthdays" }
                : { href: "/dashboard/investors?birthday_today=1", label: "View all today's birthdays" };
            return (
              <Link
                href={va.href}
                onClick={() => setOpen(false)}
                className="block text-center px-4 py-2.5 text-xs font-medium text-brand-cyan-deep hover:underline border-t bg-card"
              >
                {va.label} →
              </Link>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function fmtDM(dob: string): string {
  const d = new Date(dob);
  if (isNaN(d.getTime())) return "—";
  return formatDate(d, "dayMonth");
}
