/**
 * RTA reverse-feed import page.
 *
 * Upload a Kfintech / CAMS mailback file to sync the client master (investors +
 * folios + holdings) into the CRM. Owners + ops/back-office only.
 */

import { Database, ShieldAlert, RefreshCw } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { RtaImporter } from "@/components/rta/RtaImporter";

export const dynamic = "force-dynamic";

const FILE_GUIDE: { rta: string; name: string; type: string; purpose: string }[] = [
  {
    rta: "Kfintech",
    name: "MFSD211_…  (.csv in a .zip)",
    type: "MFSD211 — Folio / Investor Master",
    purpose: "Clients, folios, KYC, nominees, bank — the people & accounts master.",
  },
  {
    rta: "Kfintech",
    name: "MFSD203_…  (.csv in a .zip)",
    type: "MFSD203 — Holdings / Valuation",
    purpose: "Current units, NAV and value per scheme → refreshes each client's AUM.",
  },
  {
    rta: "CAMS",
    name: "…R9.zip  (contains an .xls)",
    type: "CAMS — Folio statement (.xls)",
    purpose: "Clients + folios + holdings together — CAMS's combined master & valuation.",
  },
];

export default async function RtaImportPage() {
  const session = await requireSession();
  const allowed =
    can(session.roles, "investor.edit.all", session.permissions) ||
    can(session.roles, "dashboard.view.owner", session.permissions);

  if (!allowed) {
    return (
      <div className="card-surface p-12 text-center max-w-lg mx-auto">
        <ShieldAlert className="size-10 text-amber-500 mx-auto mb-3" />
        <div className="font-semibold text-lg">No access</div>
        <p className="text-sm text-muted-foreground mt-1">
          Importing the client master is restricted to owners and the operations team.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Database className="size-6 text-brand-cyan" /> RTA Import
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Sync your client book from the registrar feeds. Upload the daily Kfintech or CAMS mailback
          file (the password-protected <span className="font-mono text-xs">.zip</span> works directly —
          no need to unzip). Both registrars and three report types are supported.
        </p>
      </div>

      <RtaImporter />

      {/* ── Which file to upload ───────────────────────────────────────── */}
      <div className="card-surface p-4 space-y-3">
        <p className="font-semibold text-sm">Which file to upload — and what it does</p>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left font-medium py-1.5 pr-3">Registrar</th>
                <th className="text-left font-medium py-1.5 pr-3">File name looks like</th>
                <th className="text-left font-medium py-1.5 pr-3">Choose file type</th>
                <th className="text-left font-medium py-1.5">What it brings in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {FILE_GUIDE.map((f) => (
                <tr key={f.type}>
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">{f.rta}</td>
                  <td className="py-2 pr-3 font-mono text-[11px] whitespace-nowrap">{f.name}</td>
                  <td className="py-2 pr-3">{f.type}</td>
                  <td className="py-2 text-muted-foreground">{f.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Kfintech files are named by their report code (<span className="font-mono">MFSD211</span>,{" "}
          <span className="font-mono">MFSD203</span>). CAMS files have a long code ending in{" "}
          <span className="font-mono">…R9</span>. For a full picture from Kfintech, upload{" "}
          <strong>both</strong> MFSD211 (master) and MFSD203 (holdings); CAMS R9 carries both at once.
        </p>
      </div>

      {/* ── Step-by-step ───────────────────────────────────────────────── */}
      <div className="card-surface p-4 space-y-2">
        <p className="font-semibold text-sm">How to upload</p>
        <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal pl-4">
          <li>Download the daily mailback file from your Kfintech / CAMS portal (it arrives as a password-protected <span className="font-mono">.zip</span>).</li>
          <li><strong>Select RTA</strong> — Kfintech or CAMS.</li>
          <li><strong>Select file type</strong> — match it to the file using the table above.</li>
          <li><strong>Choose file</strong> — pick the <span className="font-mono">.zip</span> as-is (or the inner <span className="font-mono">.csv</span>/<span className="font-mono">.xls</span> if you already extracted it).</li>
          <li><strong>Enter the zip password</strong> — the one your registrar set for your mailback files (it's specific to your ARN; different report types can have different passwords).</li>
          <li><strong>Preview</strong> to check the counts (read-only), then <strong>Import</strong>.</li>
        </ol>
      </div>

      {/* ── Daily routine + dedup behavior ─────────────────────────────── */}
      <div className="card-surface p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="font-semibold text-foreground flex items-center gap-1.5">
          <RefreshCw className="size-3.5" /> Importing every day
        </p>
        <p>· Upload the same files each day — the importer <strong>updates existing</strong> clients &amp; folios in place and <strong>creates new ones</strong> only for genuinely new entries. It never duplicates.</p>
        <p>· Clients are matched by <strong>PAN</strong>; folios by <strong>AMC + folio number</strong>. The same person across CAMS and Kfintech stays one client.</p>
        <p>· <strong>Minors</strong> (no PAN of their own) become their own client linked to the guardian &amp; family — never merged into the guardian.</p>
        <p>· The feed fills contact / KYC / address / nominee / bank, and refreshes holdings &amp; AUM — but never overwrites your CRM-owned fields (RM, tags, risk profile, tier, notes).</p>
        <p>· Folios with <strong>no PAN</strong> are skipped and counted, so you can follow up. Always <strong>Preview</strong> first.</p>
      </div>
    </div>
  );
}
