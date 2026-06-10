import * as XLSX from "xlsx";

const path = String.raw`C:\Users\PRITESH THAKOR\OneDrive\NLE Master\Next Level\BIRD Event Details\BIRD - Feb 2025\Growing SIP Calculator and SIP Calculator.xlsx`;

const wb = XLSX.readFile(path, { cellFormula: true });
console.log("SHEETS:", wb.SheetNames.join(" | "));
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  console.log(`\n===== SHEET: ${name} =====`);
  if (!ws["!ref"]) { console.log("(empty)"); continue; }
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = (ws as any)[addr];
      if (!cell) continue;
      const val = cell.v === undefined ? "" : JSON.stringify(cell.v);
      const f = cell.f ? `  ⟵FORMULA: =${cell.f}` : "";
      cells.push(`${addr}=${val}${f}`);
    }
    if (cells.length) console.log(cells.join("   "));
  }
}
