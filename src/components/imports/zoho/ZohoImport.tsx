"use client";

/**
 * The two Zoho steps. Each one: choose the export → a preview runs the whole
 * import and rolls it back (nothing saved) → the person reads the counts and
 * presses Import. Clients go first: a meeting finds its client by the Zoho
 * Record Id the clients step stores.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import type { ContactImportResult } from "@/lib/imports/zoho/run-contacts";
import type { MeetingImportResult } from "@/lib/imports/zoho/run-meetings";
import type { FamilyImportResult } from "@/lib/imports/zoho/run-families";
import type { BusinessImportResult } from "@/lib/imports/zoho/run-business";
import type { SchemePreview, SchemeApplyResult } from "@/lib/imports/zoho/run-schemes";
import { SchemeAutocomplete } from "@/components/mf/SchemeAutocomplete";

type Kind = "contacts" | "meetings";

export function ZohoImport({ mayContacts, mayMeetings }: { mayContacts: boolean; mayMeetings: boolean }) {
  return (
    <div className="space-y-4">
      {mayContacts && <ClientFields />}
      <Step kind="contacts" n={1} title="Clients — Zoho Contacts export" allowed={mayContacts} />
      <Step kind="meetings" n={2} title="Meetings — Zoho Meetings export" allowed={mayMeetings} />
      {mayContacts && <FamiliesStep />}
      {mayContacts && <BusinessStep />}
      {mayContacts && <SchemeStep />}
    </div>
  );
}

/** Puts every Zoho column on the client form now, before any import. */
function ClientFields() {
  const [state, setState] = useState<{ present: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/imports/zoho/fields").then((r) => (r.ok ? r.json() : null)).then((j) => j && setState(j)).catch(() => {});
  }, []);
  async function add() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/imports/zoho/fields", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? "Something went wrong.");
      else setState({ present: j.present, total: j.total });
    } finally {
      setBusy(false);
    }
  }
  // Shown even before (or without) the count, so a slow or failed check never hides the button.
  const all = !!state && state.present >= state.total;
  return (
    <Card>
      <CardHeader
        title="Client fields from Zoho"
        action={all ? <Badge tone="success" dot>On the client form</Badge> : undefined}
      />
      <CardBody className="space-y-3 text-sm">
        <p>
          {!state
            ? "Lead Source, Salutation, TIN, IIFL Account, the product ticks and the rest of Zoho's client columns, as fields on every client."
            : all
            ? `All ${state.total} Zoho fields are on the client form (client page → Custom fields; Lead Source and Salutation are picklists).`
            : `${state.present} of ${state.total} Zoho fields are on the client form. Lead Source, Salutation, TIN, IIFL Account, the product ticks and the rest appear on every client once added.`}
        </p>
        {err && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">{err}</div>}
        {!all && (
          <Button variant="secondary" disabled={busy} onClick={add}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Add the Zoho fields to the client form
          </Button>
        )}
        <div>
          <Link className="underline" href="/dashboard/settings/custom-fields">Settings → Custom fields</Link> to rename, reorder or edit a picklist.
        </div>
      </CardBody>
    </Card>
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
        {p.picklists.map((pl) => (
          <li key={pl.label}>
            {pl.label} picklist on the client: {pl.options.length} options
            {pl.addedFromFile.length > 0 && <> · new from Zoho: {pl.addedFromFile.join(", ")}</>}
            {pl.convertedFromText && <> · the old text field becomes this picklist</>}
          </li>
        ))}
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
      <p className="text-sm">
        Clients found by Zoho Record ID: {p.matchedById} · by exact name: {p.matchedByName}
        {p.matchedByName > 0 && " (they keep the Zoho Record ID from now on)"}
      </p>
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

/**
 * Step 3 — families from a Zoho family sheet (Record Id, Contact Name, Family
 * Owner.id, Family Owner) for clients already imported. Preview first; members
 * keep their own RM and address.
 */
function FamiliesStep() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<FamilyImportResult | null>(null);
  const [done, setDone] = useState<FamilyImportResult | null>(null);

  async function send(f: File, dryRun: boolean) {
    setBusy(dryRun ? "preview" : "import");
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("dryRun", dryRun ? "1" : "0");
      const res = await fetch("/api/imports/zoho/families", { method: "POST", body: fd });
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

  async function apply() {
    if (!file || !preview) return;
    const ok = await confirmDialog({
      title: "Create these families?",
      message: `${preview.created} new families, ${preview.membersLinked} clients linked. Members keep their own RM and address.`,
      confirmLabel: "Create families",
    });
    if (ok) await send(file, false);
  }

  const r = done ?? preview;
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Badge tone="neutral">Step 3</Badge>Families — Zoho family sheet</span>}
        action={done ? <Badge tone="success" dot>Done</Badge> : undefined}
      />
      <CardBody className="space-y-4">
        {!done && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex">
              <span className={buttonClass("secondary", "md", "cursor-pointer")}>
                {busy === "preview" ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
                {file ? "Choose another file" : "Choose the family sheet (.xlsx / .csv)"}
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
        )}
        {err && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{err}</div>}
        {r && (
          <>
            {!done && <p className="text-xs text-muted-foreground">Preview — nothing has been saved yet.</p>}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="Families in the sheet" value={r.familiesInSheet} />
              <Stat label={done ? "Families created" : "New families"} value={r.created} />
              <Stat label="Existing families" value={r.existing} />
              <Stat label={done ? "Clients linked" : "Clients to link"} value={r.membersLinked} />
              <Stat label="Not placed" value={r.problems.reduce((n, p) => n + p.count, 0)} tone="warn" />
            </div>
            <ul className="text-sm space-y-1">
              <li>Members keep their own RM and address — only the family link is added.</li>
              <li>
                Clients found by Zoho Record ID: {r.matchedById} · by exact name: {r.matchedByName}
                {r.matchedByName > 0 && " (they keep the Zoho Record ID from now on)"}
              </li>
              {r.nestedHeadsJoined > 0 && <li>{r.nestedHeadsJoined} heads listed under another family join that family, with their members.</li>}
              {r.aloneSkipped > 0 && <li>{r.aloneSkipped} Family Owners with nobody else get no family.</li>}
              {r.alreadyInFamily > 0 && <li>{r.alreadyInFamily} clients are already in the right family.</li>}
            </ul>
            {r.problems.length > 0 && (
              <ValueTable title="Not placed" items={r.problems.map((p) => ({ value: p.reason, to: "left as is", count: p.count }))} />
            )}
            {r.details.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">Names ({r.details.length}{r.details.length >= 300 ? "+" : ""})</summary>
                <div className="mt-2 max-h-72 overflow-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {r.details.map((d, i) => (
                        <tr key={i}>
                          <td>{d.head}</td>
                          <td>{d.member ?? ""}</td>
                          <td className="text-muted-foreground">{d.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
            {!done && (
              <div className="flex justify-end">
                <Button variant="primary" disabled={!!busy || r.membersLinked === 0} onClick={apply}>
                  {busy === "import" ? <Loader2 className="size-4 animate-spin" /> : null}
                  Create families
                </Button>
              </div>
            )}
            {done && <Link className="underline text-sm" href="/dashboard/families">Open Families</Link>}
          </>
        )}
      </CardBody>
    </Card>
  );
}

const PRODUCT_LABEL: Record<string, string> = { mutual_fund: "Mutual fund", sif: "SIF", aif: "AIF", pms: "PMS" };
const TYPE_LABEL: Record<string, string> = {
  sip: "SIP", sip_stop: "SIP Stop", lumpsum: "Purchase", switch: "Switch", stp: "STP", swp: "SWP", redemption: "Redemption", other: "Other",
};
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/**
 * Step 4 — MF business from a Zoho MF Transaction export (the parent sheet plus
 * its "SIP and SIP Stop" and "Purchase and Redemption" subform sheets, one
 * workbook) into Business Entries. Preview first.
 */
function BusinessStep() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<BusinessImportResult | null>(null);
  const [done, setDone] = useState<BusinessImportResult | null>(null);
  const [toMe, setToMe] = useState(false);

  async function send(f: File, dryRun: boolean) {
    setBusy(dryRun ? "preview" : "import");
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("dryRun", dryRun ? "1" : "0");
      fd.append("unmatchedToMe", toMe ? "1" : "0");
      const res = await fetch("/api/imports/zoho/business", { method: "POST", body: fd });
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

  const r = done ?? preview;
  const unmatched = (preview?.owners ?? []).filter((o) => o.owner && !o.user);
  const canImport = !!preview && preview.entries > 0 && (unmatched.length === 0 || toMe);

  async function apply() {
    if (!file || !preview) return;
    const ok = await confirmDialog({
      title: "Import this business?",
      message: `${preview.created} entries with ${preview.lines} lines, as confirmed business. No email is sent, no SIP is added to the SIP book.`,
      confirmLabel: "Import",
    });
    if (ok) await send(file, false);
  }

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Badge tone="neutral">Step 4</Badge>MF business — Zoho MF Transactions (with its subform sheets)</span>}
        action={done ? <Badge tone="success" dot>Imported</Badge> : undefined}
      />
      <CardBody className="space-y-4">
        {!done && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex">
              <span className={buttonClass("secondary", "md", "cursor-pointer")}>
                {busy === "preview" ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
                {file ? "Choose another file" : "Choose the export (.xlsx with all its sheets)"}
              </span>
              <input
                type="file"
                accept=".xlsx,.xls"
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
        )}
        {err && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{err}</div>}
        {r && (
          <>
            {done ? (
              <p className="text-sm">{done.created} entries with {done.lines} lines added as confirmed business.</p>
            ) : (
              <p className="text-xs text-muted-foreground">Preview — nothing has been saved yet.</p>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="MF Transactions" value={r.parents} />
              <Stat label={done ? "Entries added" : "Entries to add"} value={r.created} />
              <Stat label="Scheme lines" value={r.lines} />
              <Stat label="Client not linked" value={r.clients.unlinked} tone="warn" />
              <Stat label="Skipped" value={r.skippedByReason.reduce((n, x) => n + x.count, 0)} tone="warn" />
            </div>
            <ul className="text-sm space-y-1">
              <li>
                Gross business {inr(r.totals.gross)} (Zoho Total Purchase {inr(r.totals.zohoPurchase)}) · Redemption {inr(r.totals.redemption)} (Zoho {inr(r.totals.zohoRedemption)})
              </li>
              <li>Clients found by Zoho Record ID: {r.clients.byId} · by exact name: {r.clients.byName}</li>
              <li>Entries: {r.byProduct.map((p) => `${PRODUCT_LABEL[p.value] ?? p.value} ${p.count}`).join(" · ")}</li>
              <li>Confirmed business, no email, nothing added to the SIP book; rejected lines are kept but not counted.</li>
            </ul>
            {!done && <PeopleTable rows={(preview?.owners ?? []).map((o) => ({ owner: o.owner, count: o.entries, user: o.user }))} unit="Entries" />}
            <div className="grid gap-4 md:grid-cols-2">
              <ValueTable title="Line types" items={r.types.map((t) => ({ value: TYPE_LABEL[t.value] ?? t.value, to: "", count: t.count }))} />
              {r.skippedByReason.length > 0 && <ValueTable title="Skipped" items={r.skippedByReason.map((x) => ({ value: x.reason, to: "skipped", count: x.count }))} />}
            </div>
            {r.unlinked.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">Entries kept without a client link ({r.unlinked.length}{r.unlinked.length >= 500 ? "+" : ""})</summary>
                <div className="mt-2 max-h-72 overflow-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {r.unlinked.map((u) => (
                        <tr key={u.mft}>
                          <td className="tabular-nums text-muted-foreground w-24">{u.mft}</td>
                          <td>{u.client}</td>
                          <td className="text-muted-foreground">{u.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
            {!done && unmatched.length > 0 && (
              <div className="rounded-md border border-warning/50 bg-warning/5 p-3 space-y-2 text-sm">
                <div className="font-medium">{unmatched.length} owner{unmatched.length === 1 ? " has" : "s have"} no user in the CRM</div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={toMe} onChange={(e) => setToMe(e.target.checked)} />
                  Book their entries under me
                </label>
              </div>
            )}
            {!done && (
              <div className="flex justify-end">
                <Button variant="primary" disabled={!canImport || !!busy} onClick={apply}>
                  {busy === "import" ? <Loader2 className="size-4 animate-spin" /> : null}
                  Import {preview?.created ?? 0} entries
                </Button>
              </div>
            )}
            {done && <Link className="underline text-sm" href="/dashboard/business-entries">Open Business Entries</Link>}
          </>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * Step 5 — Zoho's scheme names on the imported business, mapped to the firm's
 * Scheme Master. Exact family matches are included (Regular · Growth unless the
 * name says otherwise); a close match is only a suggestion until ticked; any
 * other name gets a picker. Nothing changes until Apply.
 */
function SchemeStep() {
  const [data, setData] = useState<SchemePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"sync" | "apply" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [picked, setPicked] = useState<Record<string, { code: string; name: string }>>({});
  const [done, setDone] = useState<SchemeApplyResult | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/imports/zoho/schemes");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? "Something went wrong.");
      else setData(j);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function syncMaster() {
    setBusy("sync");
    setErr(null);
    try {
      const res = await fetch("/api/schemes/sync", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? "The Scheme Master could not be filled.");
      else await load();
    } finally {
      setBusy(null);
    }
  }

  const rows = data?.rows ?? [];
  const exact = rows.filter((r) => r.confidence === "exact" && r.scheme);
  const close = rows.filter((r) => r.confidence === "close" && r.scheme);
  const none = rows.filter((r) => r.confidence === "none");
  const mappings = [
    ...exact.map((r) => ({ name: r.name, schemeCode: r.scheme!.code })),
    ...close.filter((r) => accepted[r.name] && !picked[r.name]).map((r) => ({ name: r.name, schemeCode: r.scheme!.code })),
    ...Object.entries(picked).map(([name, p]) => ({ name, schemeCode: p.code })),
  ];
  const lineCount = (names: Set<string>) => rows.filter((r) => names.has(r.name)).reduce((n, r) => n + r.lines, 0);
  const mappedLines = lineCount(new Set(mappings.map((m) => m.name)));

  async function apply() {
    const ok = await confirmDialog({
      title: "Map these scheme names?",
      message: `${mappings.length} names on ${mappedLines} lines get their Scheme Master scheme. The Zoho name stays in each line's notes.`,
      confirmLabel: "Map",
    });
    if (!ok) return;
    setBusy("apply");
    setErr(null);
    try {
      const res = await fetch("/api/imports/zoho/schemes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mappings }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? "Something went wrong.");
      else {
        setDone(j);
        setAccepted({});
        setPicked({});
        await load();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Badge tone="neutral">Step 5</Badge>Scheme names → Scheme Master</span>} />
      <CardBody className="space-y-4 text-sm">
        {err && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">{err}</div>}
        {done && (
          <p>
            {done.names} names mapped on {done.lines + done.fromLines} lines ({done.entries} entries).
            {done.rejected.length > 0 && ` Not in the Scheme Master: ${done.rejected.join(", ")}.`}
          </p>
        )}
        {loading && !data && <p className="text-muted-foreground inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Matching scheme names…</p>}
        {data && data.masterCount === 0 && (
          <div className="rounded-md border border-warning/50 bg-warning/5 p-3 space-y-2">
            <div>The Scheme Master is empty, so there is nothing to map to yet.</div>
            <Button variant="secondary" disabled={!!busy} onClick={syncMaster}>
              {busy === "sync" ? <Loader2 className="size-4 animate-spin" /> : null}
              Fill the Scheme Master from AMFI
            </Button>
          </div>
        )}
        {data && data.masterCount > 0 && rows.length === 0 && <p>Every imported scheme name is mapped.</p>}
        {data && data.masterCount > 0 && rows.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Names to map" value={rows.length} />
              <Stat label="Exact matches" value={exact.length} />
              <Stat label="Suggestions" value={close.length} />
              <Stat label="Need a pick" value={none.length} tone="warn" />
            </div>
            <p className="text-muted-foreground">A name that does not say Direct or IDCW maps to the Regular · Growth scheme.</p>
            {exact.length > 0 && (
              <details>
                <summary className="cursor-pointer font-medium">Exact matches — included ({exact.length} names, {lineCount(new Set(exact.map((r) => r.name)))} lines)</summary>
                <div className="mt-2 max-h-72 overflow-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {exact.map((r) => (
                        <tr key={r.name}><td>{r.name}</td><td className="text-muted-foreground">→ {r.scheme!.name}</td><td className="text-right tabular-nums">{r.lines}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
            {close.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">Suggestions — tick the right ones</div>
                  <Button variant="ghost" size="sm" onClick={() => setAccepted(Object.fromEntries(close.map((r) => [r.name, true])))}>Tick all</Button>
                </div>
                <div className="max-h-96 overflow-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {close.map((r) => (
                        <tr key={r.name}>
                          <td className="w-8"><input type="checkbox" aria-label={`Use the suggestion for ${r.name}`} checked={!!accepted[r.name]} onChange={(e) => setAccepted((a) => ({ ...a, [r.name]: e.target.checked }))} /></td>
                          <td>{r.name}</td>
                          <td className="text-muted-foreground">→ {r.scheme!.name}</td>
                          <td className="text-right tabular-nums">{r.lines}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {none.length > 0 && (
              <details open={none.length <= 40}>
                <summary className="cursor-pointer font-medium">Pick the scheme ({none.length} names)</summary>
                <div className="mt-2 space-y-2">
                  {none.map((r) => (
                    <div key={r.name} className="grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-center">
                      <div>
                        {r.name} <span className="text-muted-foreground tabular-nums">· {r.lines} lines</span>
                        {r.nearest && <div className="text-muted-foreground text-xs">Nearest: {r.nearest}</div>}
                      </div>
                      <SchemeAutocomplete
                        size="sm"
                        plan="regular"
                        placeholder="Search the Scheme Master…"
                        onSelect={(p) => setPicked((x) => ({ ...x, [r.name]: { code: p.schemeCode, name: p.schemeName } }))}
                        onClear={() => setPicked((x) => { const y = { ...x }; delete y[r.name]; return y; })}
                      />
                      <span className="text-xs text-muted-foreground">{picked[r.name] ? "Picked" : ""}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
            <div className="flex justify-end">
              <Button variant="primary" disabled={!!busy || mappings.length === 0} onClick={apply}>
                {busy === "apply" ? <Loader2 className="size-4 animate-spin" /> : null}
                Map {mappings.length} names ({mappedLines} lines)
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
