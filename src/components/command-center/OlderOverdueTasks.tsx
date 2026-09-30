"use client";

/**
 * "Older than 30 days (N)" under My Day's overdue tasks — collapsed, with one
 * bulk decision instead of a hundred row-by-row ones.
 *
 * A task a hundred days late is almost never going to be done on the day it
 * was meant for; it needs closing or a new date. Close all marks them
 * CANCELLED, not completed, so they leave the lists without inflating anyone's
 * completion rate. Both go through /api/tasks/bulk, which applies its own
 * rule on whose tasks a person may change.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2 } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { CommandItemActions } from "@/components/command-center/CommandItemActions";
import { DateField } from "@/components/ui/DateField";

type Row = { id: string; title: string; detail?: string; href: string; ageDays?: number; itemKey?: string };

function dayPlus(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
}

export function OlderOverdueTasks({ count, items, ids }: { count: number; items: Row[]; ids: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"close" | "reschedule" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const capped = ids.length < count;

  async function bulk(action: "cancel" | "reschedule", value?: string) {
    setError(null);
    setBusy(action === "cancel" ? "close" : "reschedule");
    try {
      const res = await fetch("/api/tasks/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, action, value: value ?? null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "That didn't go through. Nothing was changed.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  async function closeAll() {
    const ok = await confirmDialog({
      title: `Close ${ids.length} overdue task${ids.length === 1 ? "" : "s"}?`,
      message:
        "Each is more than 30 days late. Closing marks them cancelled (not done), so they leave everyone's lists and don't count as completed.",
      confirmLabel: "Close all",
      tone: "danger",
    });
    if (ok) await bulk("cancel");
  }

  function rescheduleTo(day: string) {
    setPickOpen(false);
    // 10:00 India time on the chosen day: due that morning, not at midnight.
    void bulk("reschedule", `${day}T10:00:00+05:30`);
  }

  return (
    <details className="group/older border-t">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium hover:bg-accent/40">
        <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open/older:rotate-90" />
        Older than 30 days ({count})
      </summary>
      <ul className="divide-y border-t">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-1 px-4 py-2.5 hover:bg-accent/40 transition-colors">
            <Link href={it.href} className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{it.title}</div>
              <div className="text-2xs text-muted-foreground truncate">
                {it.detail}
                {typeof it.ageDays === "number" ? ` · ${it.ageDays}d overdue` : ""}
              </div>
            </Link>
            <CommandItemActions itemKey={it.itemKey ?? `tasks_overdue:${it.id}`} actionType="task" taskId={it.id} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 border-t bg-secondary/30 px-4 py-2.5">
        <button type="button" onClick={closeAll} disabled={!!busy} className={buttonClass("secondary", "sm")}>
          {busy === "close" && <Loader2 className="size-3.5 animate-spin" />} Close all
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setPickOpen((o) => !o)}
            disabled={!!busy}
            aria-haspopup="menu"
            aria-expanded={pickOpen}
            className={buttonClass("secondary", "sm")}
          >
            {busy === "reschedule" && <Loader2 className="size-3.5 animate-spin" />} Reschedule all
          </button>
          {pickOpen && (
            <div role="menu" className="absolute left-0 bottom-full z-40 mb-1 w-48 rounded-lg border bg-card p-1 shadow-lg">
              <button type="button" role="menuitem" onClick={() => rescheduleTo(dayPlus(1))} className="w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-secondary">
                Tomorrow
              </button>
              <button type="button" role="menuitem" onClick={() => rescheduleTo(dayPlus(7))} className="w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-secondary">
                Next week
              </button>
              <label className="block px-2.5 pb-1.5 pt-1 text-2xs text-muted-foreground">
                Pick date
                <DateField
                  min={dayPlus(0)}
                  onChange={(e) => e.target.value && rescheduleTo(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                />
              </label>
            </div>
          )}
        </div>
        {count > items.length && (
          <Link href="/dashboard/tasks" className="ml-auto text-xs font-medium text-brand-cyan-deep hover:underline">
            See all in Tasks →
          </Link>
        )}
        {capped && (
          <p className="w-full text-2xs text-muted-foreground">
            Applies to the oldest {ids.length} of {count}; run it again for the rest.
          </p>
        )}
        {error && (
          <p role="alert" className="w-full text-2xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
