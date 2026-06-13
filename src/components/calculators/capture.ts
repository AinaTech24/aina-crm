/**
 * captureCalcResults — read the rendered calculator's inputs and `data-pdf`-
 * tagged output blocks (stats, sections, tables, insights) into a structured
 * payload the server turns into a branded PDF. Order follows the DOM, so the
 * PDF mirrors the page: an "Inputs & assumptions" table first, then the results.
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

  // Inputs & assumptions — so the client sees the exact figures the
  // illustration was built from, not just the result. Calculators wrap every
  // control in `<label><span>Label</span><control/></label>` (the Field
  // primitive + raw selects/dates all follow this), so one generic label scan
  // covers NumberField, TextField, dates, selects and checkboxes. Segmented is
  // a button-group with no form control, so it carries a data-pdf-input marker.
  const seen = new Set<string>();
  const inputRows: string[][] = [];
  const pushInput = (rawLabel: string, rawValue: string) => {
    const label = rawLabel.replace(/\s+/g, " ").trim();
    const value = rawValue.replace(/\s+/g, " ").trim();
    const key = `${label} :: ${value}`;
    if (!label || seen.has(key)) return; // skip unlabelled + exact-duplicate rows
    seen.add(key);
    inputRows.push([label, value || "-"]);
  };

  root.querySelectorAll<HTMLLabelElement>("label").forEach((label) => {
    const control = label.querySelector<HTMLElement>("input, select, textarea");
    if (!control) return;
    const labelText = txt(label.querySelector("span"));
    if (!labelText) return;
    let value = "";
    if (control instanceof HTMLSelectElement) {
      value = control.selectedOptions[0]?.text ?? control.value;
    } else if (control instanceof HTMLInputElement) {
      if (control.type === "checkbox") value = control.checked ? "Yes" : "No";
      else if (control.type === "radio") {
        if (!control.checked) return;
        value = control.value;
      } else if (control.type === "number") {
        const n = Number(control.value);
        value = control.value !== "" && Number.isFinite(n) ? n.toLocaleString("en-IN") : control.value;
      } else value = control.value;
    } else if (control instanceof HTMLTextAreaElement) {
      value = control.value;
    }
    pushInput(labelText, value);
  });

  // Segmented button-groups (no form control to read) carry data-pdf-input.
  root.querySelectorAll<HTMLElement>("[data-pdf-input]").forEach((el) => {
    if (el.matches("input, select, textarea")) return; // already handled above
    pushInput(el.getAttribute("data-pdf-input-label") || "", el.getAttribute("data-pdf-input-value") || "");
  });

  if (inputRows.length) {
    blocks.push({ type: "section", text: "Inputs & assumptions" });
    blocks.push({ type: "table", head: ["Field", "Value"], rows: inputRows });
  }

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
