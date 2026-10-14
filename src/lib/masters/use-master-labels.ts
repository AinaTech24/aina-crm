"use client";

/**
 * The labels of one of the firm's master lists (Settings → Masters), for a
 * dropdown. Shows `fallback` until the firm's list arrives, and keeps it when
 * the firm has none or the request fails — a dropdown is never empty.
 */
import { useEffect, useState } from "react";

export function useMasterLabels(type: string, fallback: string[]): string[] {
  const [labels, setLabels] = useState<string[]>(fallback);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/masters/${encodeURIComponent(type)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { values?: Array<{ label: string; isActive?: boolean }> } | null) => {
        const own = (j?.values ?? []).filter((v) => v.isActive !== false).map((v) => v.label).filter(Boolean);
        if (own.length) setLabels(own);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [type]);
  return labels;
}
