/**
 * captureCalcResults — read the rendered calculator's `data-pdf`-tagged blocks
 * (stats, sections, tables, insights) into a structured payload the server
 * turns into a branded PDF. Order follows the DOM, so the PDF mirrors the page.
 */

export type PdfBlock =
  | { type: "stat"; label: string; value: string }
  | { type: "section"; text: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "insight"; text: string };

const txt = (el: Element | null) => (el?.textContent || "").replace(/\s+/g, " ").trim();

export function captureCalcResults(root: HTMLElement): { title: string; blocks: PdfBlock[] } {
  const title = txt(root.querySelector("h2")) || "Calculator";
  const blocks: PdfBlock[] = [];

  root.querySelectorAll<HTMLElement>("[data-pdf]").forEach((el) => {
    const kind = el.getAttribute("data-pdf");
    if (kind === "stat") {
      blocks.push({
        type: "stat",
        label: el.getAttribute("data-pdf-label") || "",
        value: el.getAttribute("data-pdf-value") || "",
      });
    } else if (kind === "section") {
      blocks.push({ type: "section", text: el.getAttribute("data-pdf-title") || txt(el) });
    } else if (kind === "insight") {
      blocks.push({ type: "insight", text: txt(el) });
    } else if (kind === "table") {
      const head = Array.from(el.querySelectorAll("thead th")).map((th) => txt(th));
      const rows = Array.from(el.querySelectorAll("tbody tr"))
        .map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => txt(td)))
        .filter((r) => r.length > 0);
      if (head.length || rows.length) blocks.push({ type: "table", head, rows });
    }
  });

  return { title, blocks };
}
