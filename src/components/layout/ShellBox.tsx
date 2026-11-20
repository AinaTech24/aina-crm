"use client";

import type { ElementType, ReactNode } from "react";

/**
 * A container element for the dashboard shell (dashboard/layout.tsx) that
 * hydrates safely while the server is still streaming.
 *
 * ── Why the shell cannot use a plain <div> / <main> ──────────────────────────
 *
 * React Flight stops inlining elements once a payload row passes 3,200 bytes
 * and sends the rest as deferred rows (`$L…` references) later in the stream.
 * The sidebar carries every nav item, so everything after it in the layout —
 * <main>, the floating + button, the command palette — arrives as deferred rows.
 *
 * When the browser starts hydrating before those rows have arrived (a cold or
 * busy server, cached JS), the container's children suspend. React then
 * replays the container, but replaying a HOST element re-claims its server
 * node from where the hydration cursor already is (inside the element), so it
 * compares <div> with the <aside> inside it. That is React error #418 "server
 * rendered HTML didn't match", and the whole page is thrown away and
 * re-rendered on the client. Measured 2026-11-02: 10 of 18 cold-server loads.
 *
 * Here the element is created on the client and its children are resolved one
 * level down, in <Slot> — a function component. React replays a function
 * component cleanly, so a deferred row is simply waited for. Slot renders no
 * DOM of its own, so the markup is exactly what a plain element would give.
 *
 * Use it for any shell container that sits OUTSIDE the page's Suspense
 * boundary (loading.tsx) and has element children. Inside the page it is not
 * needed: there a suspended child is retried from its boundary.
 */
function Slot({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

type ShellBoxProps = {
  /** The element to render. Defaults to "div". */
  as?: ElementType;
  children?: ReactNode;
  [attr: string]: unknown;
};

export function ShellBox({ as: Tag = "div", children, ...attrs }: ShellBoxProps) {
  return (
    <Tag {...attrs}>
      <Slot>{children}</Slot>
    </Tag>
  );
}
