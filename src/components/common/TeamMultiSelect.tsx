"use client";

/**
 * TeamMultiSelect — pick several team members, e.g. the colleagues joining a
 * meeting. Chosen people show as removable chips; "Add" offers everyone else
 * from the same employee list RmSelector reads (GET /api/employees), minus
 * `exclude` (the meeting's own RM).
 */

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import type { Employee } from "@/components/common/RmSelector";

export function TeamMultiSelect({
  value,
  onChange,
  exclude,
  max = 10,
  id,
  placeholder = "+ Add a colleague",
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  /** Ids not offered (e.g. the RM already on the meeting). */
  exclude?: Array<string | null | undefined>;
  max?: number;
  id?: string;
  placeholder?: string;
}) {
  const [rows, setRows] = useState<Employee[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/employees")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!cancelled) setRows((j.rows ?? []) as Employee[]);
      })
      .catch((e) => {
        if (!cancelled) setErr(e?.message ?? "Failed to load team");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => new Map((rows ?? []).map((r) => [r.id, r])), [rows]);
  const skip = new Set([...value, ...(exclude ?? []).filter(Boolean)] as string[]);
  const options = (rows ?? []).filter((r) => !skip.has(r.id));

  if (err) return <div className="input-base text-xs text-destructive">Couldn't load team — {err}</div>;

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((uid) => (
            <li key={uid} className="inline-flex items-center gap-1 rounded-full bg-secondary py-1 pl-2.5 pr-1 text-xs">
              <span>{byId.get(uid)?.name ?? "Team member"}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== uid))}
                className="grid size-6 place-items-center rounded-full hover:bg-muted"
                aria-label={`Remove ${byId.get(uid)?.name ?? "colleague"}`}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows == null ? (
        <div className="input-base flex items-center" aria-busy="true" aria-label="Loading team">
          <div className="h-3.5 w-28 animate-pulse rounded bg-secondary" />
        </div>
      ) : value.length < max && options.length > 0 ? (
        <SelectField
          id={id}
          className="w-full"
          searchable
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v) onChange([...value, v]);
          }}
        >
          <option value="">{placeholder}</option>
          {options.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </SelectField>
      ) : null}
    </div>
  );
}
