/**
 * The one count badge: a pill that grows with its number ("3", "28", "99+"),
 * so a two- or three-character count is never clipped by a fixed-size circle.
 *
 *  - `corner` sits on the top-right edge of a round icon button (the parent
 *    must be `relative`), with a ring in the card colour so it reads as a
 *    separate object over the button.
 *  - `inline` sits in a row of text (sidebar items, tabs).
 *
 * Tone is a signal, not decoration (CLAUDE.md "Colour is a signal"): `alert`
 * (red) for unread / overdue work only, `brand` for neutral counts that are
 * still worth a glance (birthdays today), `muted` for plain totals.
 *
 * The number is decorative for screen readers — put the count in the
 * control's aria-label (`countLabel` helps), e.g. "Notifications, 12 unread".
 */

export function formatCount(count: number, max = 99): string {
  return count > max ? `${max}+` : String(count);
}

/** "Notifications" → "Notifications, 12 unread"; a zero count adds nothing. */
export function countLabel(label: string, count: number, noun = "unread"): string {
  return count > 0 ? `${label}, ${count} ${noun}` : label;
}

const TONES = {
  alert: "bg-destructive text-destructive-foreground",
  brand: "bg-primary text-primary-foreground",
  muted: "bg-secondary text-secondary-foreground",
} as const;

export function CountBadge({
  count,
  max = 99,
  tone = "alert",
  placement = "inline",
  className = "",
}: {
  count: number;
  max?: number;
  tone?: keyof typeof TONES;
  placement?: "corner" | "inline";
  className?: string;
}) {
  if (!count || count < 0) return null;
  const pos = placement === "corner"
    ? "pointer-events-none absolute -top-1 -right-1 ring-2 ring-card"
    : "";
  return (
    <span
      aria-hidden="true"
      className={`${pos} inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-2xs font-semibold leading-none tabular-nums whitespace-nowrap ${TONES[tone]} ${className}`}
    >
      {formatCount(count, max)}
    </span>
  );
}
