"use client";

/**
 * RelatedListsManager + RelatedListSection — Zoho-style page-level
 * customization for detail pages.
 *
 * Pattern (mirrors Zoho's "Customize an individual related list"):
 *
 *   <RelatedListsContainer>          ← flex column with `order`-controlled
 *                                       children, the manager button injects
 *                                       CSS scoped to data-rl-module="leads"
 *     <RelatedListsManager moduleKey="leads" sections={SECTIONS} />
 *     <RelatedListSection key="…" moduleKey="leads" sectionKey="header">
 *       …always-on header…
 *     </RelatedListSection>
 *     <RelatedListSection moduleKey="leads" sectionKey="blueprint">
 *       <BlueprintStageBar/>
 *     </RelatedListSection>
 *     <RelatedListSection moduleKey="leads" sectionKey="activity">
 *       <ActivityTimeline/>
 *     </RelatedListSection>
 *   </RelatedListsContainer>
 *
 * What the user gets:
 *   - A "Customize page" button in the header
 *   - A side-drawer with each section listed
 *   - Per section: checkbox to show/hide + ▲/▼ to reorder
 *   - Reset to defaults button
 *   - Choices persist to localStorage keyed by `rl:<moduleKey>` (per browser)
 *
 * Implementation parallels ColumnManager: we leave the SSR'd JSX intact
 * and inject a <style> block that:
 *   - sets `order: N` on each section's data attribute
 *   - sets `display: none` on hidden sections
 *
 * Required sections (e.g. the page header) can't be hidden — they're set
 * with `required: true` in the section list.
 */

import { useEffect, useMemo, useState, useRef } from "react";
import {
  Settings2,
  Check,
  RotateCcw,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  X,
  Layers,
} from "lucide-react";

export type RelatedListDef = {
  /** Matches `sectionKey` on the wrapping <RelatedListSection>. */
  key: string;
  /** Human label shown in the customize panel. */
  label: string;
  /** Always shown, can't be hidden (header, actions, etc.). */
  required?: boolean;
  /** Off by default — user has to opt in. */
  defaultHidden?: boolean;
};

type Prefs = {
  order: string[];
  hidden: string[];
};

const DEFAULT_PREFS: Prefs = { order: [], hidden: [] };

/* -------------------- Container -------------------- */

/**
 * Wraps the detail-page section stack in a flex column that respects
 * CSS `order` overrides emitted by the manager. Use this instead of
 * `space-y-6` etc.
 */
export function RelatedListsContainer({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`flex flex-col gap-6 ${className}`}>{children}</div>;
}

/* -------------------- Section wrapper -------------------- */

export function RelatedListSection({
  moduleKey,
  sectionKey,
  children,
}: {
  moduleKey: string;
  sectionKey: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-rl-module={moduleKey}
      data-rl-section={sectionKey}
      style={{ order: 0 }}
    >
      {children}
    </div>
  );
}

/* -------------------- Manager -------------------- */

export function RelatedListsManager({
  moduleKey,
  sections,
}: {
  moduleKey: string;
  sections: RelatedListDef[];
}) {
  const storageKey = `rl:${moduleKey}`;

  // null = not hydrated → no overrides → render in source order
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [open, setOpen] = useState(false);

  // Load prefs once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Prefs;
        setPrefs({
          order: Array.isArray(parsed.order) ? parsed.order : [],
          hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
        });
        return;
      }
    } catch {}
    // First visit: hide sections marked defaultHidden, no reorder.
    setPrefs({
      order: [],
      hidden: sections.filter((s) => s.defaultHidden && !s.required).map((s) => s.key),
    });
  }, [storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist on change.
  useEffect(() => {
    if (prefs == null) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(prefs));
    } catch {}
  }, [prefs, storageKey]);

  // Effective ordered list — sections in `prefs.order` first, then any
  // remaining sections in source order.
  const ordered = useMemo<RelatedListDef[]>(() => {
    if (!prefs) return sections;
    const bySource = new Map(sections.map((s) => [s.key, s]));
    const seen = new Set<string>();
    const out: RelatedListDef[] = [];
    for (const k of prefs.order) {
      const def = bySource.get(k);
      if (def) {
        out.push(def);
        seen.add(k);
      }
    }
    for (const s of sections) {
      if (!seen.has(s.key)) out.push(s);
    }
    return out;
  }, [sections, prefs]);

  const hiddenSet = useMemo(() => new Set(prefs?.hidden ?? []), [prefs]);

  // Generate the scoped CSS:
  //   - order: N for each section
  //   - display: none for hidden sections
  const css = useMemo(() => {
    if (!prefs) return "";
    const lines: string[] = [];
    ordered.forEach((s, i) => {
      lines.push(
        `[data-rl-module="${moduleKey}"][data-rl-section="${s.key}"] { order: ${i} !important; }`
      );
    });
    for (const k of hiddenSet) {
      lines.push(
        `[data-rl-module="${moduleKey}"][data-rl-section="${k}"] { display: none !important; }`
      );
    }
    return lines.join("\n");
  }, [ordered, hiddenSet, moduleKey, prefs]);

  function toggleHidden(key: string) {
    const def = sections.find((s) => s.key === key);
    if (def?.required) return;
    setPrefs((p) => {
      if (!p) return p;
      const has = p.hidden.includes(key);
      return {
        ...p,
        hidden: has ? p.hidden.filter((k) => k !== key) : [...p.hidden, key],
      };
    });
  }

  function move(key: string, dir: -1 | 1) {
    setPrefs((p) => {
      if (!p) return p;
      // Start from the current effective order
      const cur = ordered.map((s) => s.key);
      const idx = cur.indexOf(key);
      if (idx < 0) return p;
      const next = idx + dir;
      if (next < 0 || next >= cur.length) return p;
      const copy = [...cur];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return { ...p, order: copy };
    });
  }

  function reset() {
    setPrefs({
      order: [],
      hidden: sections.filter((s) => s.defaultHidden && !s.required).map((s) => s.key),
    });
  }

  const visibleCount = ordered.length - hiddenSet.size;

  return (
    <>
      {css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-xs font-medium hover:bg-secondary inline-flex items-center gap-1.5"
        title="Show / hide and reorder the sections on this page"
      >
        <Settings2 className="size-3.5" />
        Customize page
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {visibleCount}/{sections.length}
        </span>
      </button>

      {open && (
        <CustomizeDrawer
          sections={ordered}
          hidden={hiddenSet}
          onToggle={toggleHidden}
          onMove={move}
          onReset={reset}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/* -------------------- Drawer -------------------- */

function CustomizeDrawer({
  sections,
  hidden,
  onToggle,
  onMove,
  onReset,
  onClose,
}: {
  sections: RelatedListDef[];
  hidden: Set<string>;
  onToggle: (k: string) => void;
  onMove: (k: string, dir: -1 | 1) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex justify-end"
      onClick={onClose}
    >
      <div
        ref={ref}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md h-full bg-card border-l border-border shadow-2xl flex flex-col"
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="font-semibold flex items-center gap-2">
              <Layers className="size-4 text-brand-cyan" />
              Customize page sections
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Show / hide sections and reorder them. Saved per browser.
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-accent"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {sections.map((s, i) => {
            const isHidden = hidden.has(s.key);
            const isFirst = i === 0;
            const isLast = i === sections.length - 1;
            return (
              <div
                key={s.key}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
                  isHidden ? "bg-muted/40 border-border" : "bg-card border-border"
                }`}
              >
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => onMove(s.key, -1)}
                    disabled={isFirst}
                    className="rounded p-0.5 hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Move up"
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(s.key, 1)}
                    disabled={isLast}
                    className="rounded p-0.5 hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Move down"
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onToggle(s.key)}
                  disabled={s.required}
                  className="flex-1 text-left flex items-center gap-2 disabled:cursor-not-allowed"
                >
                  <span
                    className={`inline-block size-4 rounded border ${
                      !isHidden
                        ? "bg-primary border-primary"
                        : "bg-background border-border"
                    } flex-shrink-0 grid place-items-center`}
                  >
                    {!isHidden && <Check className="size-3 text-primary-foreground" />}
                  </span>
                  <span
                    className={`text-sm ${
                      isHidden ? "text-muted-foreground line-through" : ""
                    }`}
                  >
                    {s.label}
                  </span>
                  {s.required && (
                    <span className="ml-auto text-[9px] text-muted-foreground italic">
                      required
                    </span>
                  )}
                </button>

                {!s.required && (
                  <button
                    type="button"
                    onClick={() => onToggle(s.key)}
                    className="rounded p-1 hover:bg-accent text-muted-foreground"
                    aria-label={isHidden ? "Show section" : "Hide section"}
                  >
                    {isHidden ? (
                      <EyeOff className="size-3.5" />
                    ) : (
                      <Eye className="size-3.5" />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between bg-muted/30">
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <RotateCcw className="size-3" /> Reset to defaults
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
