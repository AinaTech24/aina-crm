"use client";

/**
 * The two Zoho steps. Each one: choose the export → a preview runs the whole
 * import and rolls it back (nothing saved) → the person reads the counts and
 * presses Import. Clients go first: a meeting finds its client by the Zoho
 * Record Id the clients step stores.
 */

import { useState } from "react";
import Link from "next/link";
import { Check, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import type { ContactImportResult } from "@/lib/imports/zoho/run-contacts";
import type { MeetingImportResult } from "@/lib/imports/zoho/run-meetings";

type Kind = "contacts" | "meetings";

export function ZohoImport({ mayContacts, mayMeetings }: { mayContacts: boolean; mayMeetings: boolean }) {
  return (
    <div className="space-y-4">
      <Step kind="contacts" n={1} title="Clients — Zoho Contacts export" allowed={mayContacts} />
      <Step kind="meetings" n={2} title="Meetings — Zoho Meetings export" allowed={mayMeetings} />
    </div>
  );
}

function Step({ kind, n, title, allowed }: { kind: Kind; n: number; title: string; allowed: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<ContactImportResult | MeetingImportResult | null>(null);
  const [done, setDone] = useState<ContactImportResult | MeetingImportResult | null>(null);
  const [toMe, setToMe] = useState(false);

  async function send(f: File, dryRun: boolean) {
    setBusy(dryRun ? "preview" : "import");
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("dryRun", dryRun ? "1" : "0");
      fd.append("unmatchedToMe", toMe ? "1" : "0");
      const res = await fetch(`/api/imports/zoho/${kind}`, { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Something went wrong.");
        return;
      }
      if (dryRun) setPreview(j);
      else {
        setDone(j);
        setPreview(null);
      }
    } finally {
      setBusy(null);
    }
  }

  const people = preview ? ("owners" in preview ? preview.owners : preview.hosts) : [];
  const unmatched = people.filter((p) => p.owner && !p.user);
  const willCreate = preview ? preview.created : 0;
  const canImport = !!preview && willCreate + ("updated" in preview ? preview.updated : 0) > 0 && (unmatched.length === 0 || toMe);

  async function doImport() {
    if (!file || !preview) return;
    const ok = await confirmDialog({
      title: kind === "contacts" ? "Import these clients?" : "Import these meetings?",
      message:
        kind === "contacts"
          ? `${willCreate} new client${willCreate === 1 ? "" : "s"}${"updated" in preview && preview.updated ? `, ${preview.updated} existing filled in` : ""}. No message is sent to any client.`
          : `${willCreate} meeting${willCreate === 1 ? "" : "s"}. No reminder or notification is sent.`,
      confirmLabel: "Import",
    });
    if (ok) await send(file, false);
  }

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Badge tone="neutral">Step {n}</Badge>{title}</span>}
        action={done ? <Badge tone="success" dot>Imported</Badge> : undefined}
      />
      <CardBody className="space-y-4">
        {!allowed ? (
          <p className="text-sm text-muted-foreground">
            {kind === "contacts" ? "Needs permission to edit all clients." : "Needs permission to manage all meetings."}
          </p>
        ) : done ? (
          <Done kind={kind} result={done} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex">
                <span className={buttonClass("secondary", "md", "cursor-pointer")}>
                  {busy === "preview" ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
                  {file ? "Choose another file" : "Choose the export (.xlsx / .csv)"}
                </span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="sr-only"
                  disabled={!!busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    setFile(f);
                    setPreview(null);
                    void send(f, true);
                  }}
                />
              </label>
              {file && <span className="text-sm text-muted-foreground truncate max-w-xs">{file.name}</span>}
            </div>
            {err && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{err}</div>}

            {preview && (
              <>
                <p className="text-xs text-muted-foreground">Preview — nothing has been saved yet.</p>
                {"owners" in preview ? <ContactsPreview p={preview} /> : <MeetingsPreview p={preview as MeetingImportResult} />}

                {unmatched.length > 0 && (
                  <div className="rounded-md border border-warning/50 bg-warning/5 p-3 space-y-2 text-sm">
                    <div className="font-medium">
                      {unmatched.length} {kind === "contacts" ? "owner" : "host"}
                      {unmatched.length === 1 ? " has" : "s have"} no user in the CRM
                    </div>
                    <div>
                      Add them in <Link className="underline" href="/dashboard/employees">Team Members</Link> with the same name,
                      then choose the file again — or take their {kind === "contacts" ? "clients" : "meetings"} yourself.
                    </div>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={toMe} onChange={(e) => setToMe(e.target.checked)} />
                      Give their {kind === "contacts" ? "clients" : "meetings"} to me
                    </label>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button variant="primary" disabled={!canImport || !!busy} onClick={doImport}>
                    {busy === "import" ? <Loader2 className="size-4 animate-spin" /> : null}
                    {kind === "contacts" ? `Import ${willCreate} client${willCreate === 1 ? "" : "s"}` : `Import ${willCreate} meeting${willCreate === 1 ? "" : "s"}`}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "warn" }) {
  return (
    <div className={`rounded-md px-3 py-2 ${tone === "warn" && value ? "bg-warning/10" : "bg-secondary/70"}`}>
      <div className="text-2xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${value === 0 ? "text-muted-foreground" : ""}`}>{value}</div>
    </div>
  );
}

function PeopleTable({ rows, unit }: { rows: Array<{ owner: string; count: number; user: { name: string } | null }>; unit: string }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th className="text-left">In Zoho</th>
          <th className="text-left">CRM user</th>
          <th className="text-right">{unit}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.owner || "(blank)"}>
            <td>{r.owner || <span className="text-muted-foreground">(blank — goes to you)</span>}</td>
            <td>{r.user ? <span className="inline-flex items-center gap-1"><Check className="size-3.5 text-emerald-600" />{r.user.name}</span> : r.owner ? <Badge tone="warning">No user</Badge> : "—"}</td>
            <td className="text-right tabular-nums">{r.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ValueTable({ title, items }: { title: string; items: Array<{ value: string; to: string; count: number }> }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="text-xs font-medium mb-1">{title}</div>
      <table className="w-full text-sm">
        <tbody>
          {items.map((it) => (
            <tr key={`${it.value}→${it.to}`}>
              <td>{it.value}</td>
              <td className="text-muted-foreground">→ {it.to}</td>
              <td className="text-right tabular-nums">{it.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowList({ title, rows }: { title: string; rows: Array<{ row: number; name: string; reason?: string; message?: string }> }) {
  if (!rows.length) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium">{title} ({rows.length}{rows.length >= 500 ? "+" : ""})</summary>
      <div className="mt-2 max-h-72 overflow-auto">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="tabular-nums text-muted-foreground w-16">Row {r.row}</td>
                <td>{r.name}</td>
                <td className="text-muted-foreground">{r.reason ?? r.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ContactsPreview({ p }: { p: ContactImportResult }) {
  const f = p.families;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Rows" value={p.totalRows} />
        <Stat label="New clients" value={p.created} />
        <Stat label="Existing, filled in" value={p.updated} />
        <Stat label="Skipped" value={p.skipped.length} tone="warn" />
        <Stat label="Families" value={f.created + f.joinedExisting} />
      </div>
      <PeopleTable rows={p.owners.map((o) => ({ owner: o.owner, count: o.clients, user: o.user }))} unit="Clients" />
      <ul className="text-sm space-y-1">
        <li>Families: {f.created} new, {f.joinedExisting} existing · {f.membersLinked} members linked{f.inAnotherFamily ? ` · ${f.inAnotherFamily} already in another family (left there)` : ""}{f.headMissing ? ` · ${f.headMissing} whose family owner is not in the file` : ""}</li>
        <li>Referrals linked to the referring client: {p.referralsLinked}</li>
        <li>Products marked "Held with us" on Cross-sell: {p.crossSellClients} clients</li>
        <li>Risk profiles: {p.riskProfiles} (recorded as provisional — confirm with each client)</li>
        {p.minors > 0 && <li>Minors (Guardian Name, under 18): {p.minors}</li>}
        {p.customFieldsCreated.length > 0 && <li>New custom fields: {p.customFieldsCreated.join(", ")}</li>}
        {p.ignoredColumns.length > 0 && <li className="text-muted-foreground">Not imported: {p.ignoredColumns.map((c) => c.column).join(", ")}</li>}
        {p.unusedColumns.length > 0 && <li className="text-muted-foreground">Columns not recognised (ignored): {p.unusedColumns.join(", ")}</li>}
      </ul>
      <div className="grid gap-4 md:grid-cols-2">
        {p.values.map((v) => <ValueTable key={v.label} title={v.label} items={v.items} />)}
      </div>
      <RowList title="Skipped rows" rows={p.skipped} />
      <RowList title="Notes on rows" rows={p.warnings} />
    </div>
  );
}

function MeetingsPreview({ p }: { p: MeetingImportResult }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Rows" value={p.totalRows} />
        <Stat label="Meetings to import" value={p.created} />
        <Stat label="Past, marked completed" value={p.closedAsPast} />
        <Stat label="Skipped" value={p.skipped.length} tone="warn" />
      </div>
      <PeopleTable rows={p.hosts.map((h) => ({ owner: h.owner, count: h.meetings, user: h.user }))} unit="Meetings" />
      {p.skippedByReason.length > 0 && (
        <ValueTable title="Skipped" items={p.skippedByReason.map((s) => ({ value: s.reason, to: "skipped", count: s.count }))} />
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <ValueTable title="Meeting Type" items={p.types} />
        <ValueTable title="Meeting Status" items={p.statuses} />
      </div>
      <RowList title="Skipped rows" rows={p.skipped} />
    </div>
  );
}

function Done({ kind, result }: { kind: Kind; result: ContactImportResult | MeetingImportResult }) {
  if (kind === "contacts") {
    const r = result as ContactImportResult;
    return (
      <div className="space-y-3 text-sm">
        <p>
          {r.created} clients added, {r.updated} existing filled in, {r.families.created} families created
          {r.skipped.length ? `, ${r.skipped.length} rows skipped` : ""}.
        </p>
        <RowList title="Skipped rows" rows={r.skipped} />
        <Link className="underline" href="/dashboard/investors">Open Clients</Link>
      </div>
    );
  }
  const r = result as MeetingImportResult;
  return (
    <div className="space-y-3 text-sm">
      <p>
        {r.created} meetings added ({r.closedAsPast} past ones marked completed){r.skipped.length ? `, ${r.skipped.length} skipped` : ""}.
      </p>
      <RowList title="Skipped rows" rows={r.skipped} />
      <Link className="underline" href="/dashboard/review-meetings">Open Meetings</Link>
    </div>
  );
}
