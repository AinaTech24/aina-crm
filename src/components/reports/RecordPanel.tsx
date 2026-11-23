"use client";

/**
 * Click a record in a report → this panel (We Care, 2026-11-23: "in every
 * report the user can click a record and update it"). It shows the row, the
 * record's quick update — status, follow-up, remarks and the like, through the
 * record's own API and its own permission checks — and a link to the full
 * record for everything else. Saving re-runs the report, so the figures move
 * at once.
 *
 * Tables call useRecordPanel()?.open(row, columns); with no provider (a table
 * used elsewhere) rows stay as they were.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, Pencil } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { buttonClass } from "@/components/ui/button-class";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { notify } from "@/components/ui/Toast";

type Column = { key: string; label: string; type?: string };
type Row = Record<string, unknown>;
type Opened = { row: Row; columns: Column[] };

const Ctx = createContext<{ open: (row: Row, columns: Column[]) => void } | null>(null);

export function useRecordPanel() {
  return useContext(Ctx);
}

/** Subjects whose report rows are clients: the panel offers Edit client. */
const CLIENT_SUBJECTS = new Set(["investor", "new_client", "client_gap"]);
const CLIENT_LINKED = new Set(["equity_dmat", "sip_rejection", "transaction", "sip"]);

const SIP_STATUS: Array<[string, string]> = [
  ["pending", "Pending"],
  ["client_contacted", "Client contacted"],
  ["bank_issue", "Bank issue"],
  ["mandate_issue", "Mandate issue"],
  ["reprocessed", "Reprocessed"],
  ["recovered", "Purchase done (recovered)"],
  ["not_recoverable", "Not recoverable"],
];
const TASK_STATUS: Array<[string, string]> = [
  ["open", "Open"],
  ["in_progress", "In progress"],
  ["blocked", "Blocked"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
];
const SR_STATUS: Array<[string, string]> = [
  ["open", "Open"],
  ["in_progress", "In progress"],
  ["waiting_customer", "Waiting on client"],
  ["resolved", "Resolved"],
  ["closed", "Closed"],
  ["escalated", "Escalated"],
];
const DMAT_STATUS: Array<[string, string]> = [
  ["active", "Active"],
  ["dormant", "Dormant"],
  ["closed", "Closed"],
];

function show(v: unknown, type?: string): string {
  if (v == null || v === "") return "—";
  if ((type === "currency" || type === "number" || type === "integer") && Number.isFinite(Number(v))) return Number(v).toLocaleString("en-IN");
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
  return s;
}

const str = (v: unknown) => (v == null ? "" : String(v));

export function RecordPanelProvider({
  subject,
  linkBase,
  onSaved,
  children,
}: {
  subject: string;
  linkBase: string | null;
  onSaved: () => void;
  children: ReactNode;
}) {
  const [opened, setOpened] = useState<Opened | null>(null);
  return (
    <Ctx.Provider value={{ open: (row, columns) => setOpened({ row, columns }) }}>
      {children}
      <RecordSheet
        subject={subject}
        linkBase={linkBase}
        opened={opened}
        onClose={() => setOpened(null)}
        onSaved={() => {
          setOpened(null);
          onSaved();
        }}
      />
    </Ctx.Provider>
  );
}

function RecordSheet({
  subject,
  linkBase,
  opened,
  onClose,
  onSaved,
}: {
  subject: string;
  linkBase: string | null;
  opened: Opened | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const row = opened?.row ?? {};
  const id = str(row.__id);
  const link = str(row.__link);
  const href = linkBase && link ? `${linkBase}${link}` : null;
  const title =
    (opened?.columns ?? []).map((c) => row[c.key]).find((v) => typeof v === "string" && v.trim() && !/^\d{4}-\d{2}-\d{2}/.test(v)) ?? "Record";
  const clientId = CLIENT_SUBJECTS.has(subject) ? id : CLIENT_LINKED.has(subject) ? link : "";

  return (
    <Sheet open={!!opened} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full max-w-lg space-y-4 overflow-y-auto">
        <div className="pr-10">
          <SheetTitle className="text-base font-semibold">{String(title)}</SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">Update this record, or open it for everything else.</SheetDescription>
        </div>

        <div className="flex flex-wrap gap-2">
          {href && (
            <Link href={href} target="_blank" className={buttonClass("secondary", "sm")}>
              <ExternalLink className="size-4" /> Open record
            </Link>
          )}
          {clientId && (
            <Link href={`/dashboard/investors/${clientId}/edit`} target="_blank" className={buttonClass("secondary", "sm")}>
              <Pencil className="size-4" /> Edit client
            </Link>
          )}
        </div>

        {opened && id && <QuickUpdate key={id} subject={subject} id={id} row={row} onSaved={onSaved} />}

        <dl className="card-surface divide-y text-sm">
          {(opened?.columns ?? []).map((c) => (
            <div key={c.key} className="flex gap-3 px-3 py-2">
              <dt className="w-40 shrink-0 text-muted-foreground">{c.label}</dt>
              <dd className="min-w-0 break-words">{show(row[c.key], c.type)}</dd>
            </div>
          ))}
        </dl>
      </SheetContent>
    </Sheet>
  );
}

/** The record's own update, by subject. Sends only what was changed. */
function QuickUpdate({ subject, id, row, onSaved }: { subject: string; id: string; row: Row; onSaved: () => void }) {
  const spec = SPECS[subject];
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => setVals({}), [id]);
  if (!spec) return null;

  const val = (k: string, fromRow?: string) => vals[k] ?? (fromRow ? str(row[fromRow]) : "");
  const set = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));
  const changed = Object.keys(vals).length > 0;

  async function save() {
    if (!spec) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      for (const f of spec.fields) {
        if (!(f.key in vals)) continue;
        const v = vals[f.key];
        body[f.key] = f.kind === "number" ? (v === "" ? null : Number(v)) : f.kind === "datetime" ? (v ? `${v}T10:00:00+05:30` : null) : v;
      }
      const r = await fetch(spec.url(id), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Could not save");
      notify.success("Saved");
      onSaved();
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface space-y-3 p-3">
      <div className="text-sm font-medium">Update</div>
      {spec.fields.map((f) => (
        <label key={f.key} className="block text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">{f.label}</span>
          {f.options ? (
            <SelectField value={val(f.key, f.fromRow)} onChange={(e) => set(f.key, e.target.value)} className="w-full">
              {!val(f.key, f.fromRow) && <option value="">Choose…</option>}
              {f.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </SelectField>
          ) : f.kind === "date" || f.kind === "datetime" ? (
            <DateField size="sm" value={val(f.key)} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label} />
          ) : f.kind === "text" ? (
            <textarea className="input w-full min-h-20" value={val(f.key, f.fromRow)} onChange={(e) => set(f.key, e.target.value)} />
          ) : (
            <input className="input w-full" inputMode={f.kind === "number" ? "decimal" : undefined} value={val(f.key, f.fromRow)} onChange={(e) => set(f.key, e.target.value)} />
          )}
        </label>
      ))}
      <div className="flex justify-end">
        <Button variant="primary" size="sm" loading={busy} disabled={!changed} onClick={save}>Save</Button>
      </div>
    </div>
  );
}

type FieldSpec = {
  key: string;
  label: string;
  kind?: "text" | "date" | "datetime" | "number" | "line";
  options?: Array<[string, string]>;
  /** The report column that holds the current value, to start from. */
  fromRow?: string;
};
const SPECS: Record<string, { url: (id: string) => string; fields: FieldSpec[] }> = {
  sip_rejection: {
    url: (id) => `/api/sip-rejections/${id}`,
    fields: [
      { key: "recoveryStatus", label: "Status", options: SIP_STATUS, fromRow: "status" },
      { key: "followUpDate", label: "Follow-up date", kind: "date" },
      { key: "remarks", label: "Remarks", kind: "text", fromRow: "remarks" },
    ],
  },
  task: {
    url: (id) => `/api/tasks/${id}`,
    fields: [
      { key: "status", label: "Status", options: TASK_STATUS, fromRow: "status" },
      { key: "dueAt", label: "Due date", kind: "datetime" },
    ],
  },
  service_request: {
    url: (id) => `/api/service-requests/${id}`,
    fields: [
      { key: "status", label: "Status", options: SR_STATUS, fromRow: "status" },
      { key: "timelineNote", label: "Add a note", kind: "text" },
    ],
  },
  equity_dmat: {
    url: (id) => `/api/equity/dmat/${id}`,
    fields: [
      { key: "status", label: "Status", options: DMAT_STATUS, fromRow: "status" },
      { key: "dmatNumber", label: "DMAT number", kind: "line", fromRow: "dmat_number" },
      { key: "broker", label: "Broker", kind: "line", fromRow: "broker" },
      { key: "closedDate", label: "Closed on", kind: "date" },
    ],
  },
};
