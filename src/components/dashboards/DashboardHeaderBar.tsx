"use client";

/**
 * The period picker of the full role dashboards (Branch Head, Relationship
 * Manager, Insurance Team, Claims): one dropdown with the named windows (Month /
 * Quarter / FY to date, Last month …) plus Monthly, Quarterly, Since and a
 * custom from–to. The "Dashboards" view menu and "+ New board" that used to
 * sit beside it are gone: dashboards are picked from the dashboard name's own
 * dropdown now, and "+ Add" in the top bar is the one create entry.
 *
 * The banner is a `.card-elevated` with `overflow-hidden` + `backdrop-blur`,
 * which clips absolutely/fixed-positioned children AND establishes a containing
 * block. So the dropdown panels are rendered through a PORTAL to document.body,
 * fixed-positioned under their trigger — otherwise they'd be cut off by the hero.
 *
 * Purely a URL-param writer: it sets ?period / ?pstart / ?pfrom / ?pto and the
 * server cockpit resolves the range.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import { useDashboardNav } from "@/components/dashboards/system/DashboardNav";
import { CalendarDays, ChevronDown, Check } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import type { Period } from "@/lib/dashboard/period";
import { formatDate } from "@/lib/format";
import { DateFieldInline, DateRangeField } from "@/components/ui/DateRangeField";

type SubMode = null | "monthly" | "quarterly" | "since" | "range";
type Anchor = { top: number; right: number };

/** Last day of a "YYYY-MM" month, as YYYY-MM-DD. */
function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

/** India-FY quarter options for the current + previous financial year. */
function quarterOptions(now: Date): { key: string; label: string; from: string; to: string }[] {
  const y = now.getFullYear();
  const fyStart = now.getMonth() >= 3 ? y : y - 1; // Apr–Mar
  const out: { key: string; label: string; from: string; to: string }[] = [];
  for (const fy of [fyStart, fyStart - 1]) {
    const tag = `FY${String(fy).slice(-2)}-${String(fy + 1).slice(-2)}`;
    const qs = [
      { q: "Q1", from: `${fy}-04-01`, to: `${fy}-06-30` },
      { q: "Q2", from: `${fy}-07-01`, to: `${fy}-09-30` },
      { q: "Q3", from: `${fy}-10-01`, to: `${fy}-12-31` },
      { q: "Q4", from: `${fy + 1}-01-01`, to: `${fy + 1}-03-31` },
    ];
    for (const it of qs) {
      if (new Date(it.from + "T00:00:00") > now) continue; // skip future quarters
      out.push({ key: `${fy}-${it.q}`, label: `${it.q} ${tag}`, from: it.from, to: it.to });
    }
  }
  return out;
}

/** Recent months (this month back 11) as { value: "YYYY-MM", label }. */
function monthOptions(now: Date): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ value, label: formatDate(d, "monthYear") });
  }
  return out;
}

/** Fixed-position anchor (top/right) just below a trigger element. */
function anchorFor(el: HTMLElement | null): Anchor | null {
  if (!el || typeof window === "undefined") return null;
  const r = el.getBoundingClientRect();
  return { top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) };
}

export function DashboardHeaderBar({
  period,
  currentLabel,
  variant = "light",
  children,
}: {
  period: Period;
  currentLabel: string;
  variant?: "dark" | "light";
  /**
   * The scope controls (member, branch, period chips) render INSIDE this bar,
   * ahead of the period dropdown. They used to sit in a separate flex child at
   * the far left while the period dropdown sat at the far right — two controls
   * for the same value at opposite ends of the row, with the row wrapping
   * between them on anything narrower than a very wide screen.
   */
  children?: React.ReactNode;
}) {
  const { pending, go } = useDashboardNav();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [periodOpen, setPeriodOpen] = useState(false);
  const [periodAnchor, setPeriodAnchor] = useState<Anchor | null>(null);
  const [sub, setSub] = useState<SubMode>(null);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  const periodBtnRef = useRef<HTMLButtonElement>(null);
  const periodMenuRef = useRef<HTMLDivElement>(null);
  const now = new Date();

  const closeAll = () => { setPeriodOpen(false); setSub(null); };

  // Close on outside click / Esc / page-scroll / resize. Clicks and inner-scrolls
  // inside the menus OR inside a portaled Select/DatePicker popup must NOT close
  // it — those popups live in their own body portal, so without this guard
  // picking a month/date would instantly dismiss the menu (the stutter).
  useEffect(() => {
    if (!periodOpen) return;
    const insideOurUi = (t: HTMLElement | null) =>
      !!t && (
        !!t.closest?.("[data-floating-popup]") ||
        !!periodBtnRef.current?.contains(t) || !!periodMenuRef.current?.contains(t)
      );
    function onDoc(e: MouseEvent) { if (!insideOurUi(e.target as HTMLElement)) closeAll(); }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") closeAll(); }
    function onScroll(e: Event) { if (!insideOurUi(e.target as HTMLElement)) closeAll(); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", closeAll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", closeAll);
    };
  }, [periodOpen]);

  function togglePeriod() {
    if (periodOpen) { setPeriodOpen(false); setSub(null); return; }
    setPeriodAnchor(anchorFor(periodBtnRef.current));
    setPeriodOpen(true);
  }

  function apply(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    ["period", "pstart", "pfrom", "pto"].forEach((k) => params.delete(k));
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
    const qs = params.toString();
    closeAll();
    go(`${pathname}${qs ? `?${qs}` : ""}`);
  }

  const btn = variant === "dark"
    ? "inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20 transition-colors whitespace-nowrap"
    : "inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent shadow-sm transition-colors whitespace-nowrap";
  const panel = "z-50 min-w-[13rem] max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-popover p-1.5 shadow-2xl text-foreground";
  const item = "w-full text-left rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors flex items-center justify-between gap-2";

  // The named windows a director actually asks for, in the order they think of
  // them: shortest first, each "to date" window paired with the closed period
  // before it. The richer pickers (Monthly / Quarterly / Since / Custom) stay
  // below this list.
  const simple: { key: Period; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "yd", label: "Yesterday" },
    { key: "tw", label: "This week" },
    { key: "lw", label: "Previous week" },
    { key: "mtd", label: "Month to date" },
    { key: "lm", label: "Previous month" },
    { key: "qtd", label: "Quarter to date" },
    { key: "lq", label: "Previous quarter" },
    { key: "fytd", label: "FY to date" },
    { key: "ly", label: "Previous FY" },
  ];

  const canPortal = typeof document !== "undefined";

  return (
    /* One toolbar, read left to right as: what am I looking at (scope) · over
       what period (time) · and what can I do to this page (actions). */
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-2 ${
        pending ? "opacity-60 pointer-events-none" : ""
      }`}
    >
      {children}

      {/* ---- Period filter trigger — sits with the chips it shares a value
               with, and carries the pickers they cannot (a specific month, a
               specific quarter, since-a-date, a custom range). ---- */}
      <button ref={periodBtnRef} type="button" className={btn} onClick={togglePeriod} aria-haspopup="menu" aria-expanded={periodOpen}>
        <CalendarDays className="size-3.5" /> {currentLabel} <ChevronDown className="size-3.5" />
      </button>

      {/* ---- Period menu (portaled, fixed under the trigger) ---- */}
      {canPortal && periodOpen && periodAnchor && createPortal(
        <div ref={periodMenuRef} className={`fixed ${panel} min-w-[15rem]`} style={{ top: periodAnchor.top, right: periodAnchor.right }} role="menu">
          {simple.map((s) => (
            <button key={s.key} className={item} onClick={() => apply(s.key === "mtd" ? {} : { period: s.key })}>
              <span>{s.label}</span>
              {period === s.key && <Check className="size-3.5 text-brand-cyan-deep" />}
            </button>
          ))}

          <div className="my-1 border-t border-border/60" />

          {/* Monthly — pick a specific calendar month */}
          <button className={item} onClick={() => setSub(sub === "monthly" ? null : "monthly")}>
            <span>Monthly</span><ChevronDown className={`size-3.5 transition-transform ${sub === "monthly" ? "rotate-180" : ""}`} />
          </button>
          {sub === "monthly" && (
            <div className="px-2 py-1.5">
              <SelectField value="" placeholder="Select a month…" size="sm" className="w-full" aria-label="Select a month"
                onChange={(e) => { if (e.target.value) { const { from, to } = monthRange(e.target.value); apply({ period: "custom", pfrom: from, pto: to }); } }}>
                {monthOptions(now).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </SelectField>
            </div>
          )}

          {/* Quarterly — pick a FY quarter */}
          <button className={item} onClick={() => setSub(sub === "quarterly" ? null : "quarterly")}>
            <span>Quarterly</span><ChevronDown className={`size-3.5 transition-transform ${sub === "quarterly" ? "rotate-180" : ""}`} />
          </button>
          {sub === "quarterly" && (
            <div className="px-2 py-1.5">
              <SelectField value="" placeholder="Select a quarter…" size="sm" className="w-full" aria-label="Select a quarter"
                onChange={(e) => { const opt = quarterOptions(now).find((q) => q.key === e.target.value); if (opt) apply({ period: "custom", pfrom: opt.from, pto: opt.to }); }}>
                {quarterOptions(now).map((q) => <option key={q.key} value={q.key}>{q.label}</option>)}
              </SelectField>
            </div>
          )}

          {/* Since — everything from a start date to now */}
          <button className={item} onClick={() => setSub(sub === "since" ? null : "since")}>
            <span>Since a date</span><ChevronDown className={`size-3.5 transition-transform ${sub === "since" ? "rotate-180" : ""}`} />
          </button>
          {sub === "since" && (
            <div className="w-72 max-w-full px-2 py-1.5">
              <DateFieldInline value="" label="Since date" max={new Date().toISOString().slice(0, 10)} onChange={(iso) => { if (iso) apply({ period: "custom", pstart: iso }); }} />
            </div>
          )}

          {/* Custom range — explicit from → to */}
          <button className={item} onClick={() => setSub(sub === "range" ? null : "range")}>
            <span>Custom range</span><ChevronDown className={`size-3.5 transition-transform ${sub === "range" ? "rotate-180" : ""}`} />
          </button>
          {sub === "range" && (
            <div className="w-72 max-w-full px-2 py-1.5 space-y-2">
              <DateRangeField from={rangeFrom} to={rangeTo} onChange={(f, t) => { setRangeFrom(f); setRangeTo(t); }} />
              <button className="w-full btn-primary text-xs justify-center disabled:opacity-50" disabled={!rangeFrom || !rangeTo}
                onClick={() => apply({ period: "custom", pfrom: rangeFrom, pto: rangeTo })}>
                Apply range
              </button>
            </div>
          )}
        </div>,
        document.body
      )}

    </div>
  );
}
