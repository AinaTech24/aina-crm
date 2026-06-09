/**
 * Shared logo header for free-form / transactional emails (business-entry
 * confirmations, free Compose, …) so every outbound email leads with the firm's
 * logo — matching what the template designer already does via its logo block.
 *
 * Returns "" when the firm has no logo configured, so callers can always inline
 * it unconditionally.
 */
export function emailLogoHeaderHtml(logoUrl?: string | null, firmName?: string | null): string {
  const url = (logoUrl ?? "").trim();
  if (!url) return "";
  const safeUrl = url.replace(/"/g, "&quot;");
  const alt = String(firmName ?? "Logo").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<div style="text-align:center;margin:0 0 18px;"><img src="${safeUrl}" alt="${alt}" height="40" style="height:40px;max-height:48px;display:inline-block;border:0;outline:none;"/></div>`;
}
