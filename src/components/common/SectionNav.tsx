"use client";

/**
 * SectionNav — a sticky jump-nav for the Lead / Client 360 pages. Lists each
 * section's label; clicking smooth-scrolls to that section (the RelatedListSection
 * wrappers expose `[data-rl-module][data-rl-section]` anchors). The pill for the
 * section currently in view is highlighted (IntersectionObserver), with a brand
 * hover effect. Hidden/reordered sections are respected — we only show anchors
 * that are actually present and visible in the DOM.
 */

import { useEffect, useState } from "react";

type SectionItem = { key: string; label: string; required?: boolean };

export function SectionNav({ moduleKey, sections }: { moduleKey: string; sections: SectionItem[] }) {
  // Skip the always-on header (it's already at the top).
  const all = sections.filter((s) => !s.required);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(all.map((s) => s.key));
  const [active, setActive] = useState<string>("");

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
  if (items.length < 2) return null;

  return (
    <nav className="sticky top-2 z-20 mb-1 flex gap-1.5 overflow-x-auto scrollbar-thin rounded-xl border border-border bg-card/85 px-2 py-1.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/70 print:hidden">
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
  );
}
