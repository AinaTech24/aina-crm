"use client";

/**
 * Find Duplicates — the groups, and the merge itself.
 *
 * A merge retires records and moves one person's folios onto another, so it is
 * never one click: "Compare & merge" opens the group, the operator ticks the
 * records that are one person, picks the primary to keep and, field by field
 * (profile, contact, KYC, bank, nominee, RM…), whose value the merged record
 * keeps, then types MERGE. The server counts what will move before
 * anything does (POST /api/investors/merge/preview, the same engine as the
 * merge) and every merge can be undone for 7 days from the page.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, GitMerge, ShieldAlert, Info, RotateCcw } from "lucide-react";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";
import { buttonClass } from "@/components/ui/button-class";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { formatDate } from "@/lib/format";

export type Member = {
  id: string;
  name: string;
  pan: string | null;
  pan_valid?: boolean;
  phone: string | null;
  email: string | null;
  dob?: string | null;
  aum: number;
  folios?: number;
  rm_name: string | null;
};

const fmtINR = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`);

const KIND_LABEL: Record<string, string> = {
  PAN: "Same PAN",
  NameDob: "Same name + date of birth",
  Phone: "Same phone",
  Email: "Same email",
};

/** Biggest book, then most folios — the record with the most to lose. */
const defaultSurvivor = (members: Member[]) =>
  [...members].sort((a, b) => b.aum - a.aum || (b.folios ?? 0) - (a.folios ?? 0))[0]?.id ?? members[0]?.id;

const distinctValidPans = (members: Member[]) =>
  new Set(members.filter((m) => m.pan_valid && m.pan).map((m) => m.pan!.toUpperCase())).size;

async function ignoreGroup(entityType: "client" | "family", memberIds: string[]): Promise<string | null> {
  const res = await fetch("/api/duplicates/ignore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entityType, memberIds }),
  });
  if (res.ok) return null;
  const j = await res.json().catch(() => ({}));
  return j.error ?? `Dismiss failed (${res.status})`;
}

/* ───────────────────────────── Groups ───────────────────────────── */

export function DuplicateGroup({ kind, gkey, members }: { kind: string; gkey: string; members: Member[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [comparing, setComparing] = useState(false);

  async function dismiss() {
    if (!(await confirmDialog({ title: "Mark these as not duplicates?", message: "This group won't be shown again." }))) return;
    setBusy(true); setErr(null);
    try {
      const e = await ignoreGroup("client", members.map((m) => m.id));
      if (e) { setErr(e); return; }
      setDone(true);
      router.refresh();
    } finally { setBusy(false); }
  }

  if (done) return null;
  return (
    <div className="card-surface p-4">
      <GroupHeader kind={kind} gkey={gkey}>
        <button type="button" onClick={dismiss} disabled={busy} className={buttonClass("ghost", "sm")}>Not duplicates</button>
        <button type="button" onClick={() => setComparing(true)} disabled={busy} className={buttonClass("secondary", "sm")}>
          <GitMerge className="size-3.5" aria-hidden /> Compare &amp; merge
        </button>
      </GroupHeader>
      <MemberList members={members} />
      {err && <MergeError message={err} />}
      {comparing && <MergeCompareDialog members={members} onClose={() => setComparing(false)} onMerged={() => { setDone(true); router.refresh(); }} />}
    </div>
  );
}

/**
 * Records sharing a phone or email. Information, not a finding: where the PANs
 * differ they are different people and there is nothing to merge. Where PAN
 * can't tell them apart (one or both have none) the operator may still compare
 * them — the same guarded flow as a duplicate.
 */
export function SharedContactGroup({ kind, gkey, members }: { kind: string; gkey: string; members: Member[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [comparing, setComparing] = useState(false);
  const differentPeople = distinctValidPans(members) >= 2;

  async function hide() {
    if (!(await confirmDialog({ title: "Hide this group?", message: "It won't be shown here again." }))) return;
    setBusy(true); setErr(null);
    try {
      const e = await ignoreGroup("client", members.map((m) => m.id));
      if (e) { setErr(e); return; }
      setDone(true);
      router.refresh();
    } finally { setBusy(false); }
  }

  if (done) return null;
  return (
    <div className="card-surface p-4">
      <GroupHeader kind={kind} gkey={gkey}>
        <button type="button" onClick={hide} disabled={busy} className={buttonClass("ghost", "sm")}>Hide</button>
        {!differentPeople && (
          <button type="button" onClick={() => setComparing(true)} disabled={busy} className={buttonClass("secondary", "sm")}>
            <GitMerge className="size-3.5" aria-hidden /> Compare
          </button>
        )}
      </GroupHeader>
      <p className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="size-3.5" aria-hidden />
        {differentPeople ? "Different PANs — these are different people sharing a contact." : "PAN doesn't tell these apart — compare them if they might be one person."}
      </p>
      <MemberList members={members} />
      {err && <MergeError message={err} />}
      {comparing && <MergeCompareDialog members={members} onClose={() => setComparing(false)} onMerged={() => { setDone(true); router.refresh(); }} />}
    </div>
  );
}

function GroupHeader({ kind, gkey, children }: { kind: string; gkey: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0 text-xs">
        <span className="chip bg-secondary text-foreground">{KIND_LABEL[kind] ?? kind}</span>
        <span className="ml-2 font-mono text-muted-foreground break-all">{gkey}</span>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function MemberList({ members }: { members: Member[] }) {
  return (
    <ul className="space-y-1.5">
      {members.map((m) => (
        <li key={m.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
          <div className="min-w-0 flex-1">
            <Link href={`/dashboard/investors/${m.id}`} className="font-medium text-sm hover:underline">{m.name}</Link>
            <div className="text-2xs text-muted-foreground">
              {m.pan ? <span className="font-mono">{m.pan}</span> : "no PAN"}
              {m.dob ? ` · born ${formatDate(m.dob)}` : ""} · {m.phone ?? "no phone"} · {m.email ?? "no email"}
              {m.rm_name ? ` · RM ${m.rm_name}` : ""}
            </div>
          </div>
          <div className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {m.aum > 0 ? fmtINR(m.aum) : "No AUM"}
            {typeof m.folios === "number" && <div className="text-2xs">{m.folios} folio{m.folios === 1 ? "" : "s"}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ─────────────────────────── Compare & merge ─────────────────────────── */

/** Shape of POST /api/investors/merge/preview — see src/lib/investors/merge.ts. */
type MergePreview = {
  moves: Array<{ table: string; label: string; count: number }>;
  stays: Array<{ table: string; label: string; count: number }>;
  fields: Array<{
    field: string;
    label: string;
    group: string;
    values: Array<{ id: string; value: string }>;
    differs: boolean;
    defaultId: string | null;
  }>;
  panMismatch: boolean;
  totals: { moving: number; staying: number };
};

const CONFIRM_WORD = "MERGE";

export function MergeCompareDialog({ members, onClose, onMerged }: { members: Member[]; onClose: () => void; onMerged: () => void }) {
  const [survivorId, setSurvivorId] = useState<string>(() => defaultSurvivor(members));
  /** Records taking part. Everything starts included; the kept one always is. */
  const [included, setIncluded] = useState<Set<string>>(() => new Set(members.map((m) => m.id)));
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  /** field → the record whose value the kept record ends up with. */
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const survivor = members.find((m) => m.id === survivorId)!;
  // Columns: the kept record first, then the others taking part, in list order.
  const cols = useMemo(
    () => [survivor, ...members.filter((m) => m.id !== survivorId && included.has(m.id))],
    [members, survivor, survivorId, included],
  );
  const losers = cols.slice(1);
  const loserKey = losers.map((m) => m.id).join(",");

  const loadPreview = useCallback(async (keepId: string, loserIds: string[]) => {
    setPreviewing(true);
    setPreview(null);
    try {
      const res = await fetch("/api/investors/merge/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ survivorId: keepId, loserIds }),
      });
      const j = await res.json().catch(() => ({}));
      setPreview(res.ok ? j : null);
    } catch {
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }, []);

  // What moves, and which values disagree, depend on the kept record and on
  // which records take part — re-ask whenever either changes.
  useEffect(() => {
    setPicks({});
    if (!loserKey) { setPreview(null); return; }
    void loadPreview(survivorId, loserKey.split(","));
  }, [survivorId, loserKey, loadPreview]);

  function chooseKeep(id: string) {
    setSurvivorId(id);
    setIncluded((s) => new Set(s).add(id));
  }
  function toggleIncluded(id: string) {
    if (id === survivorId) return;
    setIncluded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  const chosen = (f: MergePreview["fields"][number]) => picks[f.field] ?? f.defaultId;
  const differing = preview?.fields.filter((f) => f.differs) ?? [];
  const sameCount = (preview?.fields.length ?? 0) - differing.length;
  const shown = showAll ? preview?.fields ?? [] : differing;
  const groups = useMemo(() => {
    const out: Array<{ group: string; fields: MergePreview["fields"] }> = [];
    for (const f of shown) {
      const g = out.find((x) => x.group === f.group);
      if (g) g.fields.push(f); else out.push({ group: f.group, fields: [f] });
    }
    return out;
  }, [shown]);
  const changedCount = preview
    ? preview.fields.filter((f) => chosen(f) && chosen(f) !== survivorId && f.values.find((v) => v.id === chosen(f))?.value).length
    : 0;

  const ready = losers.length > 0 && !!preview && !preview.panMismatch && typed.trim().toUpperCase() === CONFIRM_WORD && !busy;

  async function confirm() {
    if (!ready || !preview) return;
    setBusy(true); setErr(null);
    let done = 0;
    try {
      for (const loser of losers) {
        setProgress(`Merging ${loser.name}… (${done + 1} of ${losers.length})`);
        // The fields whose chosen value is THIS record's. Blank fields on the
        // kept record are filled from the first merged record automatically, and
        // a later pick overwrites that, so running the merges in order lands
        // exactly the values chosen.
        const overrides = Object.fromEntries(
          preview.fields.filter((f) => chosen(f) === loser.id).map((f) => [f.field, true]),
        );
        const res = await fetch("/api/investors/merge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            survivorId,
            loserId: loser.id,
            reason: "Merged from Find Duplicates after comparing the records",
            fieldOverrides: Object.keys(overrides).length ? overrides : undefined,
          }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) { setErr(`${loser.name}: ${j.error ?? `merge failed (${res.status})`}`); break; }
        done++;
      }
      if (done > 0) {
        notify.success(
          `Merged ${done} record${done === 1 ? "" : "s"} into ${survivor.name}. You can undo it for 7 days under “Merged in the last 7 days”.`,
          "Merged",
        );
        onMerged();
        onClose();
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Compare and merge</DialogTitle>
          <DialogDescription>
            Tick the records that are the same person and choose the one to keep. The others&apos; folios, transactions and history move to it and they are retired. You can undo this for 7 days.
          </DialogDescription>
        </DialogHeader>

        {/* 1 · Which records, and which one is kept */}
        <fieldset className="mt-4">
          <legend className="text-xs font-semibold">1. Records to merge</legend>
          <ul className="mt-2 space-y-1.5">
            {members.map((m) => {
              const keep = m.id === survivorId;
              const inMerge = included.has(m.id);
              return (
                <li key={m.id} className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 ${keep ? "border-foreground/30 bg-secondary" : inMerge ? "border-border" : "border-dashed border-border opacity-70"}`}>
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={inMerge} disabled={keep || busy} onChange={() => toggleIncluded(m.id)} />
                    <span className="sr-only">Include {m.name} in the merge</span>
                  </label>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{m.name}</div>
                    <div className="text-2xs text-muted-foreground">
                      {m.pan ? <span className="font-mono">{m.pan}</span> : "no PAN"}
                      {m.rm_name ? ` · RM ${m.rm_name}` : ""} · {m.aum > 0 ? fmtINR(m.aum) : "No AUM"}
                      {typeof m.folios === "number" ? ` · ${m.folios} folio${m.folios === 1 ? "" : "s"}` : ""}
                    </div>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs">
                    <input type="radio" name="merge-keep" checked={keep} onChange={() => chooseKeep(m.id)} disabled={busy} />
                    {keep ? <span className="font-semibold">Primary — keep this record</span> : "Keep this one"}
                  </label>
                </li>
              );
            })}
          </ul>
          {losers.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">Tick at least one other record to merge into {survivor.name}.</p>
          )}
        </fieldset>

        {/* What the server says will happen */}
        {losers.length > 0 && (
          <div className="mt-4 rounded-lg border border-border p-3 text-xs">
            {previewing ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Counting what moves…</span>
            ) : !preview ? (
              <span className="text-muted-foreground">Couldn&apos;t load the preview. Close and try again.</span>
            ) : preview.panMismatch ? (
              <div className="flex items-start gap-2 text-destructive">
                <ShieldAlert className="size-4 shrink-0" aria-hidden />
                <span>These records have different PANs, so they are different people and can&apos;t be merged. Untick the record with the other PAN.</span>
              </div>
            ) : (
              <>
                <div className="font-medium">
                  {preview.totals.moving} record{preview.totals.moving === 1 ? "" : "s"} move to {survivor.name}
                </div>
                {preview.moves.length > 0 && (
                  <div className="mt-1 text-muted-foreground">
                    {preview.moves.slice(0, 6).map((m) => `${m.count} ${m.label.toLowerCase()}`).join(" · ")}
                    {preview.moves.length > 6 ? ` · and ${preview.moves.length - 6} more` : ""}
                  </div>
                )}
                {preview.stays.length > 0 && (
                  <div className="mt-1 text-muted-foreground">
                    Stays on the retired record: {preview.stays.map((m) => m.label.toLowerCase()).join(", ")} (tied to the person who gave them).
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* 2 · Field by field: which value the merged record keeps */}
        {preview && !preview.panMismatch && losers.length > 0 && (
          <fieldset className="mt-4">
            <legend className="text-xs font-semibold">2. Which value should the merged record keep?</legend>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-2xs text-muted-foreground">
              <span>
                Click the value to keep. Blank fields are filled from another record automatically.
                {changedCount > 0 && <> <strong className="text-foreground">{changedCount}</strong> field{changedCount === 1 ? "" : "s"} will take a value from a merged record.</>}
              </span>
              {sameCount > 0 && (
                <button type="button" onClick={() => setShowAll((v) => !v)} className={buttonClass("ghost", "sm")}>
                  {showAll ? "Show only fields that differ" : `Show all fields (${sameCount} identical)`}
                </button>
              )}
            </div>
            {shown.length === 0 ? (
              <p className="mt-2 rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">These records agree on every field — nothing to choose.</p>
            ) : (
              <div className="mt-2 max-h-[45vh] overflow-auto rounded-lg border border-border">
                <table className="table-raw w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr className="border-b border-border">
                      <th className="relative w-36 px-3 py-2 text-left font-medium text-muted-foreground"><span className="sr-only">Field</span></th>
                      {cols.map((m) => (
                        <th key={m.id} className={`px-3 py-2 text-left font-medium ${m.id === survivorId ? "bg-secondary" : ""}`}>
                          <span className="block !whitespace-normal">{m.name}</span>
                          <span className="block text-2xs font-normal text-muted-foreground">{m.id === survivorId ? "Primary" : "Merging in"}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  {groups.map((g) => (
                    <tbody key={g.group}>
                      <tr>
                        <th colSpan={cols.length + 1} className="bg-secondary/50 px-3 py-1 text-left text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{g.group}</th>
                      </tr>
                      {g.fields.map((f) => (
                        <tr key={f.field} className="border-t border-border align-top">
                          <th scope="row" className="px-3 py-2 text-left font-medium text-muted-foreground">
                            {f.label}
                            {f.differs && <span className="block text-2xs font-normal text-amber-700">differs</span>}
                          </th>
                          {cols.map((m) => {
                            const v = f.values.find((x) => x.id === m.id)?.value ?? "";
                            const isChosen = chosen(f) === m.id;
                            return (
                              <td key={m.id} className={`px-2 py-1.5 ${m.id === survivorId ? "bg-secondary/60" : ""}`}>
                                {v ? (
                                  <label className={`flex cursor-pointer items-start gap-1.5 rounded-md border px-2 py-1 ${isChosen ? "border-primary bg-primary/5" : "border-transparent hover:border-border"}`}>
                                    <input
                                      type="radio"
                                      name={`pick-${f.field}`}
                                      checked={isChosen}
                                      disabled={busy}
                                      onChange={() => setPicks((p) => ({ ...p, [f.field]: m.id }))}
                                      className="mt-0.5"
                                    />
                                    <span className="min-w-0 break-words">{/^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v) : v}</span>
                                  </label>
                                ) : (
                                  <span className="block px-2 py-1 text-muted-foreground">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>
            )}
          </fieldset>
        )}

        {/* Typed confirmation */}
        <div className="mt-4">
          <label htmlFor="merge-confirm" className="text-xs font-medium">
            Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm
          </label>
          <input
            id="merge-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void confirm(); }}
            disabled={busy || !preview || preview.panMismatch || losers.length === 0}
            autoComplete="off"
            className="input-base mt-1 w-full font-mono sm:w-48"
          />
        </div>

        {progress && <div className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> {progress}</div>}
        {err && <MergeError message={err} />}

        <DialogFooter>
          <button type="button" onClick={onClose} disabled={busy} className={buttonClass("secondary")}>Cancel</button>
          <button type="button" onClick={confirm} disabled={!ready} className={buttonClass("danger")}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <GitMerge className="size-4" aria-hidden />}
            Merge {losers.length} into {survivor.name}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────────── Undo ───────────────────────────── */

export function UndoMergeButton({ mergeId, label }: { mergeId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function undo() {
    if (!(await confirmDialog({
      title: "Undo this merge?",
      message: `${label}. The moved folios, transactions and history go back to the retired record, which becomes a client again.`,
      confirmLabel: "Undo merge",
    }))) return;
    setBusy(true);
    try {
      const res = await fetch("/api/investors/unmerge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mergeId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { notify.error(j.error ?? `Undo failed (${res.status})`, "Undo merge"); return; }
      notify.success("The merge was undone.", "Undo merge");
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <button type="button" onClick={undo} disabled={busy} className={buttonClass("ghost", "sm")}>
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" aria-hidden />} Undo merge
    </button>
  );
}

/* ───────────────────────────── Families ───────────────────────────── */

type FamMember = { id: string; name: string; member_count: number; family_aum: number };

/** Duplicate family groupings → /api/families/merge. */
export function FamilyDuplicateGroup({ gkey, members }: { gkey: string; members: FamMember[] }) {
  const router = useRouter();
  const [survivor, setSurvivor] = useState<string>(() => [...members].sort((a, b) => b.family_aum - a.family_aum || b.member_count - a.member_count)[0]?.id ?? members[0]?.id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function dismiss() {
    if (!(await confirmDialog({ title: "Mark these families as not duplicates?", message: "This group won't be shown again." }))) return;
    setBusy(true); setErr(null);
    try {
      const e = await ignoreGroup("family", members.map((m) => m.id));
      if (e) { setErr(e); return; }
      setDone(true);
      router.refresh();
    } finally { setBusy(false); }
  }

  async function merge() {
    const losers = members.filter((m) => m.id !== survivor);
    if (!losers.length) return;
    if (!(await confirmDialog({ title: `Merge ${losers.length} duplicate family grouping(s) into "${members.find((m) => m.id === survivor)?.name}"?`, message: "Members and meetings move to the family you keep; the empty duplicates are removed.", confirmLabel: "Merge", tone: "danger" }))) return;
    setBusy(true); setErr(null);
    try {
      for (const l of losers) {
        const res = await fetch("/api/families/merge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ survivorId: survivor, loserId: l.id }) });
        if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? `Merge failed (${res.status})`); return; }
      }
      setDone(true); router.refresh();
    } finally { setBusy(false); }
  }

  if (done) return null;
  return (
    <div className="card-surface p-4">
      <GroupHeader kind="Name" gkey={gkey}>
        <button type="button" onClick={dismiss} disabled={busy} className={buttonClass("ghost", "sm")}>Not duplicates</button>
        <button type="button" onClick={merge} disabled={busy} className={buttonClass("secondary", "sm")}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <GitMerge className="size-3.5" aria-hidden />} Merge {members.length - 1} into the one kept
        </button>
      </GroupHeader>
      <div className="space-y-1.5">
        {members.map((m) => (
          <label key={m.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer ${survivor === m.id ? "border-foreground/30 bg-secondary" : "border-border hover:bg-secondary/40"}`}>
            <input type="radio" name={`famsurvivor-${gkey}`} checked={survivor === m.id} onChange={() => setSurvivor(m.id)} className="size-4" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm truncate">{m.name} {survivor === m.id && <span className="text-2xs text-muted-foreground font-semibold">· keep</span>}</div>
              <div className="text-2xs text-muted-foreground">{m.member_count} member{m.member_count === 1 ? "" : "s"}</div>
            </div>
            <div className="text-xs tabular-nums text-muted-foreground shrink-0">{m.family_aum > 0 ? fmtINR(m.family_aum) : "No AUM"}</div>
          </label>
        ))}
      </div>
      {err && <MergeError message={err} />}
    </div>
  );
}

/**
 * Merge failure notice. A PAN clash means the group is not one person, so it
 * says that plainly instead of offering a way around it.
 */
function MergeError({ message }: { message: string }) {
  const panClash = /different PAN/i.test(message);
  return (
    <div className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <ShieldAlert className="size-4 shrink-0 mt-0.5" aria-hidden />
      <div className="min-w-0">
        <div>{message}</div>
        {panClash && <div className="mt-1 text-xs text-muted-foreground">Different PANs mean different people. Use “Not duplicates” to stop this group appearing.</div>}
      </div>
    </div>
  );
}
