/** 1-based screenshot numbers an article body places inline as `![caption](shot:N)`. */
export function inlineShotNumbers(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of (text ?? "").matchAll(/!\[[^\]]*\]\(shot:(\d{1,3})\)/g)) out.add(Number(m[1]));
  return out;
}
