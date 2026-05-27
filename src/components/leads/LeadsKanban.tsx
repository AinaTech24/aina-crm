"use client";

/**
 * Drag-and-drop Kanban for the Leads pipeline.
 *
 * The server `LeadsPage` renders the full chrome (header, KPIs, pipeline
 * wrapper) and hands the raw rows to this client component, which:
 *   - groups them by stage (folding legacy aliases into spec keys)
 *   - renders the 8 stage columns as droppable zones
 *   - renders each card as draggable
 *   - on drop, optimistically updates local state and PATCHes
 *     /api/leads/[id] with the new stage; reverts on failure.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Loader2 } from "lucide-react";
import { RowActions } from "@/components/common/RowActions";
import { formatRelative } from "@/lib/utils";

type LeadRow = {
  lead: {
    id: string;
    name: string;
    mobile?: string | null;
    phone?: string | null;
    stage: string;
    source: string;
    updatedAt: any;
  };
  owner: string | null;
};

type Stage = {
  key: string;
  label: string;
  tone: string;
  aliases: readonly string[];
};

const TONE_STYLES: Record<
  string,
  { strip: string; bg: string; chip: string; text: string; ring: string }
> = {
  blue:    { strip: "bg-blue-500",    bg: "bg-blue-50/40",    chip: "bg-blue-50 text-blue-700",       text: "text-blue-700",    ring: "ring-blue-400" },
  cyan:    { strip: "bg-cyan-500",    bg: "bg-cyan-50/40",    chip: "bg-cyan-50 text-cyan-700",       text: "text-cyan-700",    ring: "ring-cyan-400" },
  amber:   { strip: "bg-amber-500",   bg: "bg-amber-50/40",   chip: "bg-amber-50 text-amber-700",     text: "text-amber-700",   ring: "ring-amber-400" },
  violet:  { strip: "bg-violet-500",  bg: "bg-violet-50/40",  chip: "bg-violet-50 text-violet-700",   text: "text-violet-700",  ring: "ring-violet-400" },
  indigo:  { strip: "bg-indigo-500",  bg: "bg-indigo-50/40",  chip: "bg-indigo-50 text-indigo-700",   text: "text-indigo-700",  ring: "ring-indigo-400" },
  emerald: { strip: "bg-emerald-500", bg: "bg-emerald-50/40", chip: "bg-emerald-50 text-emerald-700", text: "text-emerald-700", ring: "ring-emerald-400" },
  rose:    { strip: "bg-rose-500",    bg: "bg-rose-50/40",    chip: "bg-rose-50 text-rose-700",       text: "text-rose-700",    ring: "ring-rose-400" },
  slate:   { strip: "bg-slate-400",   bg: "bg-slate-50/40",   chip: "bg-slate-50 text-slate-700",     text: "text-slate-700",   ring: "ring-slate-400" },
};

const sourceColors: Record<string, string> = {
  website: "bg-blue-50 text-blue-700",
  referral: "bg-emerald-50 text-emerald-700",
  social_media: "bg-purple-50 text-purple-700",
  meta_ads: "bg-purple-50 text-purple-700",
  google: "bg-amber-50 text-amber-700",
  google_ads: "bg-amber-50 text-amber-700",
  cold_call: "bg-orange-50 text-orange-700",
  existing_client: "bg-teal-50 text-teal-700",
  manual: "bg-gray-50 text-gray-700",
  walk_in: "bg-teal-50 text-teal-700",
  event: "bg-pink-50 text-pink-700",
  seminar: "bg-pink-50 text-pink-700",
  webinar: "bg-violet-50 text-violet-700",
  other: "bg-gray-50 text-gray-700",
};

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function LeadsKanban({
  stages,
  initialRows,
}: {
  stages: ReadonlyArray<Stage>;
  initialRows: LeadRow[];
}) {
  const [rows, setRows] = useState<LeadRow[]>(initialRows);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const byStage = useMemo(() => {
    const out: Record<string, LeadRow[]> = {};
    for (const s of stages) out[s.key] = [];
    for (const r of rows) {
      const raw = r.lead.stage;
      const col = stages.find((s) => s.key === raw || s.aliases.includes(raw))?.key ?? "new";
      out[col].push(r);
    }
    return out;
  }, [rows, stages]);

  const activeRow = activeId ? rows.find((r) => r.lead.id === activeId) ?? null : null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setError(null);
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const leadId = String(e.active.id);
    const targetStage = e.over?.id ? String(e.over.id) : null;
    if (!targetStage) return;
    const current = rows.find((r) => r.lead.id === leadId);
    if (!current) return;
    const currentStage = current.lead.stage;
    // Resolve the destination by stage definition (in case the user dropped on
    // an alias). It's always one of the canonical stage keys.
    const dest = stages.find((s) => s.key === targetStage)?.key;
    if (!dest) return;
    if (dest === currentStage) return;

    // Optimistic update
    setRows((prev) =>
      prev.map((r) =>
        r.lead.id === leadId ? { ...r, lead: { ...r.lead, stage: dest } } : r
      )
    );
    setSavingIds((s) => new Set(s).add(leadId));
    try {
      // Stage === blueprint. Advancing the blueprint mirrors the new
      // value back onto leads.stage server-side (engine.ts transitionTo),
      // so we don't need a separate PATCH.
      const res = await fetch(`/api/leads/${leadId}/blueprint/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toStageKey: dest,
          remarks: `Manual stage change via Kanban drag-and-drop.`,
          // Kanban drag = explicit admin override. Skip SOP graph so
          // sideways branch moves (e.g. call_back_later ↔ contact_in_future)
          // and out-of-order corrections work without prereq checks.
          force: true,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        // Revert
        setRows((prev) =>
          prev.map((r) =>
            r.lead.id === leadId
              ? { ...r, lead: { ...r.lead, stage: currentStage } }
              : r
          )
        );
        setError(j.error ?? `Failed to move lead (${res.status})`);
      }
    } catch (err: any) {
      setRows((prev) =>
        prev.map((r) =>
          r.lead.id === leadId
            ? { ...r, lead: { ...r.lead, stage: currentStage } }
            : r
        )
      );
      setError(err?.message ?? "Network error");
    } finally {
      setSavingIds((s) => {
        const n = new Set(s);
        n.delete(leadId);
        return n;
      });
    }
  }

  return (
    <>
      {error && (
        <div className="mb-2 mx-1 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-xs px-3 py-2">
          {error}
        </div>
      )}
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {/* Trello-style horizontal scroller — each column is a fixed-width
           card. The page scrolls horizontally to reach the right-hand stages
           rather than squeezing 8 columns into the viewport. */}
        <div className="flex gap-3 overflow-x-auto scrollbar-thin pb-2 -mx-1 px-1 snap-x">
          {stages.map((s) => {
            const tone = TONE_STYLES[s.tone];
            const items = byStage[s.key] ?? [];
            return (
              <DroppableColumn key={s.key} stage={s} tone={tone} count={items.length}>
                {items.length === 0 ? (
                  <div className="flex items-center justify-center h-24 text-[11px] text-muted-foreground/70 italic">
                    Drop a lead here
                  </div>
                ) : (
                  items
                    .slice(0, 10)
                    .map((row) => (
                      <DraggableCard
                        key={row.lead.id}
                        row={row}
                        saving={savingIds.has(row.lead.id)}
                        isDragging={activeId === row.lead.id}
                      />
                    ))
                )}
                {items.length > 10 && (
                  <Link
                    href={`/dashboard/leads?stage=${s.key}`}
                    className="block text-center text-[11px] text-brand-cyan-deep hover:underline font-medium pt-1"
                  >
                    + {items.length - 10} more →
                  </Link>
                )}
              </DroppableColumn>
            );
          })}
        </div>

        {/* Floating drag preview */}
        <DragOverlay dropAnimation={null}>
          {activeRow ? (
            <div className="rounded-lg bg-card border border-brand-cyan shadow-glow-lg p-2.5 w-[260px] rotate-2 cursor-grabbing">
              <div className="flex items-start gap-2">
                <div className="size-7 rounded-full brand-gradient text-white grid place-items-center text-[10px] font-bold flex-shrink-0 shadow-sm">
                  {initialsOf(activeRow.lead.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-foreground truncate text-[13px]">
                    {activeRow.lead.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground">moving…</div>
                </div>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}

/* ─────────────────────── Droppable Column ─────────────────────── */

function DroppableColumn({
  stage,
  tone,
  count,
  children,
}: {
  stage: Stage;
  tone: typeof TONE_STYLES[string];
  count: number;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: stage.key });
  return (
    <div
      ref={setNodeRef}
      className={`w-72 flex-shrink-0 snap-start rounded-xl border ${
        isOver ? `${tone.ring} ring-2 ring-offset-1 border-transparent` : "border-border/70"
      } ${tone.bg} flex flex-col transition-shadow duration-150`}
    >
      {/* Column header — always single-line. The label whitespace-nowrap so it never wraps. */}
      <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`size-2 rounded-full ${tone.strip} flex-shrink-0`} />
          <span
            className={`text-[12px] font-bold uppercase tracking-wide whitespace-nowrap ${tone.text}`}
          >
            {stage.label}
          </span>
        </div>
        <span
          className={`chip text-[10px] ${tone.chip} font-bold tabular-nums flex-shrink-0`}
        >
          {count}
        </span>
      </div>
      <div className={`h-0.5 ${tone.strip} mx-3 rounded-full opacity-60`} />
      <div className="p-2 space-y-2 flex-1 min-h-[120px]">{children}</div>
    </div>
  );
}

/* ─────────────────────── Draggable Card ─────────────────────── */

function DraggableCard({
  row,
  saving,
  isDragging,
}: {
  row: LeadRow;
  saving: boolean;
  isDragging: boolean;
}) {
  const { lead: l, owner } = row;
  const { attributes, listeners, setNodeRef } = useDraggable({ id: l.id });

  // Whole card is grabbable. The "Open" link + RowActions stop pointer-down
  // propagation so clicking those doesn't accidentally start a drag.
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`group relative rounded-lg bg-card border p-2.5 text-xs shadow-sm cursor-grab active:cursor-grabbing transition-all duration-150 ${
        isDragging
          ? "opacity-30 border-brand-cyan"
          : "hover:shadow-md hover:-translate-y-0.5 border-border/70"
      }`}
    >
      {/* Saving spinner — pinned top-right while a PATCH is in flight */}
      {saving && (
        <Loader2 className="absolute top-1.5 right-1.5 size-3 animate-spin text-brand-cyan" />
      )}
      {/* Row actions — top-right, fades in on hover */}
      <div
        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <RowActions
          editHref={`/dashboard/leads/${l.id}`}
          deleteUrl={`/api/leads/${l.id}`}
          itemLabel="lead"
          itemName={l.name}
          verb="Mark lost"
        />
      </div>

      {/* Top row — avatar + name + phone */}
      <div className="flex items-start gap-2 pr-5">
        <div className="size-8 rounded-full brand-gradient text-white grid place-items-center text-[11px] font-bold flex-shrink-0 shadow-sm">
          {initialsOf(l.name)}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/dashboard/leads/${l.id}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-foreground text-[13px] block truncate hover:underline"
          >
            {l.name}
          </Link>
          {(l.mobile || l.phone) && (
            <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
              {l.mobile ?? l.phone}
            </div>
          )}
        </div>
      </div>

      {/* Source chip + relative time */}
      <div className="mt-2 flex items-center justify-between gap-1.5">
        <span className={`chip text-[10px] ${sourceColors[l.source] ?? "bg-muted"}`}>
          {l.source.replace(/_/g, " ")}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {formatRelative(l.updatedAt)}
        </span>
      </div>

      {/* Owner */}
      {owner && (
        <div className="mt-1.5 pt-1.5 border-t border-border/60 text-[10px] text-muted-foreground truncate">
          <span className="opacity-60">RM ·</span>{" "}
          <span className="font-medium text-foreground/80">{owner}</span>
        </div>
      )}
    </div>
  );
}
