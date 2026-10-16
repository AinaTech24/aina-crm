"use client";

/**
 * "Request form" on the Service Requests page — opens a pop-up with the firm's
 * service request link, ready to send to a client (copy, WhatsApp, email).
 * What the client fills in arrives in the list below as an open request.
 * Link and on/off: GET/PATCH /api/service-requests/website-form; the full page
 * (website code, replace the link) is /dashboard/service-requests/website-form.
 */

import { useState } from "react";
import Link from "next/link";
import { Copy, ExternalLink, Mail, MessageCircle, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { buttonClass } from "@/components/ui/button-class";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { notify } from "@/components/ui/Toast";

type LinkInfo = { token: string; enabled: boolean; firmName: string };

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify.success(`${what} copied.`);
  } catch {
    notify.error("Couldn't copy — select the text and copy it yourself.");
  }
}

export function ServiceFormShareButton() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(false);

  async function show() {
    setOpen(true);
    if (info) return;
    setLoading(true);
    try {
      const res = await fetch("/api/service-requests/website-form");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(j.error ?? "Couldn't get the form link. Please try again.");
        setOpen(false);
        return;
      }
      setInfo(j);
    } finally {
      setLoading(false);
    }
  }

  const url = info ? `${window.location.origin}/service-request/${info.token}` : "";
  const message = info
    ? `Hello, to request a service from ${info.firmName} (statement, nominee or bank update, redemption and more), please fill in this form: ${url}\nYou will get a service ID for your request.`
    : "";

  return (
    <>
      <Button variant="secondary" icon={<ClipboardList className="size-4" aria-hidden />} onClick={show}>
        Request form
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send the service request form</DialogTitle>
            <DialogDescription>
              Send this link to a client. What they fill in appears here as an open request with its own ticket number.
            </DialogDescription>
          </DialogHeader>

          {loading || !info ? (
            <p className="mt-5 text-sm text-muted-foreground">Getting your link…</p>
          ) : (
            <div className="mt-4 space-y-4">
              {!info.enabled && (
                <p className="rounded-lg border border-warning/50 bg-warning/5 px-3 py-2 text-sm">
                  The form is switched off, so clients who open it are asked to contact you directly.{" "}
                  <Link href="/dashboard/service-requests/website-form" className="underline">
                    Switch it on
                  </Link>
                </p>
              )}

              <div className="space-y-1.5">
                <label htmlFor="srf-link" className="text-xs font-medium text-muted-foreground">
                  Form link
                </label>
                <div className="flex gap-2">
                  <input
                    id="srf-link"
                    readOnly
                    value={url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="input-base min-w-0 flex-1 font-mono text-xs"
                  />
                  <Button variant="primary" icon={<Copy className="size-4" aria-hidden />} onClick={() => copy(url, "Link")}>
                    Copy link
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="srf-message" className="text-xs font-medium text-muted-foreground">
                  Message
                </label>
                <textarea
                  id="srf-message"
                  readOnly
                  value={message}
                  rows={4}
                  onFocus={(e) => e.currentTarget.select()}
                  className="input-base w-full resize-none text-sm"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(message)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClass("secondary")}
                >
                  <MessageCircle className="size-4" aria-hidden /> WhatsApp
                </a>
                <a
                  href={`mailto:?subject=${encodeURIComponent(`Service request form — ${info.firmName}`)}&body=${encodeURIComponent(message)}`}
                  className={buttonClass("secondary")}
                >
                  <Mail className="size-4" aria-hidden /> Email
                </a>
                <Button variant="secondary" icon={<Copy className="size-4" aria-hidden />} onClick={() => copy(message, "Message")}>
                  Copy message
                </Button>
                <a href={url} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost")}>
                  <ExternalLink className="size-4" aria-hidden /> Open form
                </a>
              </div>

              <p className="text-xs text-muted-foreground">
                Website code, switching the form off and replacing the link are on the{" "}
                <Link href="/dashboard/service-requests/website-form" className="underline">
                  form settings page
                </Link>
                .
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
