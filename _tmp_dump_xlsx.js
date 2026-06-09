const XLSX = require("xlsx");
const fs = require("fs");
const path = "C:/Users/PRITESH THAKOR/Downloads/MIS Templat 230326.xlsx";
const wb = XLSX.readFile(path, { cellFormula: true, cellNF: false });
const ws = wb.Sheets[wb.SheetNames[0]];
const range = XLSX.utils.decode_range(ws["!ref"]);
let out = [];
out.push("RANGE: " + ws["!ref"]);
let formulaCount = 0;
for (let r = range.s.r; r <= range.e.r; r++) {
  const cells = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r, c });
    const cell = ws[addr];
    if (!cell) continue;
    const col = XLSX.utils.encode_col(c);
    let v = cell.v;
    if (typeof v === "string") v = v.replace(/\s+/g," ").trim();
    if (v === "" || v === undefined) continue;
    if (cell.f) { cells.push(col+"["+cell.f+"="+v+"]"); formulaCount++; }
    else cells.push(col+":"+v);
  }
  if (cells.length) out.push((r+1) + " | " + cells.join("  "));
}
out.push("\nTOTAL FORMULAS: " + formulaCount);
fs.writeFileSync("./_tmp_mis_dump.txt", out.join("\n"));
console.log("rows written, formulas=" + formulaCount + ", lines=" + out.length);
