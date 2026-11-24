"use client";

/**
 * "View Timeline" on a task: a popup with the task's whole history — when it was
 * created and by whom, then every edit as its own line ("Due Date was updated
 * from 08 Oct 2026 to 10 Dec 2026"), with the time and the person, newest first,
 * grouped by day (India time). Reads GET /api/tasks/[id]/history, which the
 * `tasks_record_history` trigger (migration 0284) feeds.
 *
 * Rendered inside the task panel on purpose: the panel stops clicks from
 * reaching the backdrop that closes it, and a portal's events follow the React
 * tree, so opening this never closes the task behind it.
 */

import { useCallback, useMemo, useState } from "react";
import { History, ListFilter, Loader2, Pencil, ClipboardCheck, Check } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import type { ChangeLine } from "@/lib/tasks/history-format";

type Entry = { id: string; at: string; actorName: string | null; event: "created" | "updated"; changes: ChangeLine[] };
type Timeline = { entries: Entry[]; earlierEditsNotItemised: boolean };

type Item = {
  key: string;
  at: string;
  actor: string;
  /** What this line is about — the filter key ("Created" for the creation). */
  topic: string;
  created: boolean;
  change?: ChangeLine;
};

const TZ = "Asia/Kolkata";
const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: true })
    .format(new Date(iso))
    .toUpperCase();

function flatten(t: Timeline): Item[] {
  const out: Item[] = [];
  for (const e of t.entries) {
    const actor = e.actorName ?? "System";
    if (e.event === "created") {
      out.push({ key: e.id, at: e.at, actor, topic: "Created", created: true });
      continue;
    }
    for (const c of e.changes) out.push({ key: `${e.id}:${c.field}`, at: e.at, actor, topic: c.label, created: false, change: c });
  }
  return out;
}

function Sentence({ item }: { item: Item }) {
  if (item.created) return <span className="font-medium text-foreground">Task Created</span>;
  const c = item.change!;
  if (c.kind === "event") return <span><b className="font-semibold text-foreground">{c.label}</b> {c.to?.replace(/^./, (x) => x.toLowerCase())}</span>;
  if (c.kind === "lines") {
    return (
      <div>
        <b className="font-semibold text-foreground">{c.label}</b> were updated
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
          {(c.lines ?? []).map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      </div>
    );
  }
  const val = (v: string | null) => <b className="font-semibold text-foreground">{v ?? "blank value"}</b>;
  return <span><b className="font-semibold text-foreground">{c.label}</b> was updated from {val(c.from)} to {val(c.to)}</span>;
}

export function TaskTimelineButton({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<Timeline | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/history`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 404 ? "This task's history isn't available to you." : `Could not load the timeline (HTTP ${res.status})`);
      setData(await res.json());
    } catch (e: any) {
      setErr(e?.message ?? "Could not load the timeline");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  function openIt() {
    setOpen(true);
    setFilter(null);
    setFilterOpen(false);
    void load(); // always fresh: the task may have been edited since it was last opened
  }

  const items = useMemo(() => (data ? flatten(data) : []), [data]);
  const topics = useMemo(() => [...new Set(items.map((i) => i.topic))], [items]);
  const shown = filter ? items.filter((i) => i.topic === filter) : items;
  const days = useMemo(() => {
    const groups: Array<{ day: string; items: Item[] }> = [];
    for (const i of shown) {
      const day = fmtDay(i.at);
      const g = groups[groups.length - 1];
      if (g && g.day === day) g.items.push(i);
      else groups.push({ day, items: [i] });
    }
    return groups;
  }, [shown]);

  return (
    <>
      <button type="button" onClick={openIt} className="btn-secondary text-xs inline-flex items-center gap-1.5 shrink-0">
        <History className="size-3.5" /> View Timeline
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl p-0">
          <DialogHeader className="flex-row items-center gap-3 space-y-0 border-b px-5 py-4 pr-12">
            <DialogTitle className="text-base">Timeline History</DialogTitle>
            <DialogDescription className="sr-only">When this task was created and every change made to it, with who made it.</DialogDescription>
            {topics.length > 1 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setFilterOpen((v) => !v)}
                  className={`btn-secondary text-xs inline-flex items-center gap-1.5 ${filter ? "border-primary text-primary" : ""}`}
                  aria-haspopup="listbox"
                  aria-expanded={filterOpen}
                  aria-label="Filter the timeline"
                >
                  <ListFilter className="size-3.5" />
                  {filter ?? "Filter"}
                </button>
                {filterOpen && (
                  <div role="listbox" className="absolute left-0 top-full z-10 mt-1 max-h-64 w-52 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
                    {[null, ...topics].map((t) => (
                      <button
                        key={t ?? "all"}
                        type="button"
                        role="option"
                        aria-selected={filter === t}
                        onClick={() => { setFilter(t); setFilterOpen(false); }}
                        className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-secondary"
                      >
                        {t ?? "All changes"}
                        {filter === t && <Check className="size-3.5 text-primary" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </DialogHeader>

          <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
            {loading && !data ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading the timeline…
              </div>
            ) : err ? (
              <p className="py-8 text-center text-sm text-rose-700">{err}</p>
            ) : shown.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No changes recorded yet.</p>
            ) : (
              <div>
                {days.map((g) => (
                  <section key={g.day} className="mb-4 last:mb-0">
                    <div className="mb-3 inline-block rounded-md border bg-secondary/60 px-3 py-1 text-xs font-medium text-foreground">{g.day}</div>
                    <ol className="relative">
                      {g.items.map((i, idx) => (
                        <li key={i.key} className="relative flex gap-3 pb-5 last:pb-0">
                          <div className="w-16 shrink-0 pt-1.5 text-right text-xs text-muted-foreground tabular-nums">{fmtTime(i.at)}</div>
                          <div className="relative flex shrink-0 flex-col items-center">
                            <span className="z-[1] grid size-8 place-items-center rounded-full border bg-card text-muted-foreground">
                              {i.created ? <ClipboardCheck className="size-4" /> : <Pencil className="size-3.5" />}
                            </span>
                            {idx < g.items.length - 1 && <span className="absolute top-8 -bottom-5 w-px bg-border" aria-hidden />}
                          </div>
                          <div className="min-w-0 flex-1 pt-1 text-sm text-muted-foreground">
                            <Sentence item={i} />
                            <div className="mt-0.5 text-xs text-muted-foreground/80">
                              by <span className="font-medium text-foreground/80">{i.actor}</span> · {fmtDay(i.at)}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                ))}
              </div>
            )}
            {data?.earlierEditsNotItemised && !filter && (
              <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                This task was edited before field-by-field history was switched on, so those earlier edits aren't itemised here.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
