"use client";

/**
 * Client-side "Download errors (CSV)" button for the RTA import detail page.
 * Builds a CSV (Row,Reason) from the row-level errors and triggers a browser
 * download via a Blob — no server round-trip. The body (PAN-masked, formula-safe)
 * comes from lib/rta/errors-csv.
 */
import { Download } from "lucide-react";
import { errorsToCsv } from "@/lib/rta/errors-csv";

export function DownloadErrorsButton({
  fileName,
  errors,
}: {
  fileName: string;
  errors: { row: number; reason: string }[];
}) {
  function download() {
    const csv = errorsToCsv(errors);

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}-errors.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <button onClick={download} className="btn-secondary text-xs">
      <Download className="size-3.5" /> Download errors (CSV)
    </button>
  );
}
