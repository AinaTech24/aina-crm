import type { ReactNode } from "react";

/**
 * A short visual label for an icon-only control, shown on hover AND on
 * keyboard focus (a native `title` never shows on focus, and shows late).
 *
 * The tooltip text is aria-hidden: the control itself must carry the same
 * words as its `aria-label`, which is what a screen reader announces. Pass
 * `hidden` while the control's own popover is open, so the two don't stack.
 *
 * Server-safe (no hooks), so a server component can render it directly.
 */
export function Tooltip({
  label,
  children,
  hidden = false,
  align = "center",
}: {
  label: string;
  children: ReactNode;
  hidden?: boolean;
  /** "end" pins the bubble's right edge to the control, for icons near the viewport edge. */
  align?: "center" | "end";
}) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      {!hidden && (
        <span
          aria-hidden
          className={`pointer-events-none absolute top-full z-50 mt-2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-2xs font-medium text-background opacity-0 shadow-md transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100 ${
            align === "end" ? "right-0" : "left-1/2 -translate-x-1/2"
          }`}
        >
          {label}
        </span>
      )}
    </span>
  );
}
