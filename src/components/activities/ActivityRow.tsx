"use client";

/**
 * A row of the Activity Log that opens the whole entry in a popup. The cells are
 * rendered by the server page and passed through as children; every value in
 * `detail` arrives already formatted for display.
 *
 * Links and buttons inside the row (the client's name, call, WhatsApp) keep
 * doing their own thing.
 */

import { useState } from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { Button, buttonClass } from "@/components/ui/Button";
import { ContactQuickActions } from "@/components/common/ContactQuickActions";
import type { ContactLogSubject } from "@/lib/activities/contact-log";

export type ActivityDetail = {
  /** "Call", "Visit", "Note" … */
  kindLabel: string;
  subject: string | null;
  recordLabel: "Client" | "Lead" | "Family";
  recordName: string;
  recordHref: string;
  phone: string | null;
  message?: string;
  logFor: ContactLogSubject | null;
  /** Label and value pairs; only the facts this entry has. */
  facts: [label: string, value: string][];
  notes: string | null;
};

const INTERACTIVE = "a, button, input, select, [data-no-row-nav]";

export function ActivityRow({ detail, className, children }: { detail: ActivityDetail; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        className={`${className ?? ""} cursor-pointer focus-visible:outline-none focus-visible:bg-secondary/60`}
        tabIndex={0}
        aria-haspopup="dialog"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
          setOpen(true);
        }}
        onKeyDown={(e) => {
          // Only the row itself: Enter on a link inside it follows the link.
          if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
          e.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </tr>
      {/* Renders nothing in the table: the content is portalled to <body>. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="break-words">{detail.subject || detail.kindLabel}</DialogTitle>
            <DialogDescription>
              {detail.subject ? `${detail.kindLabel} · ` : ""}{detail.recordLabel}: {detail.recordName}
            </DialogDescription>
          </DialogHeader>

          <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            {detail.facts.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-4">
            <div className="text-xs font-medium text-muted-foreground mb-1">Notes</div>
            <div className="rounded-md bg-secondary p-3 text-sm whitespace-pre-wrap break-words">
              {detail.notes || <span className="text-muted-foreground">No notes recorded.</span>}
            </div>
          </div>

          {detail.phone && (
            // Closed once the tap has been handled, so the "How did it go?" prompt is not under the popup.
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" onClickCapture={(e) => { if ((e.target as HTMLElement).closest("a")) setTimeout(() => setOpen(false), 0); }}>
              Reach {detail.recordName}
              <ContactQuickActions phone={detail.phone} message={detail.message} logFor={detail.logFor} show={["whatsapp", "call"]} size={16} />
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
            <Link href={detail.recordHref} className={buttonClass("secondary", "md")}>
              Open {detail.recordLabel.toLowerCase()}
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
