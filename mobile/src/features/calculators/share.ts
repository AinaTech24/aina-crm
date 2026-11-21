/**
 * A calculator result as plain text for WhatsApp. Pure (no React Native), so
 * the share text is testable; CalcUI re-exports it for the calculator screen.
 */

import type { ResultBlock } from "./types";

/** Flatten result blocks into a shareable plain-text summary (WhatsApp). */
export function resultsToText(name: string, firm: string, blocks: ResultBlock[]): string {
  const lines: string[] = [`*${name}*`];
  for (const b of blocks) {
    if (b.type === "section") lines.push(`\n_${b.text}_`);
    else if (b.type === "stat") lines.push(`${b.label}: *${b.value}*`);
    else if (b.type === "insight") lines.push(`💡 ${b.text}`);
    else if (b.type === "note") lines.push(`_${b.text}_`);
    else if (b.type === "chart") continue; // the tables carry the same figures
    else if (b.type === "table") {
      lines.push(b.head.join(" | "));
      b.rows.slice(0, 12).forEach((r) => lines.push(r.join(" | ")));
      if (b.rows.length > 12) lines.push(`… ${b.rows.length - 12} more rows`);
    }
  }
  lines.push(`\n_Illustration by ${firm}. Mutual fund investments are subject to market risks._`);
  return lines.join("\n");
}
