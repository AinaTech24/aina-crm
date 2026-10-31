/**
 * "How <firm> uses your personal data — privacy notice" for the foot of every
 * public page (DPDP Act: the notice must be available where data is given).
 * Server-safe; opens the notice in a new tab.
 */

import { privacyNoticePath } from "@/lib/privacy/notice";

export function PrivacyNoticeLink({ tenantId, firmName, className = "" }: { tenantId: string; firmName?: string | null; className?: string }) {
  return (
    <p className={`text-2xs text-muted-foreground text-center ${className}`}>
      How {firmName || "we"} {firmName ? "uses" : "use"} your personal data:{" "}
      <a href={privacyNoticePath(tenantId)} target="_blank" rel="noopener noreferrer" className="underline">
        privacy notice
      </a>
    </p>
  );
}
