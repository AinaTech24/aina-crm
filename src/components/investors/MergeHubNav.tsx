import Link from "next/link";
import { GitMerge, Scissors, ListChecks, Lightbulb, Sparkles, type LucideIcon } from "lucide-react";

export type MergeHubTab = "merge" | "differ" | "merged" | "suggestions" | "system";

export const MERGE_HUB_TABS: Array<{ key: MergeHubTab; label: string; icon: LucideIcon; hint: string }> = [
  { key: "merge", label: "Merge Client", icon: GitMerge, hint: "Search, pick records, preview, merge" },
  { key: "differ", label: "Differ Clients", icon: Scissors, hint: "Separate a merge that was wrong" },
  { key: "merged", label: "View All Merged Clients", icon: ListChecks, hint: "Every merge on record" },
  { key: "suggestions", label: "Unmerged Suggestion List", icon: Lightbulb, hint: "Likely duplicates awaiting a decision" },
  { key: "system", label: "Client Merged By System", icon: Sparkles, hint: "Merged without a human review — worth a look" },
];

/**
 * Left-hand utility nav for the Merge Clients hub — five fixed options, the
 * active one carried in ?tab= so a view is linkable. Counts are badges, not
 * the label, so the option names stay stable and scannable.
 */
export function MergeHubNav({ active, counts }: { active: MergeHubTab; counts: Partial<Record<MergeHubTab, number>> }) {
  return (
    <nav aria-label="Merge Clients sections" className="card-surface p-2 lg:sticky lg:top-20">
      <ul className="flex lg:flex-col gap-1 overflow-x-auto">
        {MERGE_HUB_TABS.map((t) => {
          const isActive = t.key === active;
          const n = counts[t.key];
          return (
            <li key={t.key} className="shrink-0 lg:shrink">
              <Link
                href={`/dashboard/merge-clients?tab=${t.key}`}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  isActive ? "bg-primary text-primary-foreground font-semibold" : "text-foreground hover:bg-secondary"
                }`}
                title={t.hint}
              >
                <t.icon className={`size-4 shrink-0 ${isActive ? "" : "text-muted-foreground"}`} />
                <span className="truncate">{t.label}</span>
                {typeof n === "number" && n > 0 && (
                  <span
                    className={`ml-auto text-[10px] font-semibold tabular-nums rounded-full px-1.5 py-0.5 ${
                      isActive ? "bg-white/25 text-white" : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {n}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
