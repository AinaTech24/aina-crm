"use client";

/**
 * SectionNav — a sticky jump-nav for the Lead / Client 360 pages. Lists each
 * section's label; clicking smooth-scrolls to that section (the RelatedListSection
 * wrappers expose `[data-rl-module][data-rl-section]` anchors). The pill for the
 * section currently in view is highlighted (IntersectionObserver), with a brand
 * hover effect. Hidden/reordered sections are respected — we only show anchors
 * that are actually present and visible in the DOM.
 */

import { useEffect, useRef, useState } from "react";

type SectionItem = { key: string; label: string; required?: boolean };

export function SectionNav({ moduleKey, sections }: { moduleKey: string; sections: SectionItem[] }) {
  // Skip the always-on header (it's already at the top).
  const all = sections.filter((s) => !s.required);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(all.map((s) => s.key));
  const [active, setActive] = useState<string>("");
  // Edge-fade affordance: the pill row scrolls horizontally with a hidden
  // scrollbar, so without a cue the user can't tell a label is cut off
  // ("Transact…"). Track whether there's more content off each edge.
  const scrollerRef = useRef<HTMLElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  function recomputeEdges() {
    const el = scrollerRef.current;
    if (!el) return;
    setEdges({
      left: el.scrollLeft > 1,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  }

  function anchor(key: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-rl-module="${moduleKey}"][data-rl-section="${key}"]`);
  }

  function go(key: string) {
    const el = anchor(key);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActive(key);
    }
  }

  useEffect(() => {
    // Only show pills for sections that exist + aren't hidden (display:none from
    // the user's Customize-page prefs).
    const present = all.filter((s) => {
      const el = anchor(s.key);
      return el && getComputedStyle(el).display !== "none";
    });
    setVisibleKeys(present.map((s) => s.key));

    const els = present.map((s) => anchor(s.key)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (top) setActive(top.target.getAttribute("data-rl-section") ?? "");
      },
      { rootMargin: "-15% 0px -75% 0px", threshold: [0, 0.2, 0.5, 1] }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleKey, sections.length]);

  const items = all.filter((s) => visibleKeys.includes(s.key));

  // Recompute the edge fades whenever the visible pill set changes, and on
  // window resize (a narrower window may newly clip the row).
  useEffect(() => {
    recomputeEdges();
    const onResize = () => recomputeEdges();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  if (items.length < 2) return null;

  return (
    <div className="relative sticky top-2 z-20 mb-1">
      <nav
        ref={scrollerRef}
        onScroll={recomputeEdges}
        className="flex gap-1.5 overflow-x-auto scrollbar-none rounded-xl border border-border bg-card/85 px-2 py-1.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/70 print:hidden"
      >
        {items.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => go(s.key)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
              active === s.key
                ? "bg-brand-cyan text-white shadow-sm"
                : "text-muted-foreground hover:-translate-y-px hover:bg-brand-cyan-light/50 hover:text-brand-cyan-deep"
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>
      {/* Edge fades — signal that more pills exist off-screen. */}
      {edges.left && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-8 rounded-l-xl bg-gradient-to-r from-card to-transparent print:hidden" />
      )}
      {edges.right && (
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-xl bg-gradient-to-l from-card to-transparent print:hidden" />
      )}
    </div>
  );
}
