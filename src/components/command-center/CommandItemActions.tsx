"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, Clock, X, MessageCircle, Loader2 } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { DateField } from "@/components/ui/DateField";

type Props = {
  itemKey: string;
  actionType?: "task" | "birthday" | "anniversary" | "generic";
  taskId?: string;
  phone?: string | null;
  name?: string;
  /** WhatsApp wish message (birthday / anniversary). */
  wishText?: string;
};

/** yyyy-mm-dd for today + n days, on the reader's calendar. */
function dayPlus(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
}

/**
 * Inline quick-actions for a My Day row: act without leaving the queue.
 * Snooze / dismiss is universal; mark-done (tasks) and send-wish (birthday /
 * anniversary) are type-specific. All actions refresh the queue on success.
 *
 * Every button says what it does on hover and on keyboard focus: they used to
 * be a bare ✓ ⏱ × that only a native title (late, and never on focus) named.
 */
export function CommandItemActions({ itemKey, actionType, taskId, phone, wishText }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const snoozeBtn = useRef<HTMLButtonElement>(null);

  async function post(body: Record<string, string>) {
    setBusy(body.action);
    try {
      await fetch("/api/command-center/snooze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemKey, ...body }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const snoozeUntil = (until: string) => {
    setSnoozeOpen(false);
    void post({ action: "until", until });
  };

  async function markDone() {
    if (!taskId) return;
    setBusy("done");
    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  function wish() {
    if (!phone) return;
    const num = phone.replace(/[^\d]/g, "");
    const url = `https://wa.me/${num}?text=${encodeURIComponent(wishText ?? "")}`;
    window.open(url, "_blank", "noopener,noreferrer");
    // Auto-dismiss for the day so it drops off the list once wished.
    void post({ action: "dismiss" });
  }

  const btn = (tone: "default" | "emerald" | "violet") =>
    `grid size-7 place-items-center rounded-md hover:bg-accent transition-colors disabled:opacity-50 ${
      tone === "emerald" ? "text-emerald-600" : tone === "violet" ? "text-violet-600" : "text-muted-foreground"
    }`;

  return (
    <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
      {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      {(actionType === "birthday" || actionType === "anniversary") && phone && (
        <Tooltip label="Send wish" align="end">
          <button type="button" onClick={wish} disabled={!!busy} aria-label="Send wish on WhatsApp" className={btn("violet")}>
            <MessageCircle className="size-3.5" />
          </button>
        </Tooltip>
      )}
      {actionType === "task" && taskId && (
        <Tooltip label="Mark done" align="end">
          <button type="button" onClick={markDone} disabled={!!busy} aria-label="Mark done" className={btn("emerald")}>
            <Check className="size-3.5" />
          </button>
        </Tooltip>
      )}
      <Tooltip label="Snooze" align="end" hidden={snoozeOpen}>
        <button
          ref={snoozeBtn}
          type="button"
          onClick={() => setSnoozeOpen((o) => !o)}
          disabled={!!busy}
          aria-label="Snooze"
          aria-haspopup="menu"
          aria-expanded={snoozeOpen}
          className={btn("default")}
        >
          <Clock className="size-3.5" />
        </button>
      </Tooltip>
      <Tooltip label="Dismiss" align="end">
        <button type="button" onClick={() => void post({ action: "dismiss" })} disabled={!!busy} aria-label="Dismiss" className={btn("default")}>
          <X className="size-3.5" />
        </button>
      </Tooltip>
      {snoozeOpen && <SnoozeMenu anchor={snoozeBtn.current} onPick={snoozeUntil} onClose={() => setSnoozeOpen(false)} />}
    </div>
  );
}

/**
 * Tomorrow / Next week / Pick date. Portalled and fixed-positioned: the row
 * sits inside a card that clips its overflow, which would cut the menu off on
 * the last rows.
 */
function SnoozeMenu({
  anchor,
  onPick,
  onClose,
}: {
  anchor: HTMLElement | null;
  onPick: (until: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    const place = () => {
      const r = anchor?.getBoundingClientRect();
      if (r) setPos({ top: Math.round(r.bottom + 4), right: Math.round(Math.max(8, window.innerWidth - r.right)) });
    };
    place();
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, onClose]);

  if (!pos) return null;
  const item = "w-full rounded-md px-2.5 py-1.5 text-left text-sm text-foreground/80 hover:bg-secondary hover:text-foreground";
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Snooze until"
      style={{ position: "fixed", top: pos.top, right: pos.right }}
      className="z-[100] w-48 rounded-lg border bg-card p-1 shadow-lg"
    >
      <button type="button" role="menuitem" className={item} onClick={() => onPick(dayPlus(1))}>
        Tomorrow
      </button>
      <button type="button" role="menuitem" className={item} onClick={() => onPick(dayPlus(7))}>
        Next week
      </button>
      <label className="block px-2.5 pb-1.5 pt-1 text-2xs text-muted-foreground">
        Pick date
        <DateField
          min={dayPlus(1)}
          onChange={(e) => e.target.value && onPick(e.target.value)}
          className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        />
      </label>
    </div>,
    document.body
  );
}
