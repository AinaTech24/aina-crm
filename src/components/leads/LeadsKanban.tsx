"use client";

/**
 * Drag-and-drop Kanban for the Leads pipeline.
 *
 * The server `LeadsPage` renders the full chrome (header, KPIs, pipeline
 * wrapper) and hands the raw rows to this client component, which:
 *   - groups them by stage (folding loop stages and legacy aliases into the
 *     six pipeline columns from src/lib/leads/stages.ts)
 *   - renders those columns as droppable zones
 *   - renders each card as draggable
 *   - on drop, optimistically updates local state and PATCHes
 *     /api/leads/[id] with the new stage; reverts on failure.
 */

import { useMemo, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { Loader2, CalendarClock, PhoneCall } from "lucide-react";
import { RowActions } from "@/components/common/RowActions";
import { leadTemperature, stageAgingDays } from "@/lib/leads/scoring";
import { LEAD_STAGE_TAG, leadPipelineColumn, leadStageSlaDays } from "@/lib/leads/stages";
import { leadSourceLabel } from "@/lib/leads/sources";
import { ScheduleMeetingDialog } from "@/components/leads/LeadActions";

type LeadRow = {
  lead: {
    id: string;
    name: string;
    mobile?: string | null;
    phone?: string | null;
    stage: string;
    source: string;
    updatedAt: any;
    /** Extended fields for temperature + aging display — all optional so
     *  back-compat with callers that don't pass them is preserved. */
    stageChangedAt?: string | null;
    createdAt?: string | null;
    lastContactAt?: string | null;
    lastFollowUpAt?: string | null;
    nextFollowUpAt?: string | null;
    intendedAmount?: string | null;
    convertedInvestorId?: string | null;
    utmParams?: {
      source?: string;
      medium?: string;
      campaign?: string;
      term?: string;
      content?: string;
    } | null;
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
  slate:   { strip: "bg-slate-400",   bg: "bg-secondary/40",   chip: "bg-secondary text-foreground",     text: "text-foreground",   ring: "ring-slate-400" },
};

/**
 * Lead source is TAXONOMY — where the lead came from — not a state. It used to
 * be painted blue / emerald / purple / amber / pink / teal / violet by source,
 * with the hue chosen arbitrarily, so a card could show "referral" in the same
 * green as a success chip and "google ads" in the same amber as an SLA warning.
 * Colour on this card is now reserved for things that need a decision: overdue
 * (red), stuck in stage (amber), hot (brand), won (green).
 *
 * The map is kept as a function so call sites do not change, and so a future
 * genuinely-semantic source distinction has somewhere to live.
 */
function sourceChipClass(_source: string): string {
  return "bg-secondary text-secondary-foreground";
}

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
  const router = useRouter();
  const [rows, setRows] = useState<LeadRow[]>(initialRows);
  // Re-sync from the server after a router.refresh() (delete, convert, etc.) so a
  // removed lead's card disappears immediately instead of lingering in local state.
  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Modal interception state
  const [pendingTransition, setPendingTransition] = useState<{
    leadId: string;
    leadName: string;
    dest: string;
    currentStage: string;
  } | null>(null);

  // Client-side pagination state for Kanban columns
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});

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

  const getVisibleCount = (stageKey: string) => visibleCounts[stageKey] ?? 10;

  const loadMore = (stageKey: string) => {
    setVisibleCounts((prev) => ({
      ...prev,
      [stageKey]: (prev[stageKey] ?? 10) + 10,
    }));
  };

  async function advanceLeadStage(
    leadId: string,
    dest: string,
    currentStage: string,
    fields?: Record<string, any>
  ) {
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
          fields,
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
      } else {
        // Persisted server-side (leads.stage is mirrored from the blueprint).
        // Refresh the route so Next's client cache for /dashboard/leads is
        // re-fetched — otherwise opening a lead and hitting "back" would serve
        // the stale pre-drag payload and the card would snap to its old column.
        router.refresh();
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

  function handleCancelTransition() {
    if (!pendingTransition) return;
    const { leadId, currentStage } = pendingTransition;
    setRows((prev) =>
      prev.map((r) =>
        r.lead.id === leadId ? { ...r, lead: { ...r.lead, stage: currentStage } } : r
      )
    );
    setPendingTransition(null);
  }

  async function handleConfirmLost(lostReason: string) {
    if (!pendingTransition) return;
    const { leadId, dest, currentStage } = pendingTransition;
    setPendingTransition(null);
    await advanceLeadStage(leadId, dest, currentStage, {
      lostReason,
      lostAt: new Date().toISOString(),
    });
  }

  async function handleConfirmConvert(pan: string, segmentTag: string) {
    if (!pendingTransition) return;
    const { leadId, currentStage } = pendingTransition;
    setPendingTransition(null);
    setSavingIds((s) => new Set(s).add(leadId));
    try {
      const res = await fetch(`/api/leads/${leadId}/convert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pan, segmentTag }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Revert the optimistic move — conversion didn't happen.
        setRows((prev) => prev.map((r) => (r.lead.id === leadId ? { ...r, lead: { ...r.lead, stage: currentStage } } : r)));
        setError(j.error ?? "Couldn't convert this lead to a client.");
        return;
      }
      // Converted → it's now a client (stage 'converted', off the pipeline) and
      // appears in the Clients table. Refresh to reflect it.
      router.refresh();
    } catch (e: any) {
      setRows((prev) => prev.map((r) => (r.lead.id === leadId ? { ...r, lead: { ...r.lead, stage: currentStage } } : r)));
      setError(e?.message ?? "Network error");
    } finally {
      setSavingIds((s) => {
        const n = new Set(s);
        n.delete(leadId);
        return n;
      });
    }
  }

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
    // Loop stages live inside a column (a "Call back later" card sits in
    // Contacted). Dropping a card back into its own column changes nothing.
    const homeColumn = stages.find((s) => s.key === currentStage || s.aliases.includes(currentStage))?.key;
    if (homeColumn === dest) return;

    // Handle interactive transitions first
    if (dest === "not_qualified") {
      setPendingTransition({
        leadId,
        leadName: current.lead.name,
        dest,
        currentStage,
      });
      // Move card optimistically
      setRows((prev) =>
        prev.map((r) =>
          r.lead.id === leadId ? { ...r, lead: { ...r.lead, stage: dest } } : r
        )
      );
      return;
    }

    if (dest === "meeting_scheduled") {
      setPendingTransition({
        leadId,
        leadName: current.lead.name,
        dest,
        currentStage,
      });
      // Move card optimistically
      setRows((prev) =>
        prev.map((r) =>
          r.lead.id === leadId ? { ...r, lead: { ...r.lead, stage: dest } } : r
        )
      );
      return;
    }

    // Winning a lead converts it to a client — collect the (mandatory) PAN first.
    if (dest === "won_lead") {
      setPendingTransition({
        leadId,
        leadName: current.lead.name,
        dest,
        currentStage,
      });
      setRows((prev) =>
        prev.map((r) =>
          r.lead.id === leadId ? { ...r, lead: { ...r.lead, stage: dest } } : r
        )
      );
      return;
    }

    // Optimistic update
    setRows((prev) =>
      prev.map((r) =>
        r.lead.id === leadId ? { ...r, lead: { ...r.lead, stage: dest } } : r
      )
    );
    await advanceLeadStage(leadId, dest, currentStage);
  }

  return (
    <>
      {error && (
        <div className="mb-2 mx-1 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-xs px-3 py-2">
          {error}
        </div>
      )}
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        // Gentle horizontal edge auto-scroll. Vertical auto-scroll is off and
        // acceleration is low so the board creeps (not jumps) toward off-screen
        // stages — you can stop and drop on any middle column.
        autoScroll={{ enabled: true, threshold: { x: 0.12, y: 0 }, acceleration: 4, interval: 10 }}
      >
        {/* Trello-style horizontal scroller — each column is a fixed-width
           card. The page scrolls horizontally to reach the right-hand stages.
           No scroll-snap: snapping made the auto-scroll jump column-to-column
           during a drag, so you couldn't release on a middle stage. */}
        <div className="flex gap-3 overflow-x-auto scrollbar-thin pb-2 -mx-1 px-1">
          {stages.map((s) => {
            const tone = TONE_STYLES[s.tone];
            const items = byStage[s.key] ?? [];
            const visibleCount = getVisibleCount(s.key);
            return (
              <DroppableColumn key={s.key} stage={s} tone={tone} count={items.length}>
                {items.length === 0 ? (
                  <div className="flex items-center justify-center h-24 text-2xs text-muted-foreground">
                    No leads here
                  </div>
                ) : (
                  <>
                    {items
                      .slice(0, visibleCount)
                      .map((row) => (
                        <DraggableCard
                          key={row.lead.id}
                          row={row}
                          saving={savingIds.has(row.lead.id)}
                          isDragging={activeId === row.lead.id}
                        />
                      ))}
                    {items.length > visibleCount && (
                      <Sentinel onVisible={() => loadMore(s.key)} />
                    )}
                  </>
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
                <div className="size-7 rounded-full brand-gradient text-white grid place-items-center text-2xs font-bold flex-shrink-0 shadow-sm">
                  {initialsOf(activeRow.lead.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-foreground truncate text-xs">
                    {activeRow.lead.name}
                  </div>
                  <div className="text-2xs text-muted-foreground">moving…</div>
                </div>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Interactive modal for marking a lead lost */}
      {pendingTransition?.dest === "not_qualified" && (
        <LostReasonDialog
          leadName={pendingTransition.leadName}
          onClose={handleCancelTransition}
          onConfirm={handleConfirmLost}
        />
      )}

      {/* Interactive modal for scheduling a meeting */}
      {pendingTransition?.dest === "meeting_scheduled" && (
        <ScheduleMeetingDialog
          leadId={pendingTransition.leadId}
          leadName={pendingTransition.leadName}
          onClose={handleCancelTransition}
          onDone={() => {
            setPendingTransition(null);
            router.refresh();
          }}
        />
      )}

      {/* Winning a lead → convert to client (PAN required) */}
      {pendingTransition?.dest === "won_lead" && (
        <ConvertDialog
          leadName={pendingTransition.leadName}
          onClose={handleCancelTransition}
          onConfirm={handleConfirmConvert}
        />
      )}
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
      className={`flex-1 min-w-56 rounded-xl border ${
        isOver ? `${tone.ring} ring-2 ring-offset-1 border-transparent` : "border-border/70"
      } ${tone.bg} flex flex-col transition-shadow duration-150`}
    >
      {/* Column header — always single-line. The label whitespace-nowrap so it never wraps. */}
      <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`size-2 rounded-full ${tone.strip} flex-shrink-0`} />
          <span
            className={`text-2xs font-bold uppercase tracking-wide whitespace-nowrap ${tone.text}`}
          >
            {stage.label}
          </span>
        </div>
        <span
          className={`chip text-2xs ${tone.chip} font-bold tabular-nums flex-shrink-0`}
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

  const temp = leadTemperature(l);
  let tempBorderCls = "border-l-[3px] border-l-slate-400";
  if (temp === "hot") {
    tempBorderCls = "border-l-[3px] border-l-rose-500 shadow-sm hover:shadow-glow-sm hover:shadow-rose-500/10";
  } else if (temp === "warm") {
    tempBorderCls = "border-l-[3px] border-l-amber-500";
  } else if (temp === "cold") {
    tempBorderCls = "border-l-[3px] border-l-sky-400";
  }

  // Whole card is grabbable. The "Open" link + RowActions stop pointer-down
  // propagation so clicking those doesn't accidentally start a drag.
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`group relative rounded-lg bg-card border p-2.5 text-xs transition-all duration-150 ${tempBorderCls} ${
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
          verb="Delete"
        />
      </div>

      {/* Name + phone */}
      <div className="min-w-0 pr-6">
        {/* The link hugs the name (not the full row) and stays draggable: we
            don't stop pointer-down, so grabbing the name starts a card drag,
            while a plain click (no movement) still opens the lead. */}
        <Link
          href={`/dashboard/leads/${l.id}`}
          onClick={(e) => e.stopPropagation()}
          className="font-semibold text-foreground text-xs inline-block max-w-full truncate align-bottom hover:underline"
        >
          {l.name}
        </Link>
        {(l.mobile || l.phone) && (
          <div className="text-2xs text-muted-foreground tabular-nums truncate mt-0.5">
            {l.mobile ?? l.phone}
          </div>
        )}
      </div>

      {/* A loop stage is an outcome of the step, not a step of its own. */}
      {LEAD_STAGE_TAG[l.stage] && (
        <div className="mt-1.5">
          <span className="chip text-2xs inline-flex items-center gap-1 border border-border text-muted-foreground">
            <PhoneCall className="size-2.5" />
            {LEAD_STAGE_TAG[l.stage]}
          </span>
        </div>
      )}

      {/* Source + time in stage */}
      <div className="mt-2 flex items-center gap-1.5">
        <span className={`chip text-2xs truncate ${sourceChipClass(l.source)}`}>{leadSourceLabel(l.source)}</span>
        <TimeInStage lead={l} />
      </div>

      {/* RM + next action */}
      <div className="mt-2 pt-2 border-t border-border/60 flex items-center gap-2">
        <RmAvatar owner={owner} />
        <NextAction at={l.nextFollowUpAt ?? null} />
      </div>
    </div>
  );
}

/**
 * "12d in stage" — muted by default. It turns red only once the lead has sat
 * past its stage's SLA (the blueprint's slaDays, the same number the
 * dashboard's "past stage SLA" count uses). It used to go amber at 7 days and
 * red at 14 whatever the stage, so a lead parked in "Contact in future" (a
 * 30-day SLA) was red for half of its legitimate wait.
 */
function TimeInStage({ lead }: { lead: LeadRow["lead"] }) {
  const days = stageAgingDays(lead);
  if (days == null) return null;
  const sla = leadStageSlaDays(lead.stage);
  const late = sla != null && days > sla;
  const stageName = leadPipelineColumn(lead.stage)?.label ?? "this stage";
  return (
    <span
      className={`ml-auto shrink-0 text-2xs tabular-nums ${late ? "font-semibold text-destructive" : "text-muted-foreground"}`}
      title={
        sla == null
          ? `${days} days in ${stageName}. No time limit for this stage.`
          : late
          ? `${days} days in ${stageName}: past its ${sla}-day limit`
          : `${days} days in ${stageName} (limit ${sla} days)`
      }
    >
      {days < 1 ? "<1d" : `${days}d`} in stage
    </span>
  );
}

/** The RM's initials; the full name on hover and for screen readers. */
function RmAvatar({ owner }: { owner: string | null }) {
  if (!owner) {
    return (
      <span
        className="size-6 shrink-0 rounded-full border border-dashed border-border grid place-items-center text-2xs text-muted-foreground"
        title="No RM assigned"
        aria-label="No RM assigned"
      >
        ?
      </span>
    );
  }
  return (
    <span
      className="size-6 shrink-0 rounded-full bg-secondary text-foreground/80 grid place-items-center text-2xs font-semibold"
      title={`RM: ${owner}`}
      aria-label={`RM: ${owner}`}
    >
      {initialsOf(owner)}
    </span>
  );
}

/** The next follow-up: red once it has passed, muted when none is set. */
function NextAction({ at }: { at: string | null }) {
  if (!at) return <span className="ml-auto text-2xs text-muted-foreground">No next action</span>;
  const when = new Date(at);
  if (isNaN(when.getTime())) return null;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWhen = new Date(when.getFullYear(), when.getMonth(), when.getDate());
  const dayDiff = Math.round((startOfWhen.getTime() - startOfToday.getTime()) / 86_400_000);
  const overdue = when.getTime() < now.getTime();
  const label =
    dayDiff === 0
      ? `Today ${when.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`
      : dayDiff === 1
      ? "Tomorrow"
      : when.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return (
    <span
      className={`ml-auto inline-flex items-center gap-1 text-2xs tabular-nums ${overdue ? "font-semibold text-destructive" : "text-muted-foreground"}`}
      title={`Next follow-up ${when.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}${overdue ? " (overdue)" : ""}`}
    >
      <CalendarClock className="size-3" />
      {overdue ? `Overdue · ${label}` : label}
    </span>
  );
}

/* ─────────────────────── Lazy Loading Sentinel ─────────────────────── */

function Sentinel({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onVisible();
        }
      },
      { threshold: 0.1 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [onVisible]);

  return <div ref={ref} className="h-1 my-1" />;
}

/* ─────────────────────── Lost Reason Dialog ─────────────────────── */

function LostReasonDialog({
  leadName,
  onClose,
  onConfirm,
}: {
  leadName: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [customReason, setCustomReason] = useState("");

  const presetReasons = [
    "Not interested in mutual funds/investing",
    "Already has another advisor/distributor",
    "High fees/pricing concerns",
    "Unable to contact / invalid details",
    "No surplus for investment right now",
    "Other",
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4">
      <div className="bg-card rounded-lg shadow-lg max-w-md w-full flex flex-col p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Mark Lost · {leadName}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Specify the reason why this lead is not qualified or lost. This helps track conversions.
          </p>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium mb-1">Reason for losing lead</label>
          <div className="space-y-1.5">
            {presetReasons.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="radio"
                  name="lostReason"
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="size-4 accent-primary"
                />
                <span>{r}</span>
              </label>
            ))}
          </div>

          {reason === "Other" && (
            <textarea
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              rows={2}
              placeholder="Enter custom reason..."
              className="w-full mt-2 border rounded-md px-3 py-2 text-sm bg-background"
            />
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason === "Other" ? customReason : reason)}
            disabled={!reason || (reason === "Other" && !customReason.trim())}
            className="rounded-md bg-rose-600 text-white px-4 py-2 text-sm font-medium hover:bg-rose-700 disabled:opacity-50"
          >
            Mark Lost
          </button>
        </div>
      </div>
    </div>
  );
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const SEGMENTS = ["Retail", "Affluent", "HNI", "NRI", "Corporate"] as const;

function ConvertDialog({
  leadName,
  onClose,
  onConfirm,
}: {
  leadName: string;
  onClose: () => void;
  onConfirm: (pan: string, segmentTag: string) => void;
}) {
  const [pan, setPan] = useState("");
  const [segment, setSegment] = useState<string>("Retail");
  const valid = PAN_RE.test(pan);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-lg max-w-md w-full flex flex-col p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-base font-semibold text-foreground">Convert to client · {leadName}</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Winning a lead onboards it as a client. PAN is mandatory (KYC). All the
            lead&apos;s data — risk profile, proposals, documents, messages — carries over.
          </p>
        </div>

        <label className="block">
          <div className="text-xs font-medium mb-1">PAN <span className="text-rose-600">*</span></div>
          <input
            value={pan}
            onChange={(e) => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))}
            placeholder="ABCDE1234F"
            className="w-full border rounded-md px-3 py-2 text-sm bg-background font-mono tracking-wider"
            autoFocus
          />
          {pan.length > 0 && !valid && <p className="text-2xs text-rose-600 mt-1">PAN must look like ABCDE1234F.</p>}
        </label>

        <label className="block">
          <div className="text-xs font-medium mb-1">Segment</div>
          <select value={segment} onChange={(e) => setSegment(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm bg-background">
            {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</button>
          <button
            onClick={() => onConfirm(pan, segment)}
            disabled={!valid}
            className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            Convert to client
          </button>
        </div>
      </div>
    </div>
  );
}
