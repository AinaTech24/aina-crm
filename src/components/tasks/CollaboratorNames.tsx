"use client";

/** How a task's collaborators are shown where they cannot be changed. */

import { useEffect, useState } from "react";
import type { Employee } from "@/components/common/RmSelector";

/** "+2" beside the assignee in the list and on the board; the names on hover. */
export function CollaboratorCount({ names }: { names?: string[] }) {
  if (!names?.length) return null;
  const label = `Also working on it: ${names.join(", ")}`;
  return (
    <span className="shrink-0 rounded-full bg-secondary px-1.5 text-2xs font-medium text-muted-foreground" title={label} aria-label={label}>
      +{names.length}
    </span>
  );
}

/** The names, read-only, for someone who may not change who is on the task. */
export function CollaboratorNames({ ids }: { ids: string[] }) {
  const [rows, setRows] = useState<Employee[] | null>(null);

  useEffect(() => {
    if (!ids.length) return;
    let cancelled = false;
    fetch("/api/employees")
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setRows((j.rows ?? []) as Employee[]); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [ids.length]);

  if (!ids.length) return <p className="text-xs text-muted-foreground">No collaborators.</p>;
  if (!rows) return <p className="text-xs text-muted-foreground">Loading…</p>;
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  return <p className="text-xs">{ids.map((id) => byId.get(id) ?? "A former colleague").join(", ")}</p>;
}
