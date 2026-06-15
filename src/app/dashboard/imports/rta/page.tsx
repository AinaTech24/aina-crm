/**
 * RTA reverse-feed import page.
 *
 * Upload a Kfintech / CAMS mailback file to sync the client master (investors +
 * folios) into the CRM. Owners + ops/back-office only.
 */

import { Database, ShieldAlert } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { RtaImporter } from "@/components/rta/RtaImporter";

export const dynamic = "force-dynamic";

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
          Sync your client master from the registrar feeds. Upload a Kfintech mailback file (the{" "}
          <span className="font-mono text-xs">MFSD211</span> folio-master report) — as the raw{" "}
          <span className="font-mono text-xs">.csv</span> or the password-protected{" "}
          <span className="font-mono text-xs">.zip</span>. CAMS support is being added.
        </p>
      </div>

      <RtaImporter />

      <div className="card-surface p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="font-semibold text-foreground">How the sync behaves</p>
        <p>· Investors are matched by <strong>PAN</strong>; folios by <strong>AMC + folio number</strong>. Re-importing updates in place — never duplicates.</p>
        <p>· The feed fills contact / KYC / address / nominee / bank details but never overwrites your CRM-owned fields (RM, tags, risk profile, AUM, tier, notes).</p>
        <p>· Rows without a PAN can't resolve an investor and are skipped (and counted).</p>
        <p>· Always <strong>Preview</strong> first — it parses and counts without writing anything.</p>
      </div>
    </div>
  );
}
