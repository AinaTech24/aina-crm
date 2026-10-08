"use client";

/**
 * Registrar scheme codes → the Scheme Master (Phase 3H). Confirming picks the
 * AMFI scheme from the AMFI list; the server refuses a scheme the registrar's
 * own ISIN contradicts and records the reason in the audit log.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2 } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Field } from "@/components/ui/Field";
import { notify } from "@/components/ui/Toast";
import { SchemeAutocomplete, type SchemePick } from "@/components/mf/SchemeAutocomplete";
import type { SchemeCodeRow } from "@/lib/rta/scheme-resolution";

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  resolved_isin: { label: "Resolved by ISIN", tone: "success" },
  confirmed: { label: "Confirmed", tone: "success" },
  unresolved: { label: "Needs a decision", tone: "warning" },
  conflict: { label: "Conflict", tone: "danger" },
};

export function SchemeCodesTable({ rows, canConfirm }: { rows: SchemeCodeRow[]; canConfirm: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const columns: Column<SchemeCodeRow>[] = [
    { key: "code", header: "Registrar code", cell: (r) => <span className="tabular-nums">{r.rta === "kfintech" ? "KFintech" : "CAMS"} · {r.rtaAmcCode} · {r.rtaSchemeCode}</span> },
    { key: "name", header: "As the registrar describes it", className: "!whitespace-normal", cell: (r) => <span className="text-xs">{r.observedName ?? "—"}</span>, hideOnMobile: true },
    { key: "isin", header: "ISIN printed", cell: (r) => (r.observedIsins.length ? <span className="tabular-nums text-xs">{r.observedIsins.join(", ")}</span> : <span className="text-muted-foreground">None</span>), hideOnMobile: true },
    { key: "status", header: "Status", cell: (r) => <Badge tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</Badge> },
    {
      key: "scheme", header: "Scheme Master", className: "!whitespace-normal", width: "30%",
      cell: (r) => (
        <div className="text-xs">
          {r.amfiName ? <div className="font-medium text-foreground">{r.amfiName} <span className="text-muted-foreground tabular-nums">· AMFI {r.amfiSchemeCode}</span></div> : null}
          {r.reason ? <div className="text-muted-foreground">{r.reason}</div> : null}
          {open === r.id ? <ConfirmForm row={r} onDone={() => setOpen(null)} /> : null}
        </div>
      ),
    },
    { key: "held", header: "Held", align: "right", cell: (r) => (r.heldTransactions ? <span className="tabular-nums">{r.heldTransactions}</span> : <span className="text-muted-foreground">0</span>) },
    {
      key: "act", header: <span className="sr-only">Action</span>, className: "relative",
      cell: (r) => (r.status === "resolved_isin" || !canConfirm ? null : (
        <Button size="sm" variant="secondary" onClick={() => setOpen(open === r.id ? null : r.id)}>
          <Link2 className="size-4" /> {r.status === "confirmed" ? "Change" : "Link"}
        </Button>
      )),
    },
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption="Registrar scheme codes and their Scheme Master link"
    empty={<p className="py-6 text-center text-sm text-muted-foreground">No registrar scheme codes yet — they appear once an RTA file is imported validate-first.</p>} />;
}

function ConfirmForm({ row, onDone }: { row: SchemeCodeRow; onDone: () => void }) {
  const router = useRouter();
  const [pick, setPick] = useState<SchemePick | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/rta-staging/schemes/${row.id}/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amfiSchemeCode: pick.schemeCode, note }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { notify.error(body.error ?? "Could not link the scheme"); return; }
      notify.success(body.pending ?? `Linked. ${body.reevaluation?.promoted ?? 0} held transaction(s) posted.`);
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-secondary/60 p-2">
      <Field label="AMFI scheme">
        {(id, describedBy) => <SchemeAutocomplete id={id} aria-describedby={describedBy} source="universe" size="sm" onSelect={setPick} onClear={() => setPick(null)} placeholder="Search the AMFI list…" />}
      </Field>
      <Field label="Why this is the scheme">
        {(id, describedBy) => <textarea id={id} aria-describedby={describedBy} className="input w-full text-xs" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. AMC code list checked; plan and option match" />}
      </Field>
      <Button size="sm" variant="primary" disabled={!pick || note.trim().length < 10 || busy} onClick={submit}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : null} Link to this scheme
      </Button>
    </div>
  );
}
