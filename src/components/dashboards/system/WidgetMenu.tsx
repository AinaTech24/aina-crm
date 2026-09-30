"use client";

/**
 * A card's ⋯ menu (D9): "Filter this card" — a personal period for this one
 * card, saved for this viewer only and never on the shared dashboard — and
 * "Export CSV" of exactly the rows the card shows.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { notify } from "@/components/ui/Toast";
import { buttonClass } from "@/components/ui/button-class";
import { downloadFile } from "@/lib/secure-download";
import { PERIOD_KEYS, PERIOD_NAMES, type PeriodKey } from "@/lib/dashboards/system/period";
import { DateRangeField } from "@/components/ui/DateRangeField";

export function WidgetMenu({
  dashboardId,
  instanceId,
  csv,
  exportQuery,
  cardFilter,
  title,
}: {
  dashboardId: string;
  instanceId: string;
  csv: boolean;
  /** The dashboard's current filter params, so the export matches the card. */
  exportQuery: string;
  /** A personal card filter is set. */
  cardFilter: boolean;
  title: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setEditing(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setEditing(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function saveCardFilter(state: unknown) {
    setBusy(true);
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}/prefs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardFilter: { instanceId, state } }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Could not save the card filter");
      setOpen(false);
      setEditing(false);
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save the card filter");
    } finally {
      setBusy(false);
    }
  }

  const item = "block w-full text-left px-3 py-2 text-sm hover:bg-secondary rounded-md";

  return (
    <div className="relative print:hidden" ref={ref}>
      <button
        type="button"
        className="btn-icon"
        aria-label={`${title}: more`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-60 rounded-lg border border-border bg-card shadow-lg p-1">
          {!editing ? (
            <>
              <button type="button" className={item} onClick={() => setEditing(true)}>
                Filter this card
              </button>
              {cardFilter && (
                <button type="button" className={item} disabled={busy} onClick={() => saveCardFilter(null)}>
                  Clear card filter
                </button>
              )}
              {csv && (
                <button
                  type="button"
                  className={item}
                  onClick={() => {
                    setOpen(false);
                    const sep = exportQuery ? "&" : "";
                    downloadFile(
                      `/api/dashboards/${dashboardId}/export?w=${encodeURIComponent(instanceId)}${sep}${exportQuery}`,
                      `${title.replace(/[^\w]+/g, "_")}.csv`,
                    ).catch((e) => notify.error(e?.message ?? "Could not export"));
                  }}
                >
                  Export CSV
                </button>
              )}
            </>
          ) : (
            <form
              className="p-2 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (period === "custom" && !from) return notify.error("Pick a start date");
                saveCardFilter({ period, from: period === "custom" ? from : undefined, to: period === "custom" ? to || undefined : undefined, values: {} });
              }}
            >
              <label className="block text-xs font-medium text-muted-foreground" htmlFor={`cf-${instanceId}`}>
                Period for this card (only you see it)
              </label>
              <select
                id={`cf-${instanceId}`}
                className="input-base w-full text-sm"
                value={period}
                onChange={(e) => setPeriod(e.target.value as PeriodKey)}
              >
                {PERIOD_KEYS.map((k) => (
                  <option key={k} value={k}>{PERIOD_NAMES[k]}</option>
                ))}
              </select>
              {period === "custom" && (
                <DateRangeField from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setEditing(false)}>Cancel</button>
                <button type="submit" className={buttonClass("primary", "sm")} disabled={busy}>Apply</button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
