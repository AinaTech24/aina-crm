/**
 * The button's LOOK, in a server-safe module.
 *
 * This is the same class builder `Button` uses; it lives here rather than in
 * Button.tsx because that file carries "use client", and a server component
 * calling into it fails at runtime with:
 *
 *   Attempted to call buttonClass() from the server but buttonClass is on the
 *   client.
 *
 * That matters because `buttonClass()` exists precisely FOR the call sites that
 * are `<Link>`s rather than `<button>`s — and in the App Router most links live
 * in server components. So the helper was, in practice, unusable at the very
 * places it was written for. `tsc` cannot see the rule; only rendering the page
 * does. `humanise` had the same problem and was moved to @/lib/format for the
 * same reason.
 *
 * Button.tsx re-exports everything here, so the ~existing import sites keep
 * working unchanged.
 */

import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

/**
 *   primary    one per screen — the thing the user came to do
 *   secondary  supporting actions that sit beside it
 *   ghost      low-stakes, text-first (cancel, "view all")
 *   danger     destructive; always pair with a confirm
 *   link       inline, looks like text
 */
const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50",
  secondary:
    "border border-border bg-card text-foreground shadow-sm hover:bg-secondary hover:border-foreground/15",
  ghost:
    "text-muted-foreground hover:bg-secondary hover:text-foreground",
  danger:
    "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
  link:
    "text-primary underline-offset-4 hover:underline p-0 h-auto shadow-none",
};

/**
 * Heights are a floor of 32px (36px for `lg`). Measured on the live app, 129 of
 * 159 controls on the Clients screen were under 28px tall — comfortably below
 * what a trackpad can hit reliably.
 */
const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-9 px-4 text-sm gap-1.5 rounded-lg",
  lg: "h-10 px-5 text-sm gap-2 rounded-lg",
  icon: "size-9 p-0 rounded-lg",
};

export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  className?: string,
) {
  return cn(
    "inline-flex items-center justify-center whitespace-nowrap font-medium",
    "transition-colors duration-150",
    "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
    VARIANT[variant],
    variant === "link" ? "text-sm gap-1" : SIZE[size],
    className,
  );
}
