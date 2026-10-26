import Link from "next/link";

/**
 * The Practice section's tabs — working ON the firm (The E-Myth Revisited).
 * Every page under /dashboard/practice renders this under its header.
 */
export type PracticeTab = "map" | "positions" | "promise" | "measures" | "experiments" | "strategy" | "manual";

export const PRACTICE_TABS: Array<{ key: PracticeTab; label: string; href: string }> = [
  { key: "map", label: "Systems map", href: "/dashboard/practice" },
  { key: "positions", label: "Positions", href: "/dashboard/practice/positions" },
  { key: "promise", label: "Service promise", href: "/dashboard/practice/promise" },
  { key: "measures", label: "Process measures", href: "/dashboard/practice/measures" },
  { key: "experiments", label: "Message tests", href: "/dashboard/practice/experiments" },
  { key: "strategy", label: "Strategic objective", href: "/dashboard/practice/strategy" },
  { key: "manual", label: "My operations manual", href: "/dashboard/practice/manual" },
];

export function PracticeNav({ active }: { active: PracticeTab }) {
  return (
    <nav aria-label="Practice sections" className="border-b border-border">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {PRACTICE_TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex h-10 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors ${
                  isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
