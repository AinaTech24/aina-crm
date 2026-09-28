"use client";

/**
 * FormActions — the sticky footer that keeps Save reachable on a long form.
 *
 * Add client is five sections and ~440 lines; its submit button sits at the
 * bottom, below the fold, with no indication that it exists. The user fills
 * fields downward and then has to hunt. Settings → Profile is worse in the
 * other direction: its `Save details` button sits in a card HEADER, above the
 * fields it saves, so the eye passes it before there is anything to save.
 *
 * This pins the actions to the bottom of the viewport while the form is on
 * screen, so "how do I finish?" is never a question. It sits inside normal flow
 * on print and on short forms it simply looks like a footer.
 *
 * Order is deliberate: the confirming action is LAST (right), matching the rest
 * of the app's dialogs, so a user who has learned one has learned both.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function FormActions({
  children,
  /** Left-aligned slot: unsaved-changes note, validation summary, record count. */
  status,
  className,
  /** Turn off the sticky behaviour for a form inside a dialog or a short panel. */
  sticky = true,
}: {
  children: ReactNode;
  status?: ReactNode;
  className?: string;
  sticky?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        "border-t border-border bg-card/95 px-4 py-3 rounded-b-xl",
        sticky && "sticky bottom-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-card/80 print:static print:bg-transparent",
        className,
      )}
    >
      <div className="text-sm text-muted-foreground min-w-0">{status}</div>
      <div className="flex items-center gap-2 ml-auto">{children}</div>
    </div>
  );
}
