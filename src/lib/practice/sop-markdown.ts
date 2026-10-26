/**
 * The block structure of an SOP's markdown body — headings, bullet and
 * numbered lists, paragraphs. Pure; rendered by SopMarkdown
 * (components/practice/HowWeDoThisMarkdown.tsx).
 */

export type SopMarkdownBlock =
  | { t: "h"; level: number; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "p"; text: string };

export function parseSopMarkdown(md: string): SopMarkdownBlock[] {
  const blocks: SopMarkdownBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: "p", text: para.join(" ") });
    para = [];
  };
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flush(); blocks.push({ t: "h", level: h[1].length, text: h[2] }); continue; }
    const ul = /^[-*•]\s+(.*)$/.exec(line);
    if (ul) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.t === "ul") last.items.push(ul[1]);
      else blocks.push({ t: "ul", items: [ul[1]] });
      continue;
    }
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ol) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.t === "ol") last.items.push(ol[1]);
      else blocks.push({ t: "ol", items: [ol[1]] });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

