"use client";

/**
 * QuickCreateFab — floating action button (bottom-right) that opens a
 * pop-up menu of the most common "create" actions. One click from anywhere
 * in the app to add a lead, client, task, meeting, or proposal.
 *
 * Big win for non-technical users: they don't have to memorise where each
 * "+ New" button lives. Hidden when the user is on a public form page or
 * when print is active (handled by the layout's `print:hidden`).
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Plus,
  Sparkles,
  Users,
  ListChecks,
  Calendar,
  FileSignature,
  X,
  Phone,
  PhoneCall,
} from "lucide-react";
import { openLogActivity } from "@/lib/activities/contact-log";

const ACTIONS: Array<{ href: string; label: string; sub: string; icon: typeof Plus; tone: string; logActivity?: boolean }> = [
  {
    // Opens the Log activity drawer in place (ActivityLauncher).
    href: "#log-call",
    label: "Log a Call",
    sub: "Call, WhatsApp, visit or note",
    icon: PhoneCall,
    tone: "emerald",
    logActivity: true,
  },
  {
    href: "/dashboard/leads/new",
    label: "Add Lead",
    sub: "Someone interested in your services",
    icon: Sparkles,
    tone: "cyan",
  },
  {
    href: "/dashboard/investors/new",
    label: "Add Client",
    sub: "Existing investor (after KYC)",
    icon: Users,
    tone: "violet",
  },
  {
    href: "/dashboard/tasks/new",
    label: "Add Task",
    sub: "Reminder for yourself or a teammate",
    icon: ListChecks,
    tone: "amber",
  },
  {
    href: "/dashboard/review-meetings/new",
    label: "Schedule Meeting",
    sub: "Review, fresh meeting, or follow-up",
    icon: Calendar,
    tone: "emerald",
  },
  {
    href: "/dashboard/proposals/new",
    label: "Create Proposal",
    sub: "Branded PDF for a client",
    icon: FileSignature,
    tone: "indigo",
  },
  {
    href: "/dashboard/service-requests/new",
    label: "Log Service Request",
    sub: "Track a client's query / problem",
    icon: Phone,
    tone: "rose",
  },
];

const TONE_BG: Record<string, string> = {
  cyan: "bg-brand-cyan-light text-brand-cyan-deep",
  violet: "bg-purple-50 text-purple-700",
  amber: "bg-amber-50 text-amber-700",
  emerald: "bg-emerald-50 text-emerald-700",
  indigo: "bg-indigo-50 text-indigo-700",
  rose: "bg-destructive/10 text-destructive",
};

export function QuickCreateFab() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  // Only on the dashboards, and only on phones: on a desktop the top bar's
  // "+ Add" is the one create entry (dashboard cleanup D3), and the floating
  // button sat over the page's own links. Elsewhere each module has its own
  // "+ New", so the floating button is just clutter.
  const onDashboards =
    pathname === "/dashboard" ||
    /^\/dashboard\/[0-9a-f-]{36}$/i.test(pathname) ||
    pathname.startsWith("/dashboard/team");

  // Click-outside + Esc to close
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!onDashboards) return null;

  return (
    <div ref={ref} className="fixed bottom-6 right-6 z-40 print:hidden flex flex-col items-end md:hidden">
      {open && (
        <div className="mb-3 w-72 rounded-2xl bg-card border border-border shadow-2xl overflow-hidden animate-fade-in">
          <div className="px-4 py-3 border-b border-border/70 bg-gradient-to-br from-brand-navy to-brand-cyan-deep">
            <div className="text-white text-sm font-semibold">Quick create</div>
            <div className="text-white/70 text-2xs">
              Pick what you want to add. We&apos;ll guide you through the rest.
            </div>
          </div>
          <ul className="py-1 max-h-[60vh] overflow-y-auto">
            {ACTIONS.map((a) => {
              const Icon = a.icon;
              return (
                <li key={a.href}>
                  {a.logActivity ? (
                    <button
                      type="button"
                      onClick={() => { setOpen(false); openLogActivity("call"); }}
                      className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-secondary/70 transition-colors"
                    >
                      <FabItemBody icon={Icon} tone={a.tone} label={a.label} sub={a.sub} />
                    </button>
                  ) : (
                    <Link
                      href={a.href}
                      onClick={() => setOpen(false)}
                      className="flex items-start gap-3 px-3 py-2.5 hover:bg-secondary/70 transition-colors"
                    >
                      <FabItemBody icon={Icon} tone={a.tone} label={a.label} sub={a.sub} />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <button
        type="button"
        data-tour="quick-create"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close quick create menu" : "Open quick create menu"}
        className="size-14 rounded-full brand-gradient text-white grid place-items-center shadow-2xl hover:scale-105 active:scale-95 transition-transform ring-4 ring-white"
      >
        {open ? <X className="size-6" /> : <Plus className="size-6" />}
      </button>
    </div>
  );
}

function FabItemBody({ icon: Icon, tone, label, sub }: { icon: typeof Plus; tone: string; label: string; sub: string }) {
  return (
    <>
      <div className={`size-9 rounded-lg grid place-items-center flex-shrink-0 ${TONE_BG[tone]}`}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium leading-tight">{label}</div>
        <div className="text-2xs text-muted-foreground mt-0.5 leading-snug">{sub}</div>
      </div>
    </>
  );
}
