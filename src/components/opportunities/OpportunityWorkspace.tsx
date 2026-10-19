"use client";

/**
 * The opportunity page's working parts (/dashboard/opportunities/[id]).
 *
 *   OpportunityJourney      the journey card shared with the client page —
 *                           stage rail, what the next step needs, next
 *                           follow-up, move on / needs analysis / proposal /
 *                           mark lost. Every action re-renders the page from
 *                           the server, so history and tasks stay in step.
 *   OpportunityDetailsCard  amount, how, owner, co-owner, notes — and Edit.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { SelectField } from "@/components/ui/SelectField";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { notify } from "@/components/ui/Toast";
import { OpportunityCard, type Staff } from "@/components/opportunities/OpportunitiesPanel";
import { formatDate, formatMoney } from "@/lib/format";
import type { OpportunityView } from "@/lib/opportunities/journey";

const SOURCE_LABEL: Record<string, string> = {
  manual: "Added by hand", cross_sell: "Cross-sell card", lead_match: "A new enquiry",
  review: "A review meeting", automation: "An automation",
};

export function OpportunityJourney({ o, canWork, staff }: { o: OpportunityView; canWork: boolean; staff: Staff[] }) {
  const router = useRouter();
  const synced = useRef(false);
  // Something outside the journey may already have done the current step (a
  // proposal sent, KYC verified): let it catch up once when the page opens.
  useEffect(() => {
    if (synced.current || !o.canSync || o.status !== "open") return;
    synced.current = true;
    void fetch(`/api/opportunities/${o.id}/sync`, { method: "POST" }).then((r) => r.ok && router.refresh()).catch(() => null);
  }, [o.id, o.canSync, o.status, router]);

  return (
    <OpportunityCard
      o={o}
      canWork={canWork && o.status === "open"}
      staff={staff}
      onChange={() => router.refresh()}
      onReload={async () => router.refresh()}
    />
  );
}

export function OpportunityDetailsCard({ o, canWork, staff, assignees }: {
  o: OpportunityView; canWork: boolean; staff: Staff[];
  /** Who the owner can be changed to (lib/opportunities/assignees.ts). */
  assignees: Staff[];
}) {
  const [editing, setEditing] = useState(false);
  const rows: Array<[string, React.ReactNode]> = [
    ["Expected", o.expectedValue == null ? "—" : `${formatMoney(o.expectedValue)}${o.investmentMode === "sip" ? " a month (SIP)" : o.investmentMode === "lumpsum" ? " lumpsum" : ""}`],
    ["Owner", o.ownerName ?? "—"],
    ...(o.coOwnerName ? [["Works it with", o.coOwnerName] as [string, React.ReactNode]] : []),
    ["Came from", SOURCE_LABEL[o.source] ?? o.source],
    ["Opened", formatDate(o.createdAt)],
    ...(o.closedAt ? [[o.status === "won" ? "Won on" : "Lost on", formatDate(o.closedAt)] as [string, React.ReactNode]] : []),
    ...(o.status === "lost" && o.lostReason ? [["Why lost", o.lostReason] as [string, React.ReactNode]] : []),
    ...(o.status === "lost" && o.revisitOn ? [["Revisit on", formatDate(o.revisitOn)] as [string, React.ReactNode]] : []),
  ];
  return (
    <Card>
      <CardHeader
        title="Details"
        action={canWork && o.status === "open" ? (
          <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>Edit</Button>
        ) : undefined}
      />
      <dl className="space-y-2 px-5 pb-5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right font-medium text-foreground">{v}</dd>
          </div>
        ))}
        {o.notes && (
          <div className="border-t border-border/60 pt-2">
            <dt className="text-muted-foreground">What the client said</dt>
            <dd className="mt-0.5 whitespace-pre-line text-foreground">{o.notes}</dd>
          </div>
        )}
      </dl>
      {editing && <EditDialog o={o} staff={staff} assignees={assignees} onClose={() => setEditing(false)} />}
    </Card>
  );
}

function EditDialog({ o, staff, assignees, onClose }: { o: OpportunityView; staff: Staff[]; assignees: Staff[]; onClose: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState(o.expectedValue == null ? "" : String(o.expectedValue));
  const [mode, setMode] = useState<"" | "sip" | "lumpsum">(o.investmentMode ?? "");
  const [ownerId, setOwnerId] = useState(o.ownerId ?? "");
  const [coOwnerId, setCoOwnerId] = useState(o.coOwnerId ?? "");
  const [notes, setNotes] = useState(o.notes ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/opportunities/${o.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedValue: value.trim() ? Number(value.replace(/[^0-9.]/g, "")) : null,
          ...(o.pipeline === "mf" ? { investmentMode: mode || null } : {}),
          ...(ownerId && ownerId !== o.ownerId ? { ownerId } : {}),
          coOwnerId: coOwnerId || null,
          notes: notes.trim() || null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return notify.error(j.error ?? "Could not save");
      notify.success("Saved");
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {o.productLabel}</DialogTitle>
          <DialogDescription>A new owner takes over the follow-up.</DialogDescription>
        </DialogHeader>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={o.pipeline === "mf" && mode === "sip" ? "SIP amount a month (₹)" : o.pipeline === "insurance" ? "Expected premium (₹)" : "Expected amount (₹)"} optional>
            {(id, d) => <input id={id} aria-describedby={d} className="input-base" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />}
          </Field>
          {o.pipeline === "mf" && (
            <Field label="How" optional>
              {(id, d) => (
                <SelectField id={id} aria-describedby={d} value={mode} onChange={(e) => setMode(e.target.value as any)} className="w-full">
                  <option value="">Not decided</option>
                  <option value="sip">SIP</option>
                  <option value="lumpsum">Lumpsum</option>
                </SelectField>
              )}
            </Field>
          )}
          <Field label="Owner">
            {(id, d) => (
              <SelectField id={id} aria-describedby={d} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-full">
                {o.ownerId && !assignees.some((s) => s.id === o.ownerId) && <option value={o.ownerId}>{o.ownerName ?? "Current owner"}</option>}
                {assignees.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </SelectField>
            )}
          </Field>
          <Field label="Works it with" optional>
            {(id, d) => (
              <SelectField id={id} aria-describedby={d} value={coOwnerId} onChange={(e) => setCoOwnerId(e.target.value)} className="w-full">
                <option value="">Nobody</option>
                {staff.filter((s) => s.id !== ownerId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </SelectField>
            )}
          </Field>
          <Field label="What the client said" optional className="sm:col-span-2">
            {(id, d) => <textarea id={id} aria-describedby={d} className="input-base" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
