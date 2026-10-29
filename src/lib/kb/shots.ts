/** 1-based screenshot numbers an article body places inline as `![caption](shot:N)`. */
export function inlineShotNumbers(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of (text ?? "").matchAll(/!\[[^\]]*\]\(shot:(\d{1,3})\)/g)) out.add(Number(m[1]));
  return out;
}

/**
 * Where a screenshot is served from. A shipped screenshot is a file in /public, so its storage
 * key is a path ("/kb/…"); one an admin uploaded is an object-store key, served (and
 * authorised) through /api/kb/image.
 */
export function shotUrl(articleId: string, index: number, storageKey?: string | null): string {
  return storageKey && storageKey.startsWith("/") ? storageKey : `/api/kb/image/${articleId}?i=${index}`;
}
