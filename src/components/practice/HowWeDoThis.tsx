"use client";

/**
 * "How we do this" — the firm's SOPs for the task in front of you, inside the
 * task drawer (The E-Myth Revisited: the manual lives inside the work).
 *
 * Reads `sops` from GET /api/tasks/:id (lib/practice/sop-links.ts
 * `sopsForTask`). Renders nothing at all when no SOP applies.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { SopMarkdown } from "./HowWeDoThisMarkdown";

type TaskSop = { sopId: string; title: string; versionNumber: string; markdown: string };

export function HowWeDoThis({ taskId }: { taskId: string }) {
  const [sops, setSops] = useState<TaskSop[]>([]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/tasks/${encodeURIComponent(taskId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j || !Array.isArray(j.sops)) return;
        setSops(j.sops);
        if (j.sops.length === 1) setExpanded(j.sops[0].sopId);
      })
      .catch(() => {
        /* the panel is optional — no SOPs shown on failure */
      });
    return () => {
      alive = false;
    };
  }, [taskId]);

  if (!sops.length) return null;

  return (
    <>
      <section className="space-y-2" aria-label="How we do this">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full min-h-8 items-center justify-between gap-2 text-left"
        >
          <span className="text-2xs uppercase font-bold text-muted-foreground flex items-center gap-1.5">
            <BookOpen className="size-3.5" /> How we do this
            <span className="normal-case font-semibold">· {sops.length} {sops.length === 1 ? "SOP" : "SOPs"}</span>
          </span>
          {open ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
        </button>
        {open && (
          <ul className="space-y-2">
            {sops.map((s) => {
              const isOpen = expanded === s.sopId;
              return (
                <li key={s.sopId} className="rounded-md bg-secondary/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : s.sopId)}
                      aria-expanded={isOpen}
                      className="flex min-h-6 items-center gap-1.5 text-sm font-medium text-left"
                    >
                      {isOpen ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
                      {s.title}
                      <span className="text-2xs text-muted-foreground font-normal">v{s.versionNumber}</span>
                    </button>
                    <Link href={`/dashboard/sops/${s.sopId}`} className="text-xs text-primary hover:underline shrink-0">
                      Full SOP
                    </Link>
                  </div>
                  {isOpen && (
                    <div className="mt-2 max-h-80 overflow-y-auto">
                      {s.markdown.trim() ? (
                        <SopMarkdown markdown={s.markdown} />
                      ) : (
                        <p className="text-sm text-muted-foreground">This SOP has no text yet.</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <hr className="border-slate-100" />
    </>
  );
}
