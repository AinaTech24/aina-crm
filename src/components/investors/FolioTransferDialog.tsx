"use client";

/**
 * "Merge" for two selected clients: choose which folios (and so which schemes)
 * move from one profile to the other. Both directions are offered; the folio
 * lists come from GET /api/investors/folio-transfer and the move is a POST to
 * the same route. A folio is the unit that moves — a folio belongs to one
 * client — and its schemes are listed so you can see what travels with it.
 * To fold a whole duplicate record away, use Merge Clients (the link below).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { buttonClass } from "@/components/ui/button-class";
import { formatINR } from "@/lib/utils";
import type { TransferClient } from "@/lib/investors/folio-transfer";

export function FolioTransferDialog({
  open,
  onOpenChange,
  ids,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Exactly the two selected client ids. */
  ids: string[];
  onDone: (message: string) => void;
}) {
  const [clients, setClients] = useState<TransferClient[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [fromIdx, setFromIdx] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [moveHistory, setMoveHistory] = useState(true);
  const [allowPan, setAllowPan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || ids.length !== 2) return;
    setClients(null);
    setLoadErr(null);
    setErr(null);
    setFromIdx(0);
    setPicked(new Set());
    setMoveHistory(true);
    setAllowPan(false);
    fetch(`/api/investors/folio-transfer?ids=${ids.join(",")}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `Failed (${r.status})`);
        setClients(j.clients);
      })
      .catch((e) => setLoadErr(e.message ?? "Could not load the clients"));
  }, [open, ids.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const from = clients?.[fromIdx];
  const to = clients?.[1 - fromIdx];
  const panClash = !!from?.pan && !!to?.pan && from.pan !== to.pan;
  const chosen = useMemo(() => from?.folios.filter((f) => picked.has(f.id)) ?? [], [from, picked]);
  const totals = chosen.reduce(
    (t, f) => ({ aum: t.aum + f.aum, txns: t.txns + f.transactions, sips: t.sips + f.activeSips }),
    { aum: 0, txns: 0, sips: 0 },
  );

  function swap() {
    setFromIdx((i) => 1 - i);
    setPicked(new Set());
  }
  function toggle(id: string) {
    setPicked((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function apply() {
    if (!from || !to || !chosen.length) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/investors/folio-transfer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromId: from.id,
          toId: to.id,
          folioIds: chosen.map((f) => f.id),
          moveHistory,
          allowPanMismatch: panClash && allowPan ? true : undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Failed (${res.status})`);
        return;
      }
      onOpenChange(false);
      onDone(`Moved ${j.folios} folio${j.folios === 1 ? "" : "s"} from ${from.name} to ${to.name}.`);
    } catch (e: any) {
      setErr(e?.message ?? "Transfer failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Move folios between two profiles</DialogTitle>
          <DialogDescription>
            Tick the folios to move. A folio goes with all its schemes; its transactions and SIPs can go with it.
          </DialogDescription>
        </DialogHeader>

        {loadErr && <p className="text-sm text-destructive">{loadErr}</p>}
        {!clients && !loadErr && (
          <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        )}

        {from && to && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex-1 min-w-40">
                <div className="text-2xs uppercase text-muted-foreground">Move from</div>
                <div className="font-semibold">{from.name}</div>
                <div className="text-xs text-muted-foreground">{from.pan ?? "No PAN"}</div>
              </div>
              <button type="button" onClick={swap} className={buttonClass("secondary", "sm")} title="Swap direction">
                <ArrowRightLeft className="size-4" /> Swap
              </button>
              <div className="flex-1 min-w-40 text-right">
                <div className="text-2xs uppercase text-muted-foreground">Move to</div>
                <div className="font-semibold">{to.name}</div>
                <div className="text-xs text-muted-foreground">{to.pan ?? "No PAN"}</div>
              </div>
            </div>

            {from.folios.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center">{from.name} has no folios to move. Use Swap to go the other way.</p>
            ) : (
              <div className="border rounded-lg divide-y max-h-80 overflow-y-auto">
                {from.folios.map((f) => (
                  <label key={f.id} className="flex gap-3 p-3 cursor-pointer hover:bg-secondary/40">
                    <input type="checkbox" className="mt-1" checked={picked.has(f.id)} onChange={() => toggle(f.id)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">
                          {f.amcName} · <span className="font-mono text-xs">{f.folioNumber}</span>
                        </span>
                        <span className="tabular-nums font-semibold">{formatINR(f.aum)}</span>
                      </div>
                      <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
                        {f.schemes.length === 0 && <li>No scheme detail on this folio</li>}
                        {f.schemes.map((s, i) => (
                          <li key={i} className="flex justify-between gap-2">
                            <span className="truncate">{s.name}</span>
                            {s.value != null && <span className="tabular-nums">{formatINR(s.value)}</span>}
                          </li>
                        ))}
                      </ul>
                      <div className="text-2xs text-muted-foreground mt-1">
                        {f.transactions} transaction{f.transactions === 1 ? "" : "s"} · {f.activeSips} active SIP{f.activeSips === 1 ? "" : "s"}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}

            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={moveHistory} onChange={(e) => setMoveHistory(e.target.checked)} />
              <span>
                Move their transactions and SIPs too
                <span className="block text-xs text-muted-foreground">Leave this on unless the history belongs to {from.name}.</span>
              </span>
            </label>

            {panClash && (
              <label className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/5 p-2">
                <input type="checkbox" className="mt-1" checked={allowPan} onChange={(e) => setAllowPan(e.target.checked)} />
                <span>
                  These two have different PANs ({from.pan} and {to.pan}) — probably different people. I have checked and want to move the folios anyway.
                </span>
              </label>
            )}

            {chosen.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Moving {chosen.length} folio{chosen.length === 1 ? "" : "s"} worth {formatINR(totals.aum)}
                {moveHistory ? `, ${totals.txns} transactions and ${totals.sips} active SIPs` : ""} to {to.name}.
              </p>
            )}
            {err && <p className="text-sm text-destructive">{err}</p>}
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Link href="/dashboard/merge-clients" className="text-xs text-brand-cyan hover:underline self-center">
            Merge the whole record instead
          </Link>
          <div className="flex gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className={buttonClass("secondary")}>
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !chosen.length || (panClash && !allowPan)}
              onClick={apply}
              className={buttonClass("primary")}
            >
              {busy && <Loader2 className="size-4 animate-spin" />} Move {chosen.length || ""} folio{chosen.length === 1 ? "" : "s"}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
