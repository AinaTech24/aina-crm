"use client";

/**
 * Follow-through table — who acted on a client-action email, and who to chase.
 *
 * Selection + "Send a reminder" live here; the filtering above is URL-driven on
 * the server so a view stays shareable. The "Opened the link, never finished"
 * filter is the one an RM should work from: those clients tapped the button and
 * got stuck, so a phone call converts them far more often than another email.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Mail, Check, CircleDashed, MousePointerClick, MailOpen, AlertTriangle } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import type { FollowThroughRow, Stage } from "@/lib/comms/follow-through";
import { ACTION_TEMPLATES } from "@/lib/comms/follow-through";
import { formatDate } from "@/lib/format";

const fmt = (v: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : formatDate(d, "dayMonth");
};

const STAGE_META: Record<Stage, { label: string; cls: string; icon: any }> = {
  acted: { label: "Done", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: Check },
  link_opened: { label: "Opened link, not finished", cls: "bg-amber-50 text-amber-700 border-amber-200", icon: MousePointerClick },
  opened: { label: "Opened the email", cls: "bg-sky-50 text-sky-700 border-sky-200", icon: MailOpen },
  delivered: { label: "Delivered, unopened", cls: "bg-secondary text-muted-foreground border-transparent", icon: CircleDashed },
  sent: { label: "Sent", cls: "bg-secondary text-muted-foreground border-transparent", icon: CircleDashed },
  failed: { label: "Didn't reach them", cls: "bg-rose-50 text-rose-700 border-rose-200", icon: AlertTriangle },
  skipped: { label: "Not sent", cls: "bg-rose-50 text-rose-700 border-rose-200", icon: AlertTriangle },
};

export function FollowThroughTable({ rows, canSend }: { rows: FollowThroughRow[]; canSend: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Only chase someone who hasn't finished — reminding a client who already
  // acted is the fastest way to look like you weren't paying attention.
  const chaseable = rows.filter((r) => !r.actedAt && r.stage !== "skipped" && r.stage !== "failed" && r.email);
  const allChosen = chaseable.length > 0 && chaseable.every((r) => sel.has(r.communicationId));

  function toggle(id: string) {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSel(allChosen ? new Set() : new Set(chaseable.map((r) => r.communicationId)));
  }

  async function remind() {
    if (sel.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/communications/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ communicationIds: [...sel] }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        toast.error(j.error ?? `Reminder failed (${res.status})`, "Reminder");
        return;
      }
      const bits = [`${j.sent} reminder${j.sent === 1 ? "" : "s"} sent`];
      if (j.skipped) bits.push(`${j.skipped} skipped (consent / compliance)`);
      if (j.noEmail) bits.push(`${j.noEmail} have no email`);
      if (j.failed?.length) bits.push(`${j.failed.length} failed`);
      toast.success(bits.join(" · "));
      setSel(new Set());
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Reminder");
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="card-surface p-12 text-center">
        <Mail className="size-8 mx-auto text-muted-foreground/40" />
        <div className="mt-2 font-medium">Nothing here yet</div>
        <p className="text-sm text-muted-foreground mt-1">
          Once you send a risk-profile, suitability or feedback email, every client shows up here with what they did next.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {canSend && sel.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/40 px-4 py-2.5 text-sm">
          <span>
            <strong>{sel.size}</strong> selected — they haven&apos;t finished yet
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setSel(new Set())} className="text-xs text-muted-foreground hover:underline">
              Clear
            </button>
            <button type="button" onClick={remind} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1.5">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />} Send a reminder
            </button>
          </div>
        </div>
      )}

      <div className="card-surface overflow-hidden">
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b bg-secondary/30">
              <tr>
                {canSend && (
                  <th className="w-9 px-3 py-2.5">
                    <input type="checkbox" checked={allChosen} onChange={toggleAll} disabled={chaseable.length === 0}
                      aria-label="Select everyone who hasn't finished" className="size-4" />
                  </th>
                )}
                <th className="text-left py-2.5 px-3 font-medium">Client</th>
                <th className="text-left py-2.5 px-3 font-medium">Email sent</th>
                <th className="text-left py-2.5 px-3 font-medium">Sent</th>
                <th className="text-left py-2.5 px-3 font-medium">Opened</th>
                <th className="text-left py-2.5 px-3 font-medium">Tapped the link</th>
                <th className="text-left py-2.5 px-3 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const meta = ACTION_TEMPLATES[r.templateKey];
                const st = STAGE_META[r.stage];
                const Icon = st.icon;
                const chase = !r.actedAt && r.stage !== "skipped" && r.stage !== "failed" && !!r.email;
                return (
                  <tr key={r.communicationId} className="border-b last:border-0 hover:bg-secondary/30">
                    {canSend && (
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={sel.has(r.communicationId)} onChange={() => toggle(r.communicationId)}
                          disabled={!chase} aria-label={`Select ${r.name}`} className="size-3.5 disabled:opacity-30" />
                      </td>
                    )}
                    <td className="py-2.5 px-3">
                      {r.investorId ? (
                        <Link href={`/dashboard/investors/${r.investorId}`} className="font-medium hover:underline">{r.name}</Link>
                      ) : (
                        <span className="font-medium">{r.name}</span>
                      )}
                      {r.rmName && <div className="text-2xs text-muted-foreground">RM {r.rmName}</div>}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground">{meta?.label ?? r.templateKey}</td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">{fmt(r.sentAt)}</td>
                    <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                      {r.openedAt || r.linkOpenedAt || r.actedAt ? (
                        <span className="text-foreground">{fmt(r.openedAt) !== "—" ? fmt(r.openedAt) : "yes"}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                      {r.linkOpenedAt ? (
                        <span className="text-foreground">{fmt(r.linkOpenedAt)}</span>
                      ) : r.hasLink ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="text-muted-foreground/60" title="This send carried no personal link">n/a</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-flex items-center gap-1 text-2xs font-medium rounded-full border px-2 py-0.5 ${st.cls}`}>
                        <Icon className="size-3" />
                        {r.actedAt ? (meta?.action ?? "Done") : st.label}
                      </span>
                      {r.actedAt && <span className="ml-1.5 text-2xs text-muted-foreground">{fmt(r.actedAt)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-2xs text-muted-foreground">
        &ldquo;Opened&rdquo; relies on the mail client loading a tracking pixel, so it under-reports — a client who tapped the
        link but shows as unopened simply blocked images. &ldquo;Tapped the link&rdquo; and the result are recorded by us and
        are exact.
      </p>
    </div>
  );
}
