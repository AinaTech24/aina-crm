import Link from "next/link";
import { ArrowRight, GitMerge, Users2, Settings2 } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";

/**
 * Family Master tools — one place that answers "what can I do with households?"
 *
 * The unmapped queue is the one that actually moves coverage, so it leads, and
 * it is the page's primary action: "Map 768 clients →".
 *
 * The counts come from the page, over the clients THIS person can see (live
 * clients only). They used to be firm-wide, so an RM was told to "Map 9,434
 * clients" and then found a queue of their own forty.
 */
export function FamilyToolsGrid({
  mapped,
  unmapped,
  showCoverage = true,
}: {
  mapped: number;
  unmapped: number;
  /** False for someone who can see families but not the client book. */
  showCoverage?: boolean;
}) {
  const total = mapped + unmapped;
  const coverage = total > 0 ? Math.round((mapped / total) * 100) : 0;

  const tiles = [
    ...(showCoverage
      ? [{
          href: "/dashboard/families/unmapped",
          icon: Users2,
          title: "Unmapped clients",
          desc: unmapped > 0 ? "Clients not in any family yet" : "Every client is in a family",
          cta: unmapped > 0 ? `Map ${unmapped.toLocaleString("en-IN")} client${unmapped === 1 ? "" : "s"} →` : null,
          primary: unmapped > 0,
        }]
      : []),
    {
      href: "/dashboard/duplicates?tab=families",
      icon: GitMerge,
      title: "Merge duplicates",
      desc: "Combine families created twice",
      cta: null,
      primary: false,
    },
    {
      href: "/dashboard/families/settings",
      icon: Settings2,
      title: "Family settings",
      desc: "Relationship types and defaults for new families",
      cta: null,
      primary: false,
    },
  ];

  return (
    <div className="space-y-3">
      {showCoverage && total > 0 && (
        <div className="flex items-baseline justify-end gap-3 text-xs text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">{coverage}%</span> of your clients are in a family
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`group flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/40 ${
              t.primary ? "border-primary/30" : "border-border"
            }`}
          >
            <span
              className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                t.primary ? "bg-accent text-primary" : "bg-secondary text-foreground/70"
              }`}
            >
              <t.icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-sm font-semibold">{t.title}</span>
              <span className="mt-0.5 block text-2xs text-muted-foreground">{t.desc}</span>
              {t.cta && <span className={buttonClass("primary", "sm", "mt-3")}>{t.cta}</span>}
            </span>
            {!t.cta && (
              <ArrowRight className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
