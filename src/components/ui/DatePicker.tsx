"use client";

/**
 * The CRM's date field: type a date, or pick one from a calendar.
 *
 *   <DatePicker value={iso} onChange={setIso} />
 *
 * Value is an ISO `yyyy-mm-dd` string (the same as a native date input, so it
 * drops into any form). The field shows "30 Sep 2026" — the month in words, so
 * nobody reads 03/04 as March.
 *
 * Why it looks like this:
 * - **Typing is first-class.** Entering a 1968 date of birth by clicking is
 *   slow even with dropdowns; the field reads every day-first spelling people
 *   use (30-09-2026, 30/9/26, 30092026, 30 Sep 2026 — lib/dates/typed-date).
 *   The date is committed on Enter or when the field loses focus, never
 *   mid-keystroke, because some callers push each change into the URL. An
 *   unreadable or out-of-range entry stays on screen with a message.
 * - **Month and year are dropdowns** (CalendarMonth), arrows step a month.
 * - **Keyboard all the way.** Down arrow from the field opens the calendar on
 *   the chosen day; the grid takes arrows / Page Up-Down / Home / End / Enter;
 *   Escape closes and returns to the field.
 * - **Forms keep working.** `name` posts the ISO value through a hidden input,
 *   `required` and an unreadable entry use the browser's own validation, and
 *   `id` lets a <label htmlFor> focus the field.
 *
 * The calendar is a Radix Popover anchored to the field: portalled to <body>
 * (no ancestor can clip it), placed below and flipped above when there's no
 * room, and it cooperates with Radix dialogs — opening it pauses the dialog's
 * focus trap, so the month and year dropdowns keep focus, and a press inside it
 * is not a press outside the dialog. Older menus and filter panels close on a
 * document `mousedown`; the calendar keeps its own mousedowns from reaching
 * them. Inside a menu, prefer the inline <DateRangeField>, which never floats.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Calendar as CalIcon } from "lucide-react";
import { CalendarMonth } from "./CalendarMonth";
import { formatDateLabel, fromIsoDate, parseTypedDate, toIsoDate, withinBounds } from "@/lib/dates/typed-date";

const POPUP_W = 296;

/** dd-mm-yyyy for a stored yyyy-mm-dd (kept for callers that list dates in this form). */
export function formatDisplayDate(s?: string) {
  const d = fromIsoDate(s);
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

/** Error text for a typed value, or null when it reads as a real day in range. */
function checkTyped(text: string, min?: string, max?: string): { iso: string; error: string | null } {
  const parsed = parseTypedDate(text);
  if (parsed === "") return { iso: "", error: null };
  if (parsed === null) {
    // Three numbers that don't make a real day (31-02-2026) vs text that isn't a date.
    const looksLikeDate = /^\s*\d{1,4}\D+\d{1,2}\D+\d{2,4}\s*$/.test(text);
    return { iso: "", error: looksLikeDate ? "No such date." : "Enter a date like 30-09-2026." };
  }
  if (!withinBounds(parsed, min, max)) {
    const error =
      min && max
        ? `Pick a date from ${formatDateLabel(min)} to ${formatDateLabel(max)}.`
        : min
          ? `Pick a date on or after ${formatDateLabel(min)}.`
          : `Pick a date on or before ${formatDateLabel(max)}.`;
    return { iso: "", error };
  }
  return { iso: parsed, error: null };
}

export function DatePicker({
  value,
  onChange,
  placeholder = "dd-mm-yyyy",
  disabled,
  className = "",
  min,
  max,
  ariaLabel,
  size = "md",
  clearable = true,
  id,
  name,
  required,
  withCalendar = true,
  onFieldFocus,
}: {
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  min?: string;
  max?: string;
  ariaLabel?: string;
  size?: "sm" | "md";
  clearable?: boolean;
  /** Put on the text field, so <label htmlFor> works. */
  id?: string;
  /** Posts the ISO value through a hidden input for plain <form> submits. */
  name?: string;
  required?: boolean;
  /** False: typing only, no popup — for fields paired with an inline calendar. */
  withCalendar?: boolean;
  onFieldFocus?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const iso = (value ?? "").slice(0, 10);
  const selected = useMemo(() => fromIsoDate(iso), [iso]);

  // What the field shows. While someone is typing we keep their text; otherwise
  // it mirrors the value.
  const [text, setText] = useState(() => formatDateLabel(iso));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!editing) {
      setText(formatDateLabel(iso));
      setError(null);
    }
  }, [iso, editing]);

  const [view, setView] = useState<Date>(() => selected ?? new Date());
  const [focusDay, setFocusDay] = useState<Date>(() => selected ?? new Date());
  const [focusGrid, setFocusGrid] = useState(false);

  const openCalendar = useCallback(
    (toGrid: boolean) => {
      if (disabled || !withCalendar) return;
      const typed = editing ? parseTypedDate(text) : null;
      const start = (typed ? fromIsoDate(typed) : null) ?? selected ?? new Date();
      setView(new Date(start.getFullYear(), start.getMonth(), 1));
      setFocusDay(start);
      setFocusGrid(toGrid);
      setOpen(true);
    },
    [disabled, withCalendar, editing, text, selected],
  );

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) inputRef.current?.focus();
  }, []);

  // Older menus and filter panels close on a document mousedown outside
  // themselves; keep the calendar's own mousedowns from reaching them.
  // (Radix layers use pointerdown, which is left alone.)
  const setPopRef = useCallback((el: HTMLDivElement | null) => {
    const prev = popRef.current as (HTMLDivElement & { __stop?: (e: Event) => void }) | null;
    if (prev?.__stop) {
      prev.removeEventListener("mousedown", prev.__stop);
      prev.removeEventListener("touchstart", prev.__stop);
    }
    popRef.current = el;
    if (el) {
      const stop = (e: Event) => e.stopPropagation();
      (el as HTMLDivElement & { __stop?: (e: Event) => void }).__stop = stop;
      el.addEventListener("mousedown", stop);
      el.addEventListener("touchstart", stop);
    }
  }, []);

  // Browser validation: an unreadable entry blocks a form submit like any
  // other invalid field.
  useEffect(() => {
    inputRef.current?.setCustomValidity(error ?? "");
  }, [error]);

  /** Read what was typed; commit it if it's a real day in range. */
  function commitText(): boolean {
    const r = checkTyped(text, min, max);
    setError(r.error);
    if (r.error) return false;
    setText(formatDateLabel(r.iso));
    if (r.iso !== iso) onChange(r.iso);
    return true;
  }

  function pick(d: Date) {
    const next = toIsoDate(d);
    setEditing(false);
    setError(null);
    setText(formatDateLabel(next));
    if (next !== iso) onChange(next);
    close(true);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && withCalendar) {
      e.preventDefault();
      openCalendar(true);
    } else if (e.key === "Enter") {
      // Commit the typed date rather than submitting half-entered data.
      e.preventDefault();
      if (commitText()) {
        setEditing(false);
        close(false);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        close(false);
      } else if (editing && error) {
        setText(formatDateLabel(iso));
        setError(null);
      }
    }
  }

  // The calendar is portalled to the end of <body>, so Tab past its first or
  // last control would leave the page; close it and go back to the field.
  function onPopupKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const t = e.target as HTMLElement;
    const stops = popRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled),select");
    const last = stops?.[stops.length - 1];
    if ((!e.shiftKey && t === last) || (e.shiftKey && t.hasAttribute("data-first-stop"))) {
      e.preventDefault();
      close(true);
    }
  }

  // Leaving both the field and the calendar commits what was typed. An
  // unreadable entry stays on screen with its message rather than snapping
  // back to the previous date.
  function onWrapBlur(e: React.FocusEvent) {
    const to = e.relatedTarget as Node | null;
    if (to && (wrapRef.current?.contains(to) || popRef.current?.contains(to))) return;
    if (editing && commitText()) setEditing(false);
    if (open && to) setOpen(false);
  }

  const sm = size === "sm";
  const todayIso = toIsoDate(new Date());
  const todayAllowed = withinBounds(todayIso, min, max);

  return (
    <div ref={wrapRef} className={className} onBlur={onWrapBlur}>
      <Popover.Root open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <Popover.Anchor asChild>
          <div className="relative">
            <input
              ref={inputRef}
              id={id}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              value={text}
              placeholder={placeholder}
              disabled={disabled}
              required={required}
              aria-label={id ? undefined : ariaLabel}
              aria-invalid={error ? true : undefined}
              aria-haspopup={withCalendar ? "dialog" : undefined}
              aria-expanded={withCalendar ? open : undefined}
              onFocus={(e) => {
                setEditing(true);
                e.currentTarget.select();
                onFieldFocus?.();
              }}
              onChange={(e) => {
                setText(e.target.value);
                if (error) setError(null);
              }}
              onClick={() => !open && openCalendar(false)}
              onKeyDown={onInputKeyDown}
              className={`input-base w-full tabular-nums ${sm ? "h-8 py-1 pl-2.5 pr-8 text-xs" : "pr-9"} ${
                error ? "border-destructive focus:border-destructive" : open ? "border-brand-cyan/60 ring-2 ring-brand-cyan/15" : ""
              } disabled:cursor-not-allowed disabled:opacity-50`}
            />
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              aria-label={withCalendar ? "Open calendar" : "Date"}
              onMouseDown={(e) => e.preventDefault() /* keep focus in the field */}
              onClick={() => (withCalendar ? (open ? close(true) : openCalendar(false)) : inputRef.current?.focus())}
              className={`absolute inset-y-0 right-0 grid place-items-center text-muted-foreground hover:text-foreground disabled:cursor-not-allowed ${sm ? "w-8" : "w-9"}`}
            >
              <CalIcon className={sm ? "size-3.5" : "size-4"} aria-hidden />
            </button>
          </div>
        </Popover.Anchor>

        {withCalendar && (
          <Popover.Portal>
            <Popover.Content
              ref={setPopRef}
              side="bottom"
              align="start"
              sideOffset={4}
              collisionPadding={8}
              aria-label={`Choose ${ariaLabel ?? "date"}`}
              data-floating-popup
              // Focus stays in the field when the calendar opens by mouse, and
              // is placed deliberately when it closes.
              onOpenAutoFocus={(e) => e.preventDefault()}
              onCloseAutoFocus={(e) => e.preventDefault()}
              // The field itself is not "outside".
              onInteractOutside={(e) => {
                if (wrapRef.current?.contains(e.target as Node)) e.preventDefault();
              }}
              onEscapeKeyDown={(e) => {
                e.preventDefault();
                close(true);
              }}
              onKeyDown={onPopupKeyDown}
              style={{ width: `min(${POPUP_W}px, calc(100vw - 16px))`, zIndex: 100 }}
              className="card-elevated animate-scale-in bg-card p-3 focus:outline-none"
            >
              <CalendarMonth
                view={view}
                onViewChange={setView}
                min={min}
                max={max}
                selected={iso}
                onPick={pick}
                focusDay={focusDay}
                onFocusDayChange={setFocusDay}
                autoFocusDay={focusGrid}
                onEscape={() => close(true)}
                label={ariaLabel ?? "Date"}
                footer={
                  <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                    {clearable && iso ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(false);
                          setText("");
                          setError(null);
                          onChange("");
                          close(true);
                        }}
                        className="rounded px-1.5 py-1 text-xs text-muted-foreground hover:text-destructive"
                      >
                        Clear
                      </button>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      disabled={!todayAllowed}
                      onClick={() => pick(new Date())}
                      title={todayAllowed ? undefined : "Today is outside the allowed dates"}
                      className="rounded px-1.5 py-1 text-xs font-medium text-brand-cyan hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
                    >
                      Today
                    </button>
                  </div>
                }
              />
            </Popover.Content>
          </Popover.Portal>
        )}
      </Popover.Root>
      {name && <input type="hidden" name={name} value={iso} />}
      {error && (
        <p role="alert" className="mt-1 text-2xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
