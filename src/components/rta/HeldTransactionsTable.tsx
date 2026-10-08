"use client";

/**
 * The validate-first exception list (Phase 3F): what the import refused to
 * post and why. An ownership hold can be settled here by choosing the client
 * — the server re-checks every rule (guardian, Karta, folio under another
 * client, PAN) and records the decision in the audit log.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, UserCheck } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { notify } from "@/components/ui/Toast";
import { formatDate, formatMoney, humanise } from "@/lib/format";
import type { HeldTransaction } from "@/lib/rta/posting/held";

const OUTCOME_LABEL: Record<string, string> = {
  quarantined: "Held for review",
  unsupported: "Not supported",
  correction_held: "Correction held",
  held_dependent: "Waiting on its folio",
  blocked: "Blocked (whole file)",
};

export function HeldTransactionsTable({ rows, canResolve, resolveDisabledReason }: { rows: HeldTransaction[]; canResolve: boolean; resolveDisabledReason: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const columns: Column<HeldTransaction>[] = [
    { key: "date", header: "Trade date", cell: (r) => (r.tradeDate ? formatDate(r.tradeDate) : "—") },
    { key: "folio", header: "Folio", cell: (r) => <span className="tabular-nums">{r.rta === "kfintech" ? "KFintech" : "CAMS"} · {r.folio}</span> },
    { key: "class", header: "Transaction", cell: (r) => <>{humanise(r.rtaClass)}{r.lots > 1 ? <span className="text-muted-foreground"> · {r.lots} lots</span> : null}</>, hideOnMobile: true },
    { key: "amount", header: "Amount (as reported)", align: "right", cell: (r) => (r.amount == null ? "—" : formatMoney(r.amount)) },
    { key: "outcome", header: "Status", cell: (r) => <Badge tone={r.outcome === "quarantined" || r.outcome === "blocked" ? "warning" : "neutral"}>{OUTCOME_LABEL[r.outcome] ?? r.outcome}</Badge> },
    {
      key: "why", header: "Why", className: "!whitespace-normal", width: "38%",
      cell: (r) => (
        <div className="max-w-xl">
          <div className="text-xs font-medium text-foreground">{humanise(r.heldFor)}</div>
          <div className="text-xs text-muted-foreground">{r.reason}</div>
          {open === r.id && <ResolveForm row={r} onDone={() => setOpen(null)} />}
        </div>
      ),
    },
    {
      key: "action", header: <span className="sr-only">Action</span>, align: "right",
      cell: (r) => r.resolvable
        ? <Button size="sm" variant="secondary" icon={<UserCheck className="size-3.5" />} disabled={!canResolve} title={canResolve ? undefined : resolveDisabledReason ?? undefined} onClick={() => setOpen(open === r.id ? null : r.id)}>Choose client</Button>
        : null,
      hideWhenEmpty: true,
    },
  ];
  return <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} caption="Registrar transactions the import held back" empty={<p className="py-6 text-center text-sm text-muted-foreground">Nothing is held — every validated transaction was posted.</p>} />;
}

function ResolveForm({ row, onDone }: { row: HeldTransaction; onDone: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string }>>([]);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const reqId = useRef(0);

  function search(v: string) {
    setQ(v); setPicked(null);
    const query = v.trim();
    if (query.length < 2) { setResults([]); return; }
    const id = ++reqId.current; setSearching(true);
    setTimeout(async () => {
      try {
        const j = await fetch(`/api/investors?q=${encodeURIComponent(query)}&limit=8`).then((r) => r.json()).catch(() => ({}));
        const list = (j.investors ?? j.rows ?? j.data ?? []) as Array<{ id: string; name: string }>;
        if (id === reqId.current) setResults(list.map((x) => ({ id: x.id, name: x.name })));
      } finally {
        if (id === reqId.current) setSearching(false);
      }
    }, 200);
  }

  async function submit() {
    if (!picked) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/rta-staging/economic/${row.id}/resolve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ investorId: picked.id, note }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { notify.error(j.error ?? "Could not resolve"); return; }
      notify.success(`Posted to ${picked.name}`);
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg bg-secondary/60 p-3" data-testid="resolve-form">
      <label className="block text-xs font-medium text-muted-foreground">
        Client this transaction belongs to
        <div className="relative mt-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input value={picked ? picked.name : q} onChange={(e) => search(e.target.value)} placeholder="Search clients…"
            className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm" />
          {searching && <Loader2 className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
        </div>
      </label>
      {!picked && results.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-md border border-border bg-card p-1">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" className="w-full rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-secondary" onClick={() => { setPicked(r); setResults([]); }}>{r.name}</button>
            </li>
          ))}
        </ul>
      )}
      <label className="block text-xs font-medium text-muted-foreground">
        Why (kept in the audit log)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-border bg-card p-2 text-sm" placeholder="e.g. checked against the application form" />
      </label>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button size="sm" variant="primary" loading={busy} disabled={!picked || note.trim().length < 5} onClick={submit}>Post to this client</Button>
      </div>
    </div>
  );
}
