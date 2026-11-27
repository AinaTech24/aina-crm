"use client";

/**
 * The Excel import screen of Tasks, Meetings and Service requests (lib/imports/sheet).
 *
 *   1  Download the sample sheet, fill its Data sheet, upload it.
 *   2  The file is CHECKED, row by row, before anything is saved: how many rows are
 *      ready, and for every other row its number, the column and what is wrong.
 *   3  Import saves the rows that passed; the rest are listed again to correct.
 *
 * The same file goes to the server for the check and for the import, so nothing
 * is held between the two.
 */

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, ChevronLeft, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
import type { ImportReport } from "@/lib/imports/sheet/run";

export type ColumnSummary = { header: string; required: boolean; help: string; /** The allowed values, or the format. */ allowed: string };

export function SheetImport({
  label, singular, backHref, importUrl, sampleUrl, sampleCsvUrl, columns, notes, maxRows,
}: {
  /** "Tasks" */
  label: string;
  /** "task" */
  singular: string;
  backHref: string;
  importUrl: string;
  sampleUrl: string;
  /** A module that also offers its sample as CSV. */
  sampleCsvUrl?: string;
  columns: ColumnSummary[];
  /** Rules that are not about one column. */
  notes: string[];
  maxRows: number;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState<"check" | "import" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function send(f: File, mode: "check" | "import") {
    setBusy(mode);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(`${importUrl}?mode=${mode}`, { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? `The import failed (HTTP ${res.status})`); return; }
      setReport(j as ImportReport);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The import failed");
    } finally {
      setBusy(null);
    }
  }

  function choose(f: File | null | undefined) {
    if (!f) return;
    setFile(f);
    setReport(null);
    void send(f, "check");
  }
  function reset() {
    setFile(null);
    setReport(null);
    setErr(null);
    if (input.current) input.current.value = "";
  }

  const done = report?.mode === "import";
  const blocked = !!report && report.missing.length > 0;
  const ready = report?.valid ?? 0;

  return (
    <div className="max-w-4xl space-y-5">
      <Link href={backHref} className="flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ChevronLeft className="size-4" /> Back to {label.toLowerCase()}
      </Link>
      <div>
        <h1 className="page-title">Import {label.toLowerCase()} from Excel</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Download the sample sheet, fill in its Data sheet and upload it as an Excel (.xlsx) or CSV (.csv) file. Up to {maxRows.toLocaleString("en-IN")} rows and 5 MB at a time. Every row is checked before anything is saved.
        </p>
      </div>

      {/* 1 — sample and columns */}
      <div className="card-surface space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-medium">Sample sheet</div>
            <p className="text-sm text-muted-foreground">
              Has every column on its Data sheet, with dropdowns for the choice columns, and an Example sheet to copy from.
              {sampleCsvUrl && " The CSV sample has the same columns with example rows: replace them with your own."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href={sampleUrl} download className={buttonClass("secondary")}>
              <Download className="size-4" /> {sampleCsvUrl ? "Sample Excel (.xlsx)" : "Download sample sheet"}
            </a>
            {sampleCsvUrl && (
              <a href={sampleCsvUrl} download className={buttonClass("secondary")}>
                <Download className="size-4" /> Sample CSV (.csv)
              </a>
            )}
          </div>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer select-none text-primary">The {columns.length} columns ({columns.filter((c) => c.required).length} required)</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr><th className="py-1.5 pr-3 font-medium">Column</th><th className="py-1.5 pr-3 font-medium">Required</th><th className="py-1.5 pr-3 font-medium">What to enter</th><th className="py-1.5 font-medium">Allowed values</th></tr>
              </thead>
              <tbody>
                {columns.map((c) => (
                  <tr key={c.header} className="border-b last:border-0 align-top">
                    <td className="whitespace-nowrap py-1.5 pr-3 font-medium">{c.header}</td>
                    <td className="py-1.5 pr-3">{c.required ? <span className="font-medium text-rose-700">Yes</span> : <span className="text-muted-foreground">No</span>}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{c.help}</td>
                    <td className="py-1.5 text-muted-foreground">{c.allowed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <details className="text-sm">
          <summary className="cursor-pointer select-none text-primary">Good to know</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {notes.map((n) => <li key={n}>{n}</li>)}
            <li>Using a CSV? Save the Data sheet as “CSV UTF-8” and write dates as 24-11-2026, so a regional date setting cannot swap day and month.</li>
          </ul>
        </details>
      </div>

      {/* 2 — upload */}
      {!done && (
        <div className="rounded-lg border-2 border-dashed p-8 text-center">
          <FileSpreadsheet className="mx-auto size-10 text-muted-foreground" />
          <div className="mt-2 text-sm">{file ? <b>{file.name}</b> : "Choose your filled sheet (.xlsx or .csv)"}</div>
          <label className="mt-4 inline-block">
            <span className={`${buttonClass("primary")} cursor-pointer`}>
              {busy === "check" ? <><Loader2 className="size-4 animate-spin" /> Checking…</> : file ? "Choose another file" : "Choose file"}
            </span>
            <input
              ref={input}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              disabled={busy !== null}
              onChange={(e) => choose(e.target.files?.[0])}
            />
          </label>
        </div>
      )}

      {err && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> <span>{err}</span>
        </div>
      )}

      {/* 3 — the check, then the result */}
      {report && (
        <div className="card-surface space-y-4 p-5">
          {blocked ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">
              <b>These required columns are missing from your sheet:</b> {report.missing.join(", ")}.
              Add them (the sample sheet has them) and upload the file again.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <Tile label={done ? "Rows in file" : "Rows found"} value={report.total} />
                <Tile label={done ? "Imported" : "Ready to import"} value={done ? report.imported ?? 0 : ready} tone="emerald" />
                <Tile label={done ? "Not imported" : "Need fixing"} value={done ? report.total - (report.imported ?? 0) : report.invalid} tone={report.invalid ? "rose" : "muted"} />
              </div>
              {report.problems.length > 0 && (
                <div>
                  <div className="mb-1.5 text-sm font-medium">
                    {done ? "Rows that were not imported" : "Rows with problems — they will be skipped unless you fix them in your file"}
                  </div>
                  <div className="max-h-80 overflow-y-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 border-b bg-secondary text-left text-xs text-muted-foreground">
                        <tr><th className="px-3 py-1.5 font-medium">Row</th><th className="px-3 py-1.5 font-medium">Column</th><th className="px-3 py-1.5 font-medium">Problem</th></tr>
                      </thead>
                      <tbody>
                        {report.problems.map((p, i) => (
                          <tr key={i} className="border-b align-top last:border-0">
                            <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{p.row}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 font-medium">{p.column}</td>
                            <td className="px-3 py-1.5 text-rose-800">{p.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {report.moreProblems && <p className="mt-1 text-xs text-muted-foreground">Only the first {report.problems.length} problems are listed.</p>}
                </div>
              )}
            </>
          )}

          {report.ignored.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Not recognised, so ignored: {report.ignored.join(", ")}.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
            {done ? (
              <>
                <button type="button" onClick={reset} className={buttonClass("secondary")}>Import another file</button>
                <Link href={backHref} className={buttonClass("primary")}><Check className="size-4" /> View {label.toLowerCase()}</Link>
              </>
            ) : (
              <>
                <button type="button" onClick={reset} className={buttonClass("secondary")} disabled={busy !== null}>Choose another file</button>
                {!blocked && (
                  <button
                    type="button"
                    className={buttonClass("primary")}
                    disabled={busy !== null || ready === 0}
                    onClick={() => file && send(file, "import")}
                    title={ready === 0 ? "No row is ready to import" : undefined}
                  >
                    {busy === "import" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                    {busy === "import"
                      ? "Importing…"
                      : report.invalid > 0
                        ? `Import ${ready} valid ${ready === 1 ? singular : `${singular}s`} (skip ${report.invalid})`
                        : `Import ${ready} ${ready === 1 ? singular : `${singular}s`}`}
                  </button>
                )}
              </>
            )}
          </div>
          {!done && !blocked && (
            <p className="text-xs text-muted-foreground">Importing the same file twice adds its rows twice.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, tone = "muted" }: { label: string; value: number; tone?: "emerald" | "rose" | "muted" }) {
  const color = tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : "text-foreground";
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value.toLocaleString("en-IN")}</div>
    </div>
  );
}
