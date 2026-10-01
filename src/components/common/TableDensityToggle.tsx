"use client";

import { useEffect, useState } from "react";
import { Rows3, Rows4 } from "lucide-react";

export type TableDensity = "compact" | "cozy";

const DENSITY_STORAGE_KEY = "aina_table_density";

export function useTableDensity(defaultDensity: TableDensity = "cozy") {
  const [density, setDensity] = useState<TableDensity>(defaultDensity);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DENSITY_STORAGE_KEY) as TableDensity | null;
      if (saved === "compact" || saved === "cozy") {
        setDensity(saved);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const toggleDensity = () => {
    const next: TableDensity = density === "compact" ? "cozy" : "compact";
    setDensity(next);
    try {
      localStorage.setItem(DENSITY_STORAGE_KEY, next);
      window.dispatchEvent(new CustomEvent("density-change", { detail: next }));
    } catch {
      // ignore storage errors
    }
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<TableDensity>;
      if (customEvent.detail && customEvent.detail !== density) {
        setDensity(customEvent.detail);
      }
    };
    window.addEventListener("density-change", handler);
    return () => window.removeEventListener("density-change", handler);
  }, [density]);

  return { density, setDensity, toggleDensity, isCompact: density === "compact" };
}

export function TableDensityToggle({
  density,
  onToggle,
  className = "",
}: {
  density: TableDensity;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors shadow-xs ${className}`}
      title={density === "compact" ? "Switch to Cozy view (Standard spacing)" : "Switch to Compact view (High density)"}
      aria-label="Toggle table density"
    >
      {density === "compact" ? (
        <>
          <Rows4 className="size-3.5 text-brand-cyan" />
          <span>Compact</span>
        </>
      ) : (
        <>
          <Rows3 className="size-3.5 text-muted-foreground" />
          <span>Cozy</span>
        </>
      )}
    </button>
  );
}

/**
 * The same toggle as an icon button that owns its own state, for a toolbar
 * that sits outside the table (a filter bar). It shares the stored choice and
 * the "density-change" event with every table on the page, so flipping it
 * here re-spaces the table below.
 */
export function TableDensitySwitch() {
  const { density, toggleDensity } = useTableDensity("cozy");
  const compact = density === "compact";
  return (
    <button
      type="button"
      onClick={toggleDensity}
      className={`inline-flex size-8 items-center justify-center rounded-lg border transition-colors ${
        compact ? "border-primary/30 bg-accent text-primary" : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
      }`}
      title={compact ? "Compact rows — switch to standard spacing" : "Standard rows — switch to compact"}
      aria-label={compact ? "Switch to standard row spacing" : "Switch to compact rows"}
      aria-pressed={compact}
    >
      {compact ? <Rows4 className="size-4" /> : <Rows3 className="size-4" />}
    </button>
  );
}
