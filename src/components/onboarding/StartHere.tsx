"use client";

/**
 * "Start here" — a new firm's first three moves, in order: import the clients
 * (the ONE primary action), invite the team, book the free onboarding call.
 * Shown on the setup wizard's last step and on /dashboard/welcome, where the
 * wizard lands. With `onGo`, the two in-app steps are buttons (the wizard must
 * first record that setup is complete); without it, plain links.
 */

import Link from "next/link";
import { ArrowRight, CalendarCheck, FileUp, UserPlus } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/Button";
import { IMPORT_CLIENTS_HREF, IMPORT_EXCEL_HREF, INVITE_TEAM_HREF } from "@/lib/onboarding/messages";
import { cn } from "@/lib/utils";

export function StartHere({ callUrl, onGo, busyHref }: { callUrl: string; onGo?: (href: string) => void; busyHref?: string | null }) {
  const go = (href: string, label: string, variant: "primary" | "secondary", icon: React.ReactNode) =>
    onGo ? (
      <Button variant={variant} icon={icon} loading={busyHref === href} disabled={!!busyHref && busyHref !== href} onClick={() => onGo(href)}>
        {label}
      </Button>
    ) : (
      <Link href={href} className={buttonClass(variant)}>
        {icon}
        {label}
      </Link>
    );

  return (
    <ol className="space-y-3 text-left" aria-label="Start here">
      <Step n={1} title="Import your clients" body="Upload your CAMS / KFintech mailback files — we build the client book, folios and SIPs from them.">
        {go(IMPORT_CLIENTS_HREF, "Import your clients", "primary", <FileUp className="size-4" aria-hidden />)}
        <span className="text-xs text-muted-foreground">
          Or{" "}
          {onGo ? (
            <button type="button" className="text-primary underline" disabled={!!busyHref} onClick={() => onGo(IMPORT_EXCEL_HREF)}>
              from an Excel sheet
            </button>
          ) : (
            <Link className="text-primary underline" href={IMPORT_EXCEL_HREF}>
              from an Excel sheet
            </Link>
          )}
        </span>
      </Step>
      <Step n={2} title="Invite your team" body="RMs and back office get their own sign-in, tasks and client lists.">
        {go(INVITE_TEAM_HREF, "Invite your team", "secondary", <UserPlus className="size-4" aria-hidden />)}
      </Step>
      <Step n={3} title="Book your free onboarding call" body="We walk you through the CRM and help you set it up.">
        <a href={callUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost")}>
          <CalendarCheck className="size-4" aria-hidden /> Book your call <ArrowRight className="size-4" aria-hidden />
        </a>
      </Step>
    </ol>
  );
}

function Step({ n, title, body, children }: { n: number; title: string; body: string; children: React.ReactNode }) {
  return (
    <li className={cn("flex gap-3 rounded-xl border border-border bg-card p-4", n === 1 && "border-primary/30 bg-primary/5")}>
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-sm font-semibold" aria-hidden>
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{children}</div>
      </div>
    </li>
  );
}
