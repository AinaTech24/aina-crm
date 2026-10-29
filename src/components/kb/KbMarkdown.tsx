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
import { inlineShotNumbers, shotUrl } from "@/lib/kb/shots";

export type KbShotRef = { storageKey?: string; caption?: string | null; alt?: string | null };

const SHOT = /^!\[([^\]]*)\]\(shot:(\d{1,3})\)\s*$/;

export { inlineShotNumbers };

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
    else if (m[3]) nodes.push(<code key={k}>{m[4]}</code>);
    else if (m[5]) nodes.push(<em key={k}>{m[6]}</em>);
    else {
      const href = m[9];
      if (href.startsWith("/")) {
        nodes.push(<Link key={k} href={href}>{m[8]}</Link>);
      } else if (/^https?:\/\//i.test(href)) {
        nodes.push(<a key={k} href={href} target="_blank" rel="noreferrer">{m[8]}</a>);
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
        <figure key={key()}>
          {preview ? (
            <div className="kb-shot-ph">Screenshot {n}</div>
          ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <a href={shotUrl(articleId, n - 1, shot.storageKey)} target="_blank" rel="noopener noreferrer">
            <img src={shotUrl(articleId, n - 1, shot.storageKey)} alt={shot.alt || caption || `Screenshot ${n}`} loading="lazy" />
          </a>
          )}
          {caption && <figcaption>{caption}</figcaption>}
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
        <pre key={key()}><code>{body.join("\n")}</code></pre>
      );
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      blocks.push(lvl <= 2 ? <h2 key={key()}>{inline(h[2], `h${b}`)}</h2> : <h3 key={key()}>{inline(h[2], `h${b}`)}</h3>);
      i++;
      continue;
    }

    if (ul.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && ul.test(lines[i])) {
        items.push(<li key={`li${i}`}>{inline(lines[i].replace(ul, ""), `u${i}`)}</li>);
        i++;
      }
      blocks.push(<ul key={key()}>{items}</ul>);
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
      blocks.push(<ol key={key()} start={start}>{items}</ol>);
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
      <p key={key()}>
        {para.map((p, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && <br />}
            {inline(p, `p${b}-${idx}`)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return <div className="kb-prose">{blocks}</div>;
}
