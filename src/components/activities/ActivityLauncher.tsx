"use client";

/**
 * ActivityLauncher — mounted once in the dashboard layout. Two jobs:
 *
 * 1. "How did the call go?" — when the RM taps a Call / WhatsApp / SMS / Email
 *    launcher that carries `contactLogAttrs(...)` (or a window.open launcher
 *    calls `announceContact`), a small card asks one question with tap
 *    answers. One tap logs the activity, which is what moves the client's last
 *    contact, health and the "no contact in N days" lists. "Add details" opens
 *    the full drawer; × lets it go. The card survives a reload for two hours
 *    (sessionStorage), because a tel: link on a phone browser can leave the page.
 *
 * 2. The global "Log a call" — Ctrl/Cmd+K, "+ Add" and the mobile "+" button
 *    dispatch LOG_ACTIVITY_EVENT and this opens the drawer with a client /
 *    lead picker, so logging never starts with "first find the client page".
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Phone, MessageCircle, Mail, MessageSquare, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { notify } from "@/components/ui/Toast";
import { LogActivityDrawer } from "@/components/activities/ActivityLogger";
import {
  CONTACT_LAUNCHED_EVENT,
  LOG_ACTIVITY_EVENT,
  OUTCOMES,
  QUESTION,
  activityBody,
  channelForHref,
  type ContactChannel,
  type ContactLaunched,
  type ContactOutcome,
} from "@/lib/activities/contact-log";

const STORE_KEY = "aina.contactLog.pending";
const KEEP_MS = 2 * 60 * 60 * 1000;

type Pending = ContactLaunched & { at: number; key: string };

const ICON: Record<ContactChannel, typeof Phone> = {
  call: Phone,
  whatsapp: MessageCircle,
  sms: MessageSquare,
  email: Mail,
};

function newKey(): string {
  try {
    return `contact-${crypto.randomUUID()}`;
  } catch {
    return `contact-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function save(p: Pending | null) {
  try {
    if (p) sessionStorage.setItem(STORE_KEY, JSON.stringify(p));
    else sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* private window / blocked storage: the card still works for this page */
  }
}

function restore(): Pending | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pending;
    if (!p?.id || !p.channel || Date.now() - Number(p.at) > KEEP_MS) return null;
    return p;
  } catch {
    return null;
  }
}

export function ActivityLauncher() {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<null | { kind: string; status?: string; subject?: { type: "investor" | "lead"; id: string; name: string } }>(null);

  const launch = useCallback((c: ContactLaunched) => {
    const p: Pending = { ...c, at: Date.now(), key: newKey() };
    setPending(p);
    save(p);
  }, []);

  const clear = useCallback(() => {
    setPending(null);
    save(null);
  }, []);

  useEffect(() => {
    const restored = restore();
    if (restored) setPending(restored);

    // Any launcher <a> carrying data-log-id. Capture phase, so a launcher
    // inside a row that stops propagation is still seen; never preventDefault.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[data-log-id]") as HTMLAnchorElement | null;
      if (!a) return;
      const channel = channelForHref(a.getAttribute("href"));
      const type = a.dataset.logType;
      const id = a.dataset.logId;
      if (!channel || !id || (type !== "investor" && type !== "lead")) return;
      launch({ type, id, name: a.dataset.logName || "this client", channel });
    };
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent<ContactLaunched>).detail;
      if (d?.id && d.channel) launch(d);
    };
    const onOpen = (e: Event) => {
      const kind = (e as CustomEvent<{ kind?: string }>).detail?.kind ?? "call";
      setDrawer({ kind });
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener(CONTACT_LAUNCHED_EVENT, onAnnounce);
    window.addEventListener(LOG_ACTIVITY_EVENT, onOpen);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(CONTACT_LAUNCHED_EVENT, onAnnounce);
      window.removeEventListener(LOG_ACTIVITY_EVENT, onOpen);
    };
  }, [launch]);

  async function answer(o: ContactOutcome) {
    if (!pending) return;
    setBusy(o.key);
    try {
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": pending.key },
        body: JSON.stringify(activityBody(pending, o)),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        notify.error(j.error ?? "Could not log it. Try Add details.");
        return;
      }
      notify.success(`${o.label} — logged for ${pending.name}.`);
      clear();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  function details() {
    if (!pending) return;
    const first = OUTCOMES[pending.channel][0];
    setDrawer({
      kind: pending.channel,
      status: pending.channel === "call" ? "" : first.status,
      subject: { type: pending.type, id: pending.id, name: pending.name },
    });
    clear();
  }

  const Icon = pending ? ICON[pending.channel] : null;
  const first = pending ? pending.name.split(/\s+/)[0] || pending.name : "";

  return (
    <>
      {pending && Icon && (
        <div
          role="dialog"
          aria-live="polite"
          aria-label="Log this contact"
          className="fixed inset-x-4 bottom-24 z-50 rounded-xl border border-border bg-card p-3 shadow-xl print:hidden md:inset-x-auto md:bottom-6 md:right-6 md:w-96"
        >
          <div className="flex items-start gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium leading-snug">{QUESTION[pending.channel](first)}</div>
              <div className="mt-0.5 text-2xs text-muted-foreground">One tap logs it on {pending.type === "lead" ? "the lead" : "the client"}.</div>
            </div>
            <button type="button" onClick={clear} className="btn-icon shrink-0" aria-label="Not now" title="Not now">
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {OUTCOMES[pending.channel].map((o, idx) => (
              <Button
                key={o.key}
                size="sm"
                variant={idx === 0 ? "primary" : "secondary"}
                loading={busy === o.key}
                disabled={!!busy}
                onClick={() => answer(o)}
              >
                {o.label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={details} icon={<NotebookPen className="size-3.5" aria-hidden />}>
              Add details
            </Button>
          </div>
        </div>
      )}
      {drawer && (
        <LogActivityDrawer
          subject={drawer.subject}
          initialKind={drawer.kind}
          initialStatus={drawer.status ?? ""}
          onClose={() => setDrawer(null)}
        />
      )}
    </>
  );
}
