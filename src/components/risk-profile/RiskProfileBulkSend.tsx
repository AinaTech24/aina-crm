"use client";

/**
 * Risk Profiles bulk send: row checkboxes, a select-all for the page, and the
 * bar above the table with "Send link to selected" and "Send to all not
 * profiled (N)".
 *
 * The table itself stays server-rendered; these pieces share the selection
 * through context, so the page only drops a checkbox into each row.
 *
 * Nothing is sent from a click. Either button first asks the server who would
 * get the email (POST /api/risk-profiles/send-link, dryRun) and shows it in a
 * dialog: the channel, the template(s) and their subject, and everyone who will
 * NOT get it and why. Confirming posts the ids back in small batches, with a
 * progress count, so a book of hundreds never rides on one long request.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, Send, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { buttonClass } from "@/components/ui/button-class";
import { notify } from "@/components/ui/Toast";

type Selection = {
  selected: Set<string>;
  pageIds: string[];
  toggle: (id: string) => void;
  setPage: (on: boolean) => void;
  clear: () => void;
};

const SelectionContext = createContext<Selection | null>(null);

function useSelection(): Selection {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("Risk profile selection used outside RiskSelectionProvider");
  return ctx;
}

/** Key this on the tab + page: a selection never silently carries to rows you can't see. */
export function RiskSelectionProvider({ pageIds, children }: { pageIds: string[]; children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const value = useMemo<Selection>(
    () => ({
      selected,
      pageIds,
      toggle: (id) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      setPage: (on) => setSelected(on ? new Set(pageIds) : new Set()),
      clear: () => setSelected(new Set()),
    }),
    [selected, pageIds]
  );
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function RowSelect({ id, name }: { id: string; name: string }) {
  const { selected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      checked={selected.has(id)}
      onChange={() => toggle(id)}
      aria-label={`Select ${name}`}
      className="size-4 rounded border-border align-middle"
    />
  );
}

export function SelectAllOnPage() {
  const { selected, pageIds, setPage } = useSelection();
  const ref = useRef<HTMLInputElement>(null);
  const all = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const some = !all && pageIds.some((id) => selected.has(id));
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={all}
      onChange={() => setPage(!all)}
      disabled={pageIds.length === 0}
      aria-label="Select every client on this page"
      className="size-4 rounded border-border align-middle"
    />
  );
}

type Preview = {
  total: number;
  sendable: number;
  noEmail: number;
  noEmailSample: string[];
  recent: number;
  recentDays: number;
  blocked: number;
  templates: Array<{
    key: string;
    name: string;
    subject: string | null;
    problem: string | null;
    /** Clients in the audience this template applies to / will get it now / held back by `problem`. */
    audience: number;
    sending: number;
    blocked: number;
  }>;
  ids: string[];
  batchSize: number;
};

type Target = { kind: "selected"; ids: string[] } | { kind: "not_profiled" };

const n = (v: number) => v.toLocaleString("en-IN");
/** "Hello {{investor.first_name}}" → "Hello [first name]": merge tokens read as code to an RM. */
const readable = (subject: string) =>
  subject.replace(/\{\{\s*(?:[\w]+\.)*([\w]+)\s*\}\}/g, (_, k: string) => `[${k.replace(/_/g, " ")}]`);
const clients = (v: number) => `${n(v)} ${v === 1 ? "client" : "clients"}`;

export function RiskBulkBar({ notProfiledCount }: { notProfiledCount: number }) {
  const router = useRouter();
  const { selected, clear } = useSelection();
  const [target, setTarget] = useState<Target | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const sending = progress !== null;
  // Ignore a preview that lands after the dialog was closed or reopened.
  const request = useRef(0);

  async function open(next: Target) {
    const mine = ++request.current;
    setTarget(next);
    setPreview(null);
    setLoadError(null);
    try {
      const res = await fetch("/api/risk-profiles/send-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          next.kind === "selected" ? { investorIds: next.ids, dryRun: true } : { audience: "not_profiled", dryRun: true }
        ),
      });
      const j = await res.json().catch(() => ({}));
      if (mine !== request.current) return;
      if (!res.ok) {
        setLoadError(j.error ?? "Couldn't work out who would get the email.");
        return;
      }
      setPreview(j as Preview);
    } catch {
      if (mine === request.current) setLoadError("Network error. Nothing was sent.");
    }
  }

  async function send() {
    if (!preview || preview.ids.length === 0) return;
    const ids = preview.ids;
    const size = Math.max(1, preview.batchSize);
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let notSent = 0;
    setProgress({ done: 0, of: ids.length });
    try {
      for (let i = 0; i < ids.length; i += size) {
        const chunk = ids.slice(i, i + size);
        const res = await fetch("/api/risk-profiles/send-link", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ investorIds: chunk }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          notify.error(
            `${j.error ?? "The send stopped."} ${sent ? `${clients(sent)} had already been emailed.` : "Nothing was sent."}`,
            "Send stopped"
          );
          return;
        }
        sent += Number(j.sent ?? 0);
        skipped += Number(j.skipped ?? 0);
        failed += Array.isArray(j.failed) ? j.failed.length : 0;
        notSent += Number(j.notSent ?? 0);
        setProgress({ done: Math.min(ids.length, i + chunk.length), of: ids.length });
      }
      const extra = [
        skipped ? `${n(skipped)} skipped by consent or compliance checks` : "",
        failed ? `${n(failed)} failed` : "",
        notSent ? `${n(notSent)} no longer eligible` : "",
      ].filter(Boolean);
      if (sent) notify.success(`Emailed the risk profile link to ${clients(sent)}.${extra.length ? ` ${extra.join(", ")}.` : ""}`);
      else notify.error(extra.length ? `${extra.join(", ")}.` : "No emails went out.", "Nothing sent");
      if (target?.kind === "selected") clear();
      setTarget(null);
      router.refresh();
    } catch {
      notify.error(`Network error. ${sent ? `${clients(sent)} had already been emailed.` : "Nothing was sent."}`, "Send stopped");
    } finally {
      setProgress(null);
    }
  }

  const count = selected.size;
  const problems = preview?.templates.filter((t) => t.problem && t.blocked > 0) ?? [];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs">
        {count > 0 ? (
          <>
            <span className="font-semibold text-foreground">{n(count)} selected</span>
            <button type="button" onClick={clear} className={buttonClass("ghost", "sm")}>
              <X className="size-3.5" /> Clear
            </button>
          </>
        ) : (
          <span className="text-muted-foreground">Tick clients to email them their questionnaire link.</span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => open({ kind: "selected", ids: [...selected] })}
            disabled={count === 0}
            className={buttonClass("secondary", "sm")}
          >
            <Send className="size-3.5" /> Send link to selected{count ? ` (${n(count)})` : ""}
          </button>
          <button
            type="button"
            onClick={() => open({ kind: "not_profiled" })}
            disabled={notProfiledCount === 0}
            className={buttonClass("secondary", "sm")}
          >
            <Mail className="size-3.5" /> Send to all not profiled ({n(notProfiledCount)})
          </button>
        </div>
      </div>

      <Dialog
        open={target !== null}
        onOpenChange={(o) => {
          // A send in progress finishes before the dialog can close.
          if (!o && !sending) {
            request.current++;
            setTarget(null);
          }
        }}
      >
        <DialogContent className="max-w-lg" showClose={!sending}>
          <DialogHeader>
            <DialogTitle>
              {preview
                ? preview.sendable > 0
                  ? `Email the risk profile link to ${clients(preview.sendable)}?`
                  : "No one here can be emailed yet"
                : target?.kind === "not_profiled"
                  ? "Email every client who is not profiled?"
                  : "Email the selected clients?"}
            </DialogTitle>
            <DialogDescription>
              Each client gets a personal link to the questionnaire. No login needed, valid for 21 days.
            </DialogDescription>
          </DialogHeader>

          {!preview && !loadError && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Checking who will get it…
            </div>
          )}
          {loadError && <p className="mt-4 text-sm text-rose-700">{loadError}</p>}

          {preview && (
            <div className="mt-4 space-y-4 text-sm">
              <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
                <dt className="text-muted-foreground">Channel</dt>
                <dd className="col-span-2 font-medium text-foreground">Email</dd>
                <dt className="text-muted-foreground">{preview.templates.length > 1 ? "Templates" : "Template"}</dt>
                <dd className="col-span-2 space-y-2">
                  {preview.templates.length === 0 && <span className="text-muted-foreground">None: no active client selected.</span>}
                  {preview.templates.map((t) => (
                    <div key={t.key}>
                      <div className="font-medium text-foreground">
                        {t.name}
                        {preview.templates.length > 1 && (
                          <span className="font-normal text-muted-foreground"> · {clients(t.sending)}</span>
                        )}
                      </div>
                      {t.subject && <div className="text-xs text-muted-foreground">Subject: {readable(t.subject)}</div>}
                    </div>
                  ))}
                </dd>
              </dl>

              {(preview.noEmail > 0 || preview.recent > 0 || preview.blocked > 0) && (
                <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                  <div className="mb-1 font-medium text-foreground">Not sent</div>
                  <ul className="space-y-1">
                    {preview.noEmail > 0 && (
                      <li>
                        {clients(preview.noEmail)} with no email on file
                        {preview.noEmailSample.length > 0 && (
                          <> ({preview.noEmailSample.join(", ")}{preview.noEmail > preview.noEmailSample.length ? ", …" : ""})</>
                        )}
                      </li>
                    )}
                    {preview.recent > 0 && (
                      <li>
                        {clients(preview.recent)} already emailed a link in the last {preview.recentDays} days
                      </li>
                    )}
                    {problems.map((t) => (
                      <li key={t.key} className="text-rose-700">
                        {clients(t.blocked)}: {t.problem}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Consent and compliance checks run on every email; anyone who fails them is skipped and logged.
              </p>

              {progress && (
                <div className="space-y-1" role="status" aria-live="polite">
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.round((progress.done / Math.max(1, progress.of)) * 100)}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Sending… {n(progress.done)} of {n(progress.of)}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <button
              type="button"
              onClick={() => {
                request.current++;
                setTarget(null);
              }}
              disabled={sending}
              className={buttonClass("secondary")}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={send}
              disabled={!preview || preview.sendable === 0 || sending}
              className={buttonClass("primary")}
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {preview && preview.sendable > 0 ? `Send ${n(preview.sendable)} ${preview.sendable === 1 ? "email" : "emails"}` : "Send"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
