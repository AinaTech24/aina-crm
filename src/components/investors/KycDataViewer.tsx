import { FileText } from "lucide-react";

/**
 * KYC Submission Details — raw extra fields captured by the public onboarding
 * link (guardian_name, overseas_address, tin, pep_status, source_of_wealth,
 * political_exposure, …) that the normal investor form doesn't surface.
 *
 * Pure render (server component). Renders nothing when there's nothing to show,
 * so the caller can mount it unconditionally.
 */
export function KycDataViewer({
  kycData,
}: {
  kycData: Record<string, string> | null | undefined;
}) {
  if (!kycData) return null;

  // Keep only non-empty entries, ordered alphabetically by key for stability.
  const entries = Object.entries(kycData)
    .filter(([, value]) => value != null && String(value).trim() !== "")
    .sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) return null;

  const humanize = (key: string) =>
    key
      .split("_")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="size-7 rounded-lg bg-primary/10 grid place-items-center">
          <FileText className="size-3.5 text-primary" />
        </div>
        <h3 className="text-sm font-semibold">KYC submission details</h3>
      </div>

      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
        {entries.map(([key, value]) => (
          <div key={key} className="min-w-0">
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {humanize(key)}
            </dt>
            <dd className="text-sm font-medium break-words whitespace-pre-wrap line-clamp-3">
              {String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
