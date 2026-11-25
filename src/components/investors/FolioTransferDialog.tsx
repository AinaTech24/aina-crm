"use client";

/**
 * "Merge" for two selected clients: choose which folios (and so which schemes)
 * move from one profile to the other. Both directions are offered; the folio
 * lists come from GET /api/investors/folio-transfer and the move is a POST to
 * the same route. A folio is the unit that moves — a folio belongs to one
 * client — and its schemes are listed so you can see what travels with it.
 * To fold a whole duplicate record away, "Merge the whole record instead" opens the
 * same Compare and merge dialog Find Duplicates uses, with a value choice per field.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { buttonClass } from "@/components/ui/button-class";
import { FieldChooser, MergeCompareDialog, type MergePreviewField, type Member } from "@/components/investors/DuplicateMerge";
import { formatINR } from "@/lib/utils";
import type { TransferClient } from "@/lib/investors/folio-transfer";

export function FolioTransferDialog({
  open,
  onOpenChange,
  ids,
  onDone,
  onMerged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Exactly the two selected client ids. */
  ids: string[];
  onDone: (message: string) => void;
  /** A whole-record merge finished (the dialog has already said so): clear the selection, refresh. */
  onMerged?: () => void;
}) {
  const [mergeOpen, setMergeOpen] = useState(false);
  const [clients, setClients] = useState<TransferClient[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [fromIdx, setFromIdx] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [moveHistory, setMoveHistory] = useState(true);
  const [allowPan, setAllowPan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** Every client field with both profiles' values (the same list the whole-record merge shows). */
  const [fields, setFields] = useState<MergePreviewField[] | null>(null);
  /** field → the profile whose value the receiving profile ends up with. Absent = the receiver keeps its own. */
  const [picks, setPicks] = useState<Record<string, string>>({});

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

  // The field values of the two profiles, for the "which value should be kept" table. The receiving
  // profile is the one "kept", so ask the merge preview with it as the survivor.
  const fromId = from?.id;
  const toId = to?.id;
  useEffect(() => {
    setPicks({});
    setFields(null);
    if (!open || !fromId || !toId) return;
    let live = true;
    fetch("/api/investors/merge/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ survivorId: toId, loserIds: [fromId] }),
    })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((j) => { if (live) setFields(j?.fields ?? null); })
      .catch(() => { if (live) setFields(null); });
    return () => { live = false; };
  }, [open, fromId, toId]);

  const hasValue = (f: MergePreviewField, id: string) => !!f.values.find((v) => v.id === id)?.value;
  /** Without a pick the receiving profile keeps its own value; a blank stays blank unless the other's is picked. */
  const pickedFor = (f: MergePreviewField) => picks[f.field] ?? (toId && hasValue(f, toId) ? toId : null);
  const takenFromOther = fields && fromId ? fields.filter((f) => pickedFor(f) === fromId) : [];
  function selectAllFrom(id: string) {
    const next: Record<string, string> = {};
    for (const f of fields ?? []) if (hasValue(f, id)) next[f.field] = id;
    setPicks(next);
  }
  const allFrom = (id: string) =>
    !!fields && fields.some((f) => hasValue(f, id)) && fields.every((f) => !hasValue(f, id) || pickedFor(f) === id);
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
    if (!from || !to || (!chosen.length && !takenFromOther.length)) return;
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
          fieldPicks: takenFromOther.length ? takenFromOther.map((f) => f.field) : undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Failed (${res.status})`);
        return;
      }
      onOpenChange(false);
      const took = takenFromOther.length ? ` ${takenFromOther.length} field value${takenFromOther.length === 1 ? "" : "s"} taken from ${from.name}.` : "";
      onDone(j.folios > 0 ? `Moved ${j.folios} folio${j.folios === 1 ? "" : "s"} from ${from.name} to ${to.name}.${took}` : `${to.name} now holds ${takenFromOther.length} field value${takenFromOther.length === 1 ? "" : "s"} taken from ${from.name}.`);
    } catch (e: any) {
      setErr(e?.message ?? "Transfer failed");
    } finally {
      setBusy(false);
    }
  }

  // The two clients as the whole-record merge dialog wants them (it draws name, PAN, RM, book size).
  const mergeMembers: Member[] = (clients ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    pan: c.pan,
    phone: null,
    email: null,
    aum: c.folios.reduce((t, f) => t + f.aum, 0),
    folios: c.folios.length,
    rm_name: c.rmName,
  }));

  return (
    <>
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

            {/* Which value each field keeps — the same choice the whole-record merge offers. */}
            {fields && fields.length > 0 && (
              <fieldset>
                <legend className="text-xs font-semibold">Which value should the merged record keep?</legend>
                <FieldChooser
                  fields={fields}
                  cols={[{ id: to.id, name: to.name }, { id: from.id, name: from.name }]}
                  keptId={to.id}
                  chosen={pickedFor}
                  onPick={(field, id) => setPicks((p) => ({ ...p, [field]: id }))}
                  onSelectAll={selectAllFrom}
                  allFrom={allFrom}
                  busy={busy}
                  maxHeightClass="max-h-72"
                  colLabel={(m, kept) => `${kept ? "Move to" : "Move from"} · ${(kept ? to.pan : from.pan) ?? "No PAN"}`}
                  hint={
                    <>
                      {to.name} keeps its own value unless you pick {from.name}&apos;s; only the values you pick are copied.
                      {takenFromOther.length > 0 && <> <strong className="text-foreground">{takenFromOther.length}</strong> field{takenFromOther.length === 1 ? "" : "s"} will take {from.name}&apos;s value.</>}
                    </>
                  }
                />
              </fieldset>
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
          <button
            type="button"
            disabled={!clients}
            onClick={() => { setMergeOpen(true); onOpenChange(false); }}
            className="text-xs text-brand-cyan hover:underline self-center disabled:opacity-50"
          >
            Merge the whole record instead
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className={buttonClass("secondary")}>
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || (!chosen.length && !takenFromOther.length) || (panClash && !allowPan)}
              onClick={apply}
              className={buttonClass("primary")}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}{" "}
              {chosen.length
                ? `Move ${chosen.length} folio${chosen.length === 1 ? "" : "s"}${takenFromOther.length ? ` + ${takenFromOther.length} value${takenFromOther.length === 1 ? "" : "s"}` : ""}`
                : takenFromOther.length
                  ? `Apply ${takenFromOther.length} field value${takenFromOther.length === 1 ? "" : "s"}`
                  : "Move folios"}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {mergeOpen && mergeMembers.length === 2 && (
      <MergeCompareDialog
        members={mergeMembers}
        onClose={() => setMergeOpen(false)}
        onMerged={() => { setMergeOpen(false); onMerged?.(); }}
      />
    )}
    </>
  );
}
