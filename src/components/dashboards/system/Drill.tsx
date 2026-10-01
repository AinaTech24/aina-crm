/**
 * A figure on a dashboard card that opens the rows it counts.
 *
 * One look for every drill-down, so a reader learns it once: the number keeps
 * its colour and weight at rest (a card full of blue numbers reads as a page
 * of links, not of figures) and shows it is a link on hover and keyboard
 * focus. With no href — a bucket no list can open exactly, a "—" — it renders
 * the plain figure: a link must open the rows it counts (links.ts), never a
 * list that merely looks related.
 *
 * Server-safe: no client hooks, just next/link.
 */

import Link from "next/link";
import type { ReactNode } from "react";

export function Drill({
  href,
  children,
  title,
  className = "",
}: {
  href?: string | null;
  children: ReactNode;
  /** What the click opens, for the tooltip and screen readers. */
  title?: string;
  className?: string;
}) {
  if (!href) return <>{children}</>;
  return (
    <Link
      href={href}
      title={title}
      className={`rounded-sm underline-offset-2 decoration-primary/60 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
    >
      {children}
    </Link>
  );
}
