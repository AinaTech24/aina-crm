/**
 * Renders a help-centre article body. Server component, no dependencies.
 *
 * Same small Markdown subset as the editor's toolbar writes — headings, bold /
 * italic / code, links, bulleted and numbered lists — plus screenshots placed
 * where the author put them: `![caption](shot:2)` draws the article's 2nd
 * uploaded screenshot (1-based) through /api/kb/image/<id>?i=<n-1>.
 * Everything is rendered as React elements, never as HTML.
 */

import React from "react";
import Link from "next/link";

export type KbShotRef = { caption?: string | null; alt?: string | null };

const SHOT = /^!\[([^\]]*)\]\(shot:(\d{1,3})\)\s*$/;

/** 1-based screenshot numbers the body places inline. */
export function inlineShotNumbers(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of (text ?? "").matchAll(/!\[[^\]]*\]\(shot:(\d{1,3})\)/g)) out.add(Number(m[1]));
  return out;
}

function inline(text: string, key: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1]) nodes.push(<strong key={k}>{m[2]}</strong>);
    else if (m[3]) nodes.push(<code key={k} className="px-1 py-0.5 rounded bg-muted text-[0.9em] font-mono">{m[4]}</code>);
    else if (m[5]) nodes.push(<em key={k}>{m[6]}</em>);
    else {
      const href = m[9];
      if (href.startsWith("/")) {
        nodes.push(<Link key={k} href={href} className="text-primary font-medium hover:underline">{m[8]}</Link>);
      } else if (/^https?:\/\//i.test(href)) {
        nodes.push(<a key={k} href={href} target="_blank" rel="noreferrer" className="text-primary font-medium hover:underline">{m[8]}</a>);
      } else {
        nodes.push(m[0]);
      }
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function KbMarkdown({
  text,
  articleId,
  shots,
  preview = false,
}: {
  text: string;
  articleId: string;
  shots: KbShotRef[];
  /** Editor preview: an unpublished article's images cannot be served yet, so draw a placeholder. */
  preview?: boolean;
}) {
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let b = 0;
  const key = () => `b${b++}`;

  const ul = /^\s*[-*]\s+/;
  const ol = /^\s*(\d+)\.\s+/;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const img = line.trim().match(SHOT);
    if (img) {
      const n = Number(img[2]);
      const shot = shots[n - 1];
      i++;
      if (!shot) continue;
      const caption = img[1].trim() || shot.caption || "";
      blocks.push(
        <figure key={key()} className="my-5">
          {preview ? (
            <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-border bg-secondary/40 text-xs text-muted-foreground">
              Screenshot {n}
            </div>
          ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/kb/image/${articleId}?i=${n - 1}`}
            alt={shot.alt || caption || `Screenshot ${n}`}
            className="w-full h-auto rounded-md border border-border/60 bg-white"
            loading="lazy"
          />
          )}
          {caption && <figcaption className="mt-1.5 text-xs text-muted-foreground">{caption}</figcaption>}
        </figure>
      );
      continue;
    }

    const fence = line.match(/^```\s*$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push(
        <pre key={key()} className="my-3 overflow-x-auto rounded-lg bg-muted p-3 text-xs font-mono"><code>{body.join("\n")}</code></pre>
      );
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const cls =
        lvl <= 2
          ? "mt-8 mb-2 text-xl font-bold text-foreground"
          : lvl === 3
          ? "mt-6 mb-1.5 text-base font-bold text-foreground"
          : "mt-4 mb-1 text-sm font-bold text-foreground";
      blocks.push(
        lvl <= 2 ? <h2 key={key()} className={cls}>{inline(h[2], `h${b}`)}</h2> : <h3 key={key()} className={cls}>{inline(h[2], `h${b}`)}</h3>
      );
      i++;
      continue;
    }

    if (ul.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && ul.test(lines[i])) {
        items.push(<li key={`li${i}`}>{inline(lines[i].replace(ul, ""), `u${i}`)}</li>);
        i++;
      }
      blocks.push(<ul key={key()} className="list-disc pl-6 my-3 space-y-1.5">{items}</ul>);
      continue;
    }

    const o = line.match(ol);
    if (o) {
      const start = Number(o[1]);
      const items: React.ReactNode[] = [];
      while (i < lines.length && ol.test(lines[i])) {
        items.push(<li key={`li${i}`}>{inline(lines[i].replace(ol, ""), `o${i}`)}</li>);
        i++;
      }
      // `start` keeps the numbering going when a screenshot sits between steps.
      blocks.push(<ol key={key()} start={start} className="list-decimal pl-6 my-3 space-y-1.5">{items}</ol>);
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !ul.test(lines[i]) &&
      !ol.test(lines[i]) &&
      !SHOT.test(lines[i].trim()) &&
      !/^```/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    blocks.push(
      <p key={key()} className="my-3">
        {para.map((p, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && <br />}
            {inline(p, `p${b}-${idx}`)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return <div className="text-[15px] leading-relaxed text-foreground/90">{blocks}</div>;
}
