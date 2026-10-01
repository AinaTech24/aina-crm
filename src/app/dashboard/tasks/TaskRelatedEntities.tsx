"use client";

/**
 * The task's Related section: which client, lead, meeting and service request
 * it is about — and, for anyone who may edit the task, linking and unlinking
 * them.
 *
 * It reads GET /api/tasks/[id]/related, which follows BOTH links a task has to
 * a client or lead (the related_* columns and the automation's subject), so a
 * SIP-rejection follow-up no longer says "No entities linked". A link that
 * came from the automation is shown as fixed: the work it tracks is keyed to
 * that record. Picking a record searches with the palette's /api/search, so
 * it offers only clients and leads this user may see; the PATCH checks again.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Calendar, LifeBuoy, Loader2, Lock, Plus, Search, Sparkles, User, X } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
import { useToast } from "@/components/ui/Toast";
import { formatDate, humanise } from "@/lib/format";

type Kind = "client" | "lead" | "meeting" | "request";
type LinkRow = { kind: Kind; id: string; name: string; sub?: string | null; href: string; fixed: boolean };

/** The task column each kind is stored in. */
const FIELD: Record<Kind, string> = {
  client: "relatedInvestorId",
  lead: "relatedLeadId",
  meeting: "relatedMeetingId",
  request: "relatedServiceRequestId",
};
const LABEL: Record<Kind, string> = { client: "Client", lead: "Lead", meeting: "Meeting", request: "Service request" };
const ICON: Record<Kind, typeof User> = { client: User, lead: Sparkles, meeting: Calendar, request: LifeBuoy };

type Hit = { kind: Kind; id: string; name: string; sub?: string };

export function TaskRelatedEntities({ taskId, onChanged }: { taskId: string; onChanged?: () => void }) {
  const toast = useToast();
  const [links, setLinks] = useState<LinkRow[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/tasks/${taskId}/related`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Could not load the related records");
      setLinks(j.links ?? []);
      setCanEdit(!!j.canEdit);
    } catch {
      setLinks([]);
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  // Search clients, leads, meetings and service requests as the user types.
  useEffect(() => {
    if (!picking || q.trim().length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        const out: Hit[] = [
          ...(j.investors ?? []).map((x: any) => ({ kind: "client" as const, id: x.id, name: x.name, sub: x.rm_name ? `RM ${x.rm_name}` : undefined })),
          ...(j.leads ?? []).map((x: any) => ({ kind: "lead" as const, id: x.id, name: x.name, sub: x.stage ? humanise(x.stage) : undefined })),
          ...(j.meetings ?? []).map((x: any) => ({
            kind: "meeting" as const, id: x.id,
            name: x.subject || `${humanise(x.category ?? "meeting")} with ${x.person_name ?? "—"}`,
            sub: x.meeting_date ? formatDate(x.meeting_date) : undefined,
          })),
          ...(j.serviceRequests ?? []).map((x: any) => ({ kind: "request" as const, id: x.id, name: x.subject, sub: x.ticket_no ?? undefined })),
        ];
        setHits(out);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, picking]);

  async function save(kind: Kind, id: string | null, key: string) {
    setBusy(key);
    try {
      const r = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [FIELD[kind]]: id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Could not update the task");
      toast.success(id ? `${LABEL[kind]} linked` : `${LABEL[kind]} unlinked`);
      setPicking(false);
      setQ("");
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update the task", "Not saved");
    } finally {
      setBusy(null);
    }
  }

  const explicit = (kind: Kind) => (links ?? []).some((l) => l.kind === kind && !l.fixed);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-2xs uppercase font-bold text-muted-foreground">Related</h4>
        {canEdit && !picking && (
          <button type="button" onClick={() => setPicking(true)} className={buttonClass("ghost", "sm", "gap-1")}>
            <Plus className="size-3.5" /> Link a record
          </button>
        )}
      </div>

      {links === null ? (
        <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </div>
      ) : links.length === 0 && !picking ? (
        <p className="rounded-lg bg-secondary px-3 py-3 text-center text-xs text-muted-foreground">
          Not linked to a client, lead, meeting or service request yet.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {links.map((l) => {
            const Icon = ICON[l.kind];
            const key = `${l.kind}:${l.id}`;
            return (
              <li key={key} className="flex items-center gap-2.5 rounded-lg border border-border p-2.5">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <Link href={l.href} className="min-w-0 flex-1 hover:underline">
                  <div className="truncate text-xs font-medium">{l.name}</div>
                  {l.sub && (
                    <div className="truncate text-2xs text-muted-foreground">
                      {l.kind === "meeting" ? formatDate(l.sub) : l.kind === "lead" ? humanise(l.sub) : l.sub}
                    </div>
                  )}
                </Link>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-2xs font-semibold text-muted-foreground">{LABEL[l.kind]}</span>
                {l.fixed ? (
                  <span className="shrink-0 text-muted-foreground" title="Set by the automation that created this task, which tracks this record. It cannot be unlinked here.">
                    <Lock className="size-3.5" />
                  </span>
                ) : canEdit ? (
                  <button
                    type="button"
                    onClick={() => save(l.kind, null, key)}
                    disabled={!!busy}
                    className={buttonClass("ghost", "icon")}
                    aria-label={`Unlink ${LABEL[l.kind].toLowerCase()} ${l.name}`}
                    title="Unlink"
                  >
                    {busy === key ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {picking && (
        <div className="space-y-2 rounded-lg border border-border p-2.5">
          <div className="flex items-center gap-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search a client, lead, meeting or service request…"
              aria-label="Search a record to link"
              className="w-full bg-transparent text-xs outline-none"
            />
            {searching && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
            <button type="button" onClick={() => { setPicking(false); setQ(""); }} className={buttonClass("ghost", "sm")}>
              Cancel
            </button>
          </div>
          {q.trim().length >= 2 && !searching && hits.length === 0 && (
            <p className="px-1 py-2 text-xs text-muted-foreground">Nothing found for “{q.trim()}”.</p>
          )}
          {hits.length > 0 && (
            <ul className="max-h-64 space-y-0.5 overflow-y-auto">
              {hits.map((h) => {
                const Icon = ICON[h.kind];
                const key = `pick:${h.kind}:${h.id}`;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => save(h.kind, h.id, key)}
                      disabled={!!busy}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-secondary"
                    >
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{h.name}</span>
                        {h.sub && <span className="block truncate text-2xs text-muted-foreground">{h.sub}</span>}
                      </span>
                      <span className="shrink-0 text-2xs text-muted-foreground">
                        {explicit(h.kind) ? `Replace ${LABEL[h.kind].toLowerCase()}` : LABEL[h.kind]}
                      </span>
                      {busy === key && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
