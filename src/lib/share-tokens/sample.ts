/**
 * The token used by PREVIEW and TEST-SEND links.
 *
 * A preview or test email has no client behind it, so `{{link.feedback}}` and
 * `{{link.risk_profile}}` resolve to their catalogue examples rather than a
 * minted token. Those examples used to be arbitrary ("/f/abc123"), so anyone who
 * clicked a link in a test email landed on "Link unavailable" and reasonably
 * concluded the feature was broken.
 *
 * They now point here instead, and the public form pages recognise it and
 * explain what the link is. Real client emails still carry a real, personal
 * token minted at send time.
 */
export const SAMPLE_SHARE_TOKEN = "sample-preview-link";

/** Base URL for links that must work from an email client. */
export function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://crm.ainatech.in"
  ).replace(/\/+$/, "");
}

export function isSampleShareToken(token: string): boolean {
  return token === SAMPLE_SHARE_TOKEN;
}
