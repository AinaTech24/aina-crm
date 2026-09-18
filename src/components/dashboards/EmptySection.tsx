import Link from "next/link";

/**
 * A dashboard section that has nothing to show, rendered as ONE slim row.
 *
 * This exists because of how the cockpit looks on a quiet week. Seven of its
 * fourteen sections can legitimately be empty at once — no transactions in the
 * window, no birthdays in the next seven days, nothing expiring in ninety, no
 * leads in the funnel this month — and each was drawing a full-height panel
 * with a centred icon, a heading and a paragraph explaining itself. Half the
 * page ended up apologising for having no data, at the same visual weight as
 * the half that had some. That is the difference between a dashboard that
 * looks sparse and one that looks unfinished.
 *
 * So: an empty section is a single line. It still says which section it is and
 * what would appear there, because a blank space teaches nobody anything — but
 * it takes roughly 40px instead of 200, and the sections that DO have data get
 * to dominate the page, which is the whole point of a dashboard.
 *
 * The explanatory paragraph is not lost; it becomes the row's `note`, trimmed
 * to one clause. If a section genuinely needs to teach a first-time user more
 * than that, it wants an onboarding card, not an empty state.
 */
export function EmptySection({
  icon: Icon,
  title,
  note,
  href,
  linkLabel = "Open",
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  /** One clause on what lands here. Not a paragraph. */
  note: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="card-surface flex items-center gap-3 px-4 py-2.5">
      <Icon className="size-4 shrink-0 text-muted-foreground/60" />
      <span className="section-title shrink-0">{title}</span>
      <span className="text-2xs text-muted-foreground truncate">{note}</span>
      {href && (
        <Link
          href={href}
          className="ml-auto shrink-0 text-2xs text-muted-foreground hover:text-foreground"
        >
          {linkLabel} →
        </Link>
      )}
    </div>
  );
}
