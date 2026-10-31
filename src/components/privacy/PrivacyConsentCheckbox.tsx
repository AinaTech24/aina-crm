"use client";

/**
 * The DPDP consent tick on a public form that collects new personal data
 * (lead form, document upload, fact-find). The form sends `privacyConsent:
 * true` and its API refuses without it, then records the consent
 * (lib/privacy/consent.ts). The notice opens in a new tab so a half-filled
 * form — often inside an iframe on the firm's own website — is not lost.
 */

import { CONSENT_PURPOSE, privacyNoticePath } from "@/lib/privacy/notice";

export function PrivacyConsentCheckbox({
  tenantId,
  firmName,
  source,
  checked,
  onChange,
}: {
  tenantId: string;
  firmName: string;
  source: keyof typeof CONSENT_PURPOSE;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2.5 text-sm leading-relaxed text-foreground">
      <input
        type="checkbox"
        required
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-4 shrink-0"
      />
      <span>
        I have read the{" "}
        <a href={privacyNoticePath(tenantId)} target="_blank" rel="noopener noreferrer" className="underline font-medium">
          privacy notice
        </a>{" "}
        of {firmName} and agree to {firmName} using my details to {CONSENT_PURPOSE[source]}.
      </span>
    </label>
  );
}
