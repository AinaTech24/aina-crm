"use client";

/**
 * "+ New automation" — the page's one primary action. Opens a gallery of the
 * four recipes most firms start with; "Build from scratch" sits at the bottom
 * for everything else. A recipe is added switched OFF and opens in the editor,
 * so nothing reaches a client until someone has reviewed it and turned it on
 * (POST /api/workflow-rules/library/activate, as the full library does).
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Cake, Loader2, Mail, Plus, RotateCcw, CalendarClock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { buttonClass } from "@/components/ui/button-class";
import { notify } from "@/components/ui/Toast";

/** The four starting points, in the order people reach for them. */
const FEATURED: Array<{ key: string; title: string; blurb: string; icon: LucideIcon }> = [
  {
    key: "client_birthday_wish",
    title: "Birthday wish",
    blurb: "Email every active client a birthday greeting on the day, every year.",
    icon: Cake,
  },
  {
    key: "new_client_welcome_email",
    title: "Welcome email",
    blurb: "Welcome each new client by email as soon as they are added.",
    icon: Mail,
  },
  {
    key: "sip_rejection_followup",
    title: "SIP bounce follow-up",
    blurb: "When a SIP bounces, give the client's RM a high-priority task to recover it.",
    icon: RotateCcw,
  },
  {
    key: "review_meeting_due",
    title: "Review reminder",
    blurb: "Create a task for the RM on each client's next review date.",
    icon: CalendarClock,
  },
];

export function NewAutomationButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function use(key: string) {
    setBusy(key);
    setNote(null);
    try {
      const res = await fetch("/api/workflow-rules/library/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setNote("You already have this automation. Find it in the Rules list.");
        return;
      }
      if (!res.ok) {
        setNote(j.error ?? "Couldn't add it. Please try again.");
        return;
      }
      notify.success("Added, switched off. Review it, pick your message, then turn it on.");
      setOpen(false);
      router.push(`/dashboard/workflows/rules/${j.id}`);
    } catch {
      setNote("Network error. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button type="button" onClick={() => { setNote(null); setOpen(true); }} className={buttonClass("primary")}>
        <Plus className="size-4" /> New automation
      </button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-2xl" showClose={!busy}>
          <DialogHeader>
            <DialogTitle>New automation</DialogTitle>
            <DialogDescription>
              Start from a recipe. It&apos;s added switched off, so you can check the message before anything is sent.
            </DialogDescription>
          </DialogHeader>

          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {FEATURED.map((r) => {
              const Icon = r.icon;
              return (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={() => use(r.key)}
                    disabled={!!busy}
                    className="flex h-full w-full items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-secondary/60 disabled:opacity-60"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-secondary">
                      {busy === r.key ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Icon className="size-4 text-muted-foreground" aria-hidden />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-foreground">{r.title}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{r.blurb}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {note && <p className="mt-3 text-sm text-foreground">{note}</p>}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm">
            <Link href="/dashboard/workflows/rules/library" className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">
              See all recipes <ArrowRight className="size-3.5" aria-hidden />
            </Link>
            <Link href="/dashboard/workflows/rules/new" className={buttonClass("secondary", "sm")}>
              Build from scratch
            </Link>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
