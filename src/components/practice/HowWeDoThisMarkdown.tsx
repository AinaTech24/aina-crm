/**
 * A small, safe renderer for an SOP's markdown body — headings, bullet and
 * numbered lists, paragraphs and **bold**. Builds React elements (never HTML
 * strings), so an SOP body cannot inject markup. No "use client": usable from
 * server pages and client panels alike.
 */

import type { ReactNode } from "react";
import { parseSopMarkdown } from "@/lib/practice/sop-markdown";

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  parts.forEach((p, i) => {
    if (!p) return;
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
      out.push(<strong key={`${keyBase}-${i}`}>{p.slice(2, -2)}</strong>);
    } else {
      out.push(p);
    }
  });
  return out;
}

export function SopMarkdown({ markdown, className }: { markdown: string; className?: string }) {
  const blocks = parseSopMarkdown(markdown);
  return (
    <div className={`space-y-2 text-sm leading-relaxed ${className ?? ""}`}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        if (b.t === "h") {
          const cls = b.level <= 2 ? "font-semibold text-base mt-3" : "font-semibold mt-2";
          return <p key={k} className={cls}>{inline(b.text, k)}</p>;
        }
        if (b.t === "ul") {
          return (
            <ul key={k} className="list-disc pl-5 space-y-1">
              {b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}
            </ul>
          );
        }
        if (b.t === "ol") {
          return (
            <ol key={k} className="list-decimal pl-5 space-y-1">
              {b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}
            </ol>
          );
        }
        return <p key={k}>{inline(b.text, k)}</p>;
      })}
    </div>
  );
}
