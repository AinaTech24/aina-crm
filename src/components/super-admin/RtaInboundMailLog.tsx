"use client";

/**
 * Aina Admin → Inbound Mail. The "did the forward actually arrive?" screen.
 *
 * One row per message the RTA mailback poller has seen — routed or not. Expand a
 * row for the body snippet and the per-attachment classification verdict, which
 * is what tells you WHY a mail didn't import (unknown report code vs. wrong
 * address vs. already imported).
 */

import { Fragment, useCallback, useEffect, useState } from "react";
import { formatDate } from "@/lib/format";
import {
  Loader2,
  RefreshCw,
  Search,
  Mail,
  ChevronRight,
  CheckCircle2,
  Copy,
  AlertTriangle,
  XCircle,
  ShieldCheck,
  FileWarning,
  Paperclip,
} from "lucide-react";

type AttachmentLog = {
  filename: string;
  size: number;
  source: string | null;
  kind: string | null;
  outcome: "queued" | "duplicate" | "unrecognised" | "error";
  importId?: string | null;
  reason?: string | null;
};

type Message = {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  messageId: string | null;
  fromAddress: string | null;
  fromName: string | null;
  toAddress: string | null;
  subject: string | null;
  bodySnippet: string | null;
  receivedAt: string | null;
  createdAt: string;
  outcome: string;
  reason: string | null;
  attachmentCount: number;
  queuedCount: number;
  duplicateCount: number;
  attachments: AttachmentLog[];
};

/** Outcome → label, colour, icon. Ordered as the filter strip renders them. */
const OUTCOMES: Record<string, { label: string; cls: string; Icon: typeof Mail; hint: string }> = {
  imported: {
    label: "Imported",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Icon: CheckCircle2,
    hint: "At least one attachment was queued for import.",
  },
  duplicate: {
    label: "Already imported",
    cls: "bg-sky-50 text-sky-700 border-sky-200",
    Icon: Copy,
    hint: "Recognised, but the same file was already being imported. A safe no-op.",
  },
  confirmation: {
    label: "Forwarding confirm",
    cls: "bg-blue-50 text-blue-700 border-blue-200",
    Icon: ShieldCheck,
    hint: "Gmail/Outlook forwarding-confirmation mail — carries no data.",
  },
  no_attachment: {
    label: "No RTA file",
    cls: "bg-amber-50 text-amber-700 border-amber-200",
    Icon: FileWarning,
    hint: "Routed to a firm, but no attachment matched a known CAMS/KFintech report code.",
  },
  unroutable: {
    label: "Unroutable",
    cls: "bg-rose-50 text-rose-700 border-rose-200",
    Icon: AlertTriangle,
    hint: "No firm's forwarding address matched — check for a typo or a rotated address.",
  },
  error: {
    label: "Error",
    cls: "bg-rose-50 text-rose-700 border-rose-200",
    Icon: XCircle,
    hint: "The handler threw while processing this message.",
  },
};

const ATT_TONE: Record<string, string> = {
  queued: "bg-emerald-50 text-emerald-700 border-emerald-200",
  duplicate: "bg-sky-50 text-sky-700 border-sky-200",
  unrecognised: "bg-amber-50 text-amber-700 border-amber-200",
  error: "bg-rose-50 text-rose-700 border-rose-200",
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return formatDate(d, "dateTime");
}
function fmtSize(b: number): string {
  if (!b) return "0 B";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function OutcomeChip({ outcome }: { outcome: string }) {
  const o = OUTCOMES[outcome] ?? {
    label: outcome,
    cls: "bg-muted text-muted-foreground border-border",
    Icon: Mail,
    hint: "",
  };
  const { Icon } = o;
  return (
    <span
      title={o.hint}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium whitespace-nowrap ${o.cls}`}
    >
      <Icon className="size-3" />
      {o.label}
    </span>
  );
}

export function RtaInboundMailLog() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!opts?.quiet) setLoading(true);
      try {
        const p = new URLSearchParams();
        if (filter) p.set("outcome", filter);
        if (q.trim()) p.set("q", q.trim());
        const r = await fetch(`/api/super-admin/rta-inbound-mail?${p}`, { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          setMessages(j.messages ?? []);
          setSummary(j.summary ?? {});
        }
      } catch {
        /* transient — the next poll retries */
      } finally {
        if (!opts?.quiet) setLoading(false);
      }
    },
    [filter, q]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Live tail — the poller runs every ~2 min, so a 20s quiet refresh is enough
  // to watch a test forward land without hammering the endpoint.
  useEffect(() => {
    const id = setInterval(() => void load({ quiet: true }), 20_000);
    return () => clearInterval(id);
  }, [load]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const total = Object.values(summary).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      {/* Health strip — last 30 days at a glance, doubles as the filter. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter("")}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            filter === "" ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"
          }`}
        >
          All · {total}
        </button>
        {Object.entries(OUTCOMES).map(([key, o]) => {
          const n = summary[key] ?? 0;
          return (
            <button
              key={key}
              onClick={() => setFilter(filter === key ? "" : key)}
              title={o.hint}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
                filter === key ? "ring-2 ring-offset-1 ring-primary " + o.cls : n > 0 ? o.cls : "text-muted-foreground"
              }`}
            >
              <o.Icon className="size-3" />
              {o.label} · {n}
            </button>
          );
        })}
        <span className="text-2xs text-muted-foreground ml-1">last 30 days</span>
      </div>

      {/* Search + refresh */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search subject, sender, address, firm…"
            className="w-full rounded-md border pl-8 pr-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh
        </button>
      </div>

      {/* Log */}
      <div className="border rounded-lg bg-card overflow-hidden">
        {loading && messages.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin mx-auto mb-2" />
            Loading inbound mail…
          </div>
        ) : messages.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Mail className="size-6 mx-auto mb-2 opacity-40" />
            No inbound mail{filter || q ? " matches this filter" : " yet"}.
            {!filter && !q && (
              <p className="text-xs mt-1">
                Once a firm forwards their CAMS/KFintech mailback, every message shows up here within ~2 minutes.
              </p>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-8" />
                <th className="text-left font-semibold px-3 py-2">Received</th>
                <th className="text-left font-semibold px-3 py-2">Firm</th>
                <th className="text-left font-semibold px-3 py-2">From</th>
                <th className="text-left font-semibold px-3 py-2">Subject</th>
                <th className="text-left font-semibold px-3 py-2">Files</th>
                <th className="text-left font-semibold px-3 py-2">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => {
                const isOpen = open.has(m.id);
                return (
                  <Fragment key={m.id}>
                    <tr
                      onClick={() => toggle(m.id)}
                      className="border-t cursor-pointer hover:bg-accent/40"
                    >
                      <td className="px-2 py-2.5 text-muted-foreground">
                        <ChevronRight className={`size-4 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-muted-foreground">
                        {fmtWhen(m.receivedAt ?? m.createdAt)}
                      </td>
                      <td className="px-3 py-2.5">
                        {m.tenantName ? (
                          <span className="font-medium">{m.tenantName}</span>
                        ) : (
                          <span className="text-rose-600 text-xs">unrouted</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 max-w-[200px] truncate" title={m.fromAddress ?? ""}>
                        {m.fromAddress ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 max-w-[280px] truncate" title={m.subject ?? ""}>
                        {m.subject || <span className="text-muted-foreground">(no subject)</span>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                        {m.attachmentCount > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <Paperclip className="size-3" />
                            {m.attachmentCount}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <OutcomeChip outcome={m.outcome} />
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="bg-muted/20 border-t">
                        <td />
                        <td colSpan={6} className="px-3 py-3 space-y-3">
                          {/* Routing detail */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                            <div>
                              <span className="text-muted-foreground">Delivered to: </span>
                              <code className="font-mono">{m.toAddress ?? "—"}</code>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Message-ID: </span>
                              <code className="font-mono text-2xs break-all">{m.messageId ?? "—"}</code>
                            </div>
                            {m.reason && (
                              <div className="sm:col-span-2">
                                <span className="text-muted-foreground">Reason: </span>
                                {m.reason}
                              </div>
                            )}
                          </div>

                          {/* Per-attachment verdicts — the "why didn't it import?" answer */}
                          {m.attachments.length > 0 && (
                            <div>
                              <div className="text-xs font-medium text-muted-foreground mb-1">Attachments</div>
                              <ul className="space-y-1">
                                {m.attachments.map((a, i) => (
                                  <li key={i} className="flex items-center gap-2 text-xs flex-wrap">
                                    <code className="font-mono bg-background border rounded px-1.5 py-0.5 break-all">
                                      {a.filename}
                                    </code>
                                    <span className="text-muted-foreground">{fmtSize(a.size)}</span>
                                    {a.source && (
                                      <span className="uppercase font-semibold text-2xs text-muted-foreground">
                                        {a.source}
                                      </span>
                                    )}
                                    {a.kind && <span className="text-muted-foreground">{a.kind.replace(/_/g, " ")}</span>}
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-2xs font-medium ${
                                        ATT_TONE[a.outcome] ?? "bg-muted text-muted-foreground border-border"
                                      }`}
                                    >
                                      {a.outcome}
                                    </span>
                                    {a.reason && <span className="text-muted-foreground italic">{a.reason}</span>}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Body snippet — the actual mail content */}
                          {m.bodySnippet && (
                            <div>
                              <div className="text-xs font-medium text-muted-foreground mb-1">Message body (first 2000 chars)</div>
                              <pre className="text-2xs bg-background border rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">
                                {m.bodySnippet}
                              </pre>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
