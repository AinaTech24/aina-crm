import Link from "next/link";

export type MergeHubTab = "suggestions" | "merge" | "history";

export const MERGE_HUB_TABS: Array<{ key: MergeHubTab; label: string; hint: string }> = [
  { key: "suggestions", label: "Suggested duplicates", hint: "Records the CRM thinks are the same person. Compare them and merge, or mark them as not duplicates." },
  { key: "merge", label: "Merge by search", hint: "Search the main client, then the client to merge into it." },
  { key: "history", label: "Merge history", hint: "Every merge, who made it and why. Anything merged by mistake can be undone here." },
];

/** Old ?tab= values from the five-option hub, mapped to the three that replaced them. */
export function resolveMergeHubTab(tab: string | undefined): { tab: MergeHubTab; systemOnly: boolean } {
  if (tab === "merge") return { tab: "merge", systemOnly: false };
  if (tab === "history" || tab === "merged" || tab === "differ") return { tab: "history", systemOnly: false };
  if (tab === "system") return { tab: "history", systemOnly: true };
  return { tab: "suggestions", systemOnly: false };
}

/** The Merge Clients tabs — the active one carried in ?tab= so a view is linkable. */
export function MergeHubNav({ active, counts }: { active: MergeHubTab; counts: Partial<Record<MergeHubTab, number>> }) {
  return (
    <nav aria-label="Merge Clients sections" className="border-b border-border">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {MERGE_HUB_TABS.map((t) => {
          const isActive = t.key === active;
          const n = counts[t.key];
          return (
            <li key={t.key}>
              <Link
                href={`/dashboard/merge-clients?tab=${t.key}`}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex h-10 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors ${
                  isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
                {typeof n === "number" && n > 0 && <span className="tabular-nums text-xs text-muted-foreground">({n})</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
