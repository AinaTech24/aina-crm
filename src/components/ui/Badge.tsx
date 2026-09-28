"use client";

/**
 * Badge — status and taxonomy pills, with the distinction enforced.
 *
 * The audit found the same data rendered three ways: task priority is an
 * UPPERCASE red chip on /dashboard/tasks and lowercase grey text on My Day;
 * "UTILITY" sits in caps next to "Approved" in sentence case on the same
 * Templates row; and lead source chips are coloured blue/green/amber at random,
 * so colour looks like status while meaning nothing.
 *
 * Two kinds, and they must not be mixed:
 *
 *   tone="neutral"                      TAXONOMY — what something *is*
 *                                       (channel, source, category). Never
 *                                       coloured: it is not a judgement.
 *   tone="success|warning|danger|info"  STATUS — how something is *doing*.
 *                                       Colour is the signal, so spend it only
 *                                       here, and at most once per row.
 *
 * Casing is normalised by the component, so a caller cannot reintroduce the
 * UTILITY/Approved mismatch. Values arrive as raw enum strings
 * (`in_progress`, `sip_rejected`) and print as "In progress", "Sip rejected".
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { humanise } from "@/lib/format";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning-foreground",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
  accent: "bg-accent text-accent-foreground",
};

// Re-exported so the many existing `import { humanise } from ".../Badge"` call
// sites keep working. The implementation is in @/lib/format, which is server-safe.
export { humanise };

export function Badge({
  children,
  tone = "neutral",
  dot = false,
  className,
  /** Skip `humanise()` when the caller already has display copy. */
  raw = false,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  /** Leading dot — use when the badge sits alone and needs to read as a state. */
  dot?: boolean;
  className?: string;
  raw?: boolean;
}) {
  const label = !raw && typeof children === "string" ? humanise(children) : children;
  return (
    <span className={cn("chip", TONE[tone], dot && "chip-dot", className)}>
      {label}
    </span>
  );
}
