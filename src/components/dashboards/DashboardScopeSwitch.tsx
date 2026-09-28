"use client";

/**
 * Firm-wide ⟷ Branch ⟷ My portfolio.
 *
 * The same person can want three different dashboards, and the mistake would
 * be to merge them: firm-wide overdue tasks bury the four that are actually
 * yours, and a personal AUM figure sitting in a firm cockpit reads as the
 * firm's. So they stay separate views of one route, and this is the switch
 * between them.
 *
 * WHICH options appear is the page's decision, not this component's: a branch
 * head without cross-branch access is never offered "Firm-wide" (the brief:
 * "do not allow access to another branch unless explicitly permitted"), and a
 * user with no branch is never offered "Branch". Hiding the option is not the
 * security — the page refuses the scope server-side as well.
 *
 * It preserves every other query parameter. Losing the period on a scope
 * change would mean re-picking the date range every time, which is exactly
 * the friction that stops people switching at all. The exceptions are params
 * that mean something different, or nothing, in the other view: `rm` (a
 * member filter on the firm cockpit, an RM drill-down on the branch view),
 * `tab`, and the branch view's own toggles.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Building2, Store, UserRound } from "lucide-react";

import { BRANCH_ONLY_PARAMS, MINE_ONLY_PARAMS, type DashboardScope } from "@/lib/dashboard/scope";

const OPTIONS: Array<{ key: DashboardScope; label: string; icon: typeof Building2; hint: string }> = [
  { key: "firm", label: "Firm-wide", icon: Building2, hint: "The whole business — every branch, every RM" },
  { key: "branch", label: "Branch", icon: Store, hint: "One branch — its RMs, clients, service and exceptions" },
  { key: "mine", label: "My portfolio", icon: UserRound, hint: "Only my own clients, business and follow-ups" },
];

export function DashboardScopeSwitch({
  current,
  available = ["firm", "mine"],
}: {
  current: DashboardScope;
  /** The scopes this viewer may open, in display order. */
  available?: DashboardScope[];
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  function hrefFor(key: DashboardScope) {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (key === "firm") next.delete("scope");
    else next.set("scope", key);
    next.delete("rm");
    next.delete("tab");
    if (key !== "branch") for (const p of BRANCH_ONLY_PARAMS) next.delete(p);
    if (key !== "mine") for (const p of MINE_ONLY_PARAMS) next.delete(p);
    // A firm-cockpit branch filter carries into the branch view (same branch);
    // on "my portfolio" it means nothing.
    if (key === "mine") next.delete("branch");
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  const shown = OPTIONS.filter((o) => available.includes(o.key));
  if (shown.length < 2) return null;

  return (
    <nav className="inline-flex rounded-xl border border-border/70 bg-secondary/70 p-1" aria-label="Dashboard scope">
      {shown.map((o) => {
        const active = o.key === current;
        const Icon = o.icon;
        return (
          <Link
            key={o.key}
            href={hrefFor(o.key)}
            aria-current={active ? "page" : undefined}
            title={o.hint}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-xs transition-colors ${
              active
                ? "bg-card font-semibold text-primary shadow-sm"
                : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
            }`}
          >
            <Icon className="size-3.5" aria-hidden />
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
