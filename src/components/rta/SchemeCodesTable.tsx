"use client";

/**
 * Registrar scheme codes → the Scheme Master (Phase 3H; review workflow
 * Phase 3I). A code that needs a decision opens a review panel: the
 * registrar's own evidence, the candidates (a platform mapping and ISIN
 * matches are evidence; a name match is only a suggestion to check against a
 * document), and three decisions — approve with the evidence cited, reject a
 * candidate, or defer. The server re-checks every approval against the
 * registrar's ISIN, the platform mappings, the registrar AMC's identity and
 * explicit plan / option words, and audits each decision.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Link2, Loader2, X } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { notify } from "@/components/ui/Toast";
import { promptDialog } from "@/components/ui/ConfirmProvider";
import { SchemeAutocomplete, type SchemePick } from "@/components/mf/SchemeAutocomplete";
import { formatDate } from "@/lib/format";
import type { SchemeCodeRow, SchemeCandidate } from "@/lib/rta/scheme-resolution";

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  resolved_isin: { label: "Resolved by ISIN", tone: "success" },
  confirmed: { label: "Confirmed", tone: "success" },
  unresolved: { label: "Needs a decision", tone: "warning" },
  conflict: { label: "Conflict", tone: "danger" },
};

/** Plain words for each reason code (scheme-evidence.ts). */
const REASON: Record<string, string> = {
  isin_verified: "Registrar ISIN → one AMFI scheme",
  isin_verified_historical: "Registrar ISIN → a scheme with a historical AMFI NAV (closed / matured)",
  global_isin: "Verified by ISIN on the platform",
  platform_approved: "Approved by two platform operators",
  firm_confirmed: "Confirmed by your firm",
  no_isin: "No ISIN printed",
  isin_not_in_feed: "ISIN not in the AMFI feed",
  isin_unpriced: "AMFI lists the ISIN without a NAV",
  isins_differ: "Different ISINs for one code",
  isin_ambiguous: "ISIN on more than one AMFI scheme",
  amc_mismatch: "AMC does not match",
  plan_option_mismatch: "Plan / option contradicts",
  confirm_contradicts_isin: "Confirmation contradicts the ISIN",
  confirm_not_in_feed: "Confirmed scheme not in the AMFI feed",
  global_conflict: "Contradicts the platform mapping",
  confirm_contradicts_global: "Confirmation contradicts the platform mapping",
};

const EVIDENCE: Array<[string, string]> = [
  ["amc_scheme_list", "The AMC's own scheme / plan list"],
  ["registrar_statement", "A registrar statement or confirmation"],
  ["account_statement", "The client's account statement (CAS) with the ISIN"],
  ["amc_factsheet", "The AMC's factsheet or SID"],
  ["other_document", "Another document (say which in the note)"],
];

export function SchemeCodesTable({ rows, canConfirm }: { rows: SchemeCodeRow[]; canConfirm: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const columns: Column<SchemeCodeRow>[] = [
    { key: "code", header: "Registrar code", cell: (r) => <span className="tabular-nums">{r.rta === "kfintech" ? "KFintech" : "CAMS"} · {r.rtaAmcCode} · {r.rtaSchemeCode}</span> },
    { key: "name", header: "As the registrar describes it", className: "!whitespace-normal", cell: (r) => <span className="text-xs">{r.observedName ?? "—"}</span>, hideOnMobile: true },
    { key: "isin", header: "ISIN printed", cell: (r) => (r.observedIsins.length ? <span className="tabular-nums text-xs">{r.observedIsins.join(", ")}</span> : <span className="text-muted-foreground">None</span>), hideOnMobile: true },
    {
      key: "status", header: "Status",
      cell: (r) => (
        <div className="space-y-1">
          <Badge tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</Badge>
          {r.reviewState === "deferred" ? <div><Badge tone="neutral"><Clock className="size-3" /> Deferred</Badge></div> : null}
        </div>
      ),
    },
    {
      key: "scheme", header: "Scheme Master", className: "!whitespace-normal", width: "34%",
      cell: (r) => (
        <div className="text-xs">
          {r.amfiName ? (
            <div className="font-medium text-foreground">
              {r.amfiName} <span className="text-muted-foreground tabular-nums">· AMFI {r.amfiSchemeCode}</span>
              {r.amfiActive === false ? <span className="ml-1 text-warning">· AMFI NAV historical{r.amfiNavDate ? ` (${formatDate(r.amfiNavDate)})` : ""}</span> : null}
            </div>
          ) : null}
          {r.reasonCode ? <div className="text-muted-foreground">{REASON[r.reasonCode] ?? r.reasonCode}{r.reason && r.status === "conflict" ? ` — ${r.reason}` : ""}</div> : r.reason ? <div className="text-muted-foreground">{r.reason}</div> : null}
          {r.reviewState === "deferred" && r.reviewNote ? <div className="text-muted-foreground">Awaiting: {r.reviewNote}</div> : null}
          {r.status === "confirmed" && r.confirmNote ? <div className="text-muted-foreground">Evidence: {r.confirmNote}</div> : null}
        </div>
      ),
    },
    { key: "held", header: "Held", align: "right", cell: (r) => (r.heldTransactions ? <span className="tabular-nums">{r.heldTransactions}</span> : <span className="text-muted-foreground">0</span>) },
    {
      key: "act", header: <span className="sr-only">Action</span>, className: "relative",
      cell: (r) => (r.status === "resolved_isin" || !canConfirm ? null : (
        <Button size="sm" variant="secondary" onClick={() => { setOpen(open === r.id ? null : r.id); if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" }); }} aria-expanded={open === r.id}>
          <Link2 className="size-4" /> {r.status === "confirmed" ? "Change" : "Review"}
        </Button>
      )),
    },
  ];
  const reviewing = open ? rows.find((r) => r.id === open) ?? null : null;
  return (
    <div className="space-y-4">
      {reviewing ? (
        <Card>
          <CardHeader
            title={<span className="tabular-nums">Review {reviewing.rta === "kfintech" ? "KFintech" : "CAMS"} · {reviewing.rtaAmcCode} · {reviewing.rtaSchemeCode}</span>}
            subtitle={<>{reviewing.observedName ?? "No description printed"}{reviewing.observedIsins.length ? ` · ISIN ${reviewing.observedIsins.join(", ")}` : " · no ISIN printed"}{reviewing.heldTransactions ? ` · ${reviewing.heldTransactions} transaction(s) held` : ""}</>}
            action={<Button size="sm" variant="ghost" onClick={() => setOpen(null)} aria-label="Close the review"><X className="size-4" /></Button>}
          />
          <div className="px-5 pb-5"><ReviewPanel key={reviewing.id} row={reviewing} onDone={() => setOpen(null)} /></div>
        </Card>
      ) : null}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption="Registrar scheme codes and their Scheme Master link"
        empty={<p className="py-6 text-center text-sm text-muted-foreground">No registrar scheme codes yet — they appear once an RTA file is imported validate-first.</p>} />
    </div>
  );
}

type Candidates = { registrarAmc: string[]; amcEstablished: boolean; candidates: SchemeCandidate[] };

function ReviewPanel({ row, onDone }: { row: SchemeCodeRow; onDone: () => void }) {
  const router = useRouter();
  const [cands, setCands] = useState<Candidates | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pick, setPick] = useState<{ code: string; name: string } | null>(null);
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/rta-staging/schemes/${row.id}/candidates`).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!live) return;
      if (!res.ok) setLoadError(body.error ?? "Could not load candidates");
      else setCands(body);
    }).catch(() => live && setLoadError("Could not load candidates"));
    return () => { live = false; };
  }, [row.id]);

  const post = async (path: string, body: unknown) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/rta-staging/schemes/${row.id}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { notify.error(out.error ?? "Not saved"); return null; }
      return out;
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!pick) return;
    const out = await post("confirm", { amfiSchemeCode: pick.code, note, evidenceSource: source });
    if (!out) return;
    const warn = (out.decision?.warnings ?? []) as string[];
    notify.success(out.pending ?? `Linked. ${out.reevaluation?.promoted ?? 0} held transaction(s) posted.${warn.length ? ` Note: ${warn.join("; ")}.` : ""}`);
    onDone();
    router.refresh();
  };
  const reject = async (c: SchemeCandidate) => {
    const why = await promptDialog({ title: `Not ${c.name ?? c.amfiSchemeCode}?`, message: "It will not be proposed for this code again.", label: "Why it is not this scheme", multiline: true, maxLength: 500 });
    if (!why || why.trim().length < 10) { if (why !== null) notify.error("Say why in at least 10 characters"); return; }
    if (await post("review", { action: "reject_candidate", amfiSchemeCode: c.amfiSchemeCode, note: why })) {
      setCands((s) => (s ? { ...s, candidates: s.candidates.filter((x) => x.amfiSchemeCode !== c.amfiSchemeCode) } : s));
      if (pick?.code === c.amfiSchemeCode) setPick(null);
      router.refresh();
    }
  };
  const defer = async () => {
    if (row.reviewState === "deferred") {
      if (await post("review", { action: "undefer", note: "" })) { onDone(); router.refresh(); }
      return;
    }
    const why = await promptDialog({ title: "Defer this code", message: "Its transactions stay held until it is decided.", label: "What are you waiting for?", multiline: true, maxLength: 500 });
    if (!why || why.trim().length < 10) { if (why !== null) notify.error("Say what is awaited in at least 10 characters"); return; }
    if (await post("review", { action: "defer", note: why })) { onDone(); router.refresh(); }
  };

  return (
    <div className="space-y-3 text-xs">
      <div className="text-xs text-muted-foreground">
        Registrar AMC {cands ? (cands.amcEstablished ? <>is <span className="text-foreground">{cands.registrarAmc[0]}</span> (from its other codes)</> : cands.registrarAmc.length > 1 ? <span className="text-destructive">points to {cands.registrarAmc.join(" and ")}</span> : "is not established yet — check the AMC on your document") : "…"}
      </div>
      {loadError ? <p className="text-xs text-destructive">{loadError}</p> : null}
      {!cands && !loadError ? <p className="text-xs text-muted-foreground"><Loader2 className="inline size-3 animate-spin" /> Loading candidates…</p> : null}
      {cands && cands.candidates.length ? (
        <ul className="space-y-2">
          {cands.candidates.map((c) => (
            <li key={c.amfiSchemeCode} className={`rounded-md bg-background p-2 ${pick?.code === c.amfiSchemeCode ? "ring-2 ring-primary" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-foreground">{c.name} <span className="text-muted-foreground tabular-nums">· AMFI {c.amfiSchemeCode}</span></div>
                  <div className="text-muted-foreground">
                    {c.amc ?? "AMC not stated"}{c.plan ? ` · ${c.plan}` : ""}{c.option ? ` · ${c.option}` : ""}
                    {c.navDate ? ` · NAV ${formatDate(c.navDate)}` : ""}{c.isins.length ? ` · ${c.isins.join(", ")}` : ""}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge tone={c.basis === "name" ? "neutral" : "success"}>{c.basis === "platform" ? "Platform mapping" : c.basis === "isin" ? "Same ISIN" : "Name suggestion — check a document"}</Badge>
                    {c.warnings.map((w) => <Badge key={w} tone="warning">{w}</Badge>)}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setPick({ code: c.amfiSchemeCode, name: c.name ?? c.amfiSchemeCode })}>Choose</Button>
                  <Button size="sm" variant="ghost" aria-label={`Not ${c.name ?? c.amfiSchemeCode}`} onClick={() => reject(c)} disabled={busy}><X className="size-4" /></Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : cands ? <p className="text-xs text-muted-foreground">No candidate from the evidence. Search the AMFI list below.</p> : null}

      <Field label="Or search the AMFI list">
        {(id, describedBy) => <SchemeAutocomplete id={id} aria-describedby={describedBy} source="universe" size="sm"
          onSelect={(p: SchemePick) => setPick({ code: p.schemeCode, name: p.schemeName })} onClear={() => setPick(null)} placeholder="Search the AMFI list…" />}
      </Field>
      {pick ? <p className="text-xs">Approving: <span className="font-medium text-foreground">{pick.name}</span> <span className="tabular-nums text-muted-foreground">· AMFI {pick.code}</span></p> : null}
      <Field label="Evidence">
        {(id, describedBy) => (
          <select id={id} aria-describedby={describedBy} className="input w-full text-xs" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Choose where it comes from…</option>
            {EVIDENCE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
      </Field>
      <Field label="Why this is the scheme">
        {(id, describedBy) => <textarea id={id} aria-describedby={describedBy} className="input w-full text-xs" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. AMC scheme list dated …: same plan and option, ISIN …" />}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={!pick || !source || note.trim().length < 10 || busy} onClick={approve}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Approve this scheme
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={defer}>
          <Clock className="size-4" /> {row.reviewState === "deferred" ? "Take back the deferral" : "Defer"}
        </Button>
      </div>
    </div>
  );
}
