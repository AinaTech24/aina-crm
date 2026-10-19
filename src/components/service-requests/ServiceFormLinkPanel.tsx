"use client";

/**
 * The firm's service request link — copy it, send it to a client by WhatsApp or
 * email, put it on the website, and (with service_request.manage) switch it off
 * or replace it.
 * Page: /dashboard/service-requests/website-form. API: PATCH /api/service-requests/website-form.
 */

import { useState } from "react";
import { Copy, ExternalLink, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { buttonClass } from "@/components/ui/button-class";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify.success(`${what} copied.`);
  } catch {
    notify.error("Couldn't copy — select the text and copy it yourself.");
  }
}

export function ServiceFormLinkPanel({
  origin,
  token: initialToken,
  enabled: initialEnabled,
  canManage,
  firmName,
}: {
  origin: string;
  token: string;
  enabled: boolean;
  canManage: boolean;
  firmName: string;
}) {
  const [token, setToken] = useState(initialToken);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState<"toggle" | "replace" | null>(null);

  const url = `${origin}/service-request/${token}`;
  const message = `Hello, to request a service from ${firmName} (statement, nominee or bank update, redemption and more), please fill in this form: ${url}\nYou will get a service ID for your request.`;
  const linkSnippet = `<a href="${url}" target="_blank" rel="noopener">Request a service</a>`;
  const frameSnippet = `<iframe src="${url}" title="Request a service" style="width:100%;min-height:900px;border:0"></iframe>`;

  async function act(action: "enable" | "disable" | "replace") {
    setBusy(action === "replace" ? "replace" : "toggle");
    try {
      const res = await fetch("/api/service-requests/website-form", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(j.error ?? "That didn't work. Please try again.");
        return;
      }
      setToken(j.token);
      setEnabled(j.enabled);
      notify.success(
        action === "replace"
          ? "New link ready. Send the new link from now on — the old one no longer works."
          : action === "enable"
            ? "The form is taking requests again."
            : "The form has stopped taking requests.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function replace() {
    const ok = await confirmDialog({
      title: "Replace the link?",
      message: "The current link stops working at once, for everyone you have already sent it to. You'll need to send the new link.",
      confirmLabel: "Replace link",
      tone: "danger",
    });
    if (ok) await act("replace");
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <CardHeader
          title="Your service request link"
          action={<Badge tone={enabled ? "success" : "neutral"}>{enabled ? "Taking requests" : "Switched off"}</Badge>}
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            readOnly
            value={url}
            aria-label="Service request form link"
            onFocus={(e) => e.currentTarget.select()}
            className="input-base min-w-0 flex-1 font-mono text-xs"
          />
          <Button variant="primary" icon={<Copy className="size-4" aria-hidden />} onClick={() => copy(url, "Link")}>
            Copy link
          </Button>
          <a href={url} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary")}>
            <ExternalLink className="size-4" aria-hidden /> Open form
          </a>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <CardHeader title="Send it to a client" />
        <textarea
          readOnly
          value={message}
          rows={3}
          aria-label="Message to send"
          onFocus={(e) => e.currentTarget.select()}
          className="input-base w-full resize-none text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Copy className="size-4" aria-hidden />} onClick={() => copy(message, "Message")}>
            Copy message
          </Button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass("secondary")}
          >
            <MessageCircle className="size-4" aria-hidden /> Send on WhatsApp
          </a>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <CardHeader title="Add it to your website" />
        <Snippet label="As a link or button" code={linkSnippet} />
        <Snippet label="As the form itself, inside your page" code={frameSnippet} />
      </Card>

      {canManage && (
        <Card className="space-y-3 p-5">
          <CardHeader title="Manage the link" />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={busy === "toggle"} disabled={busy !== null} onClick={() => act(enabled ? "disable" : "enable")}>
              {enabled ? "Stop taking requests" : "Start taking requests"}
            </Button>
            <Button variant="ghost" loading={busy === "replace"} disabled={busy !== null} onClick={replace}>
              Replace the link
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Switched off, the link tells visitors to contact you directly. Replace it only if it is being misused: the old
            link stops working at once.
          </p>
        </Card>
      )}
    </div>
  );
}

function Snippet({ label, code }: { label: string; code: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Button variant="ghost" size="sm" icon={<Copy className="size-3.5" aria-hidden />} onClick={() => copy(code, "Code")}>
          Copy code
        </Button>
      </div>
      <textarea
        readOnly
        value={code}
        rows={2}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="input-base w-full resize-none font-mono text-xs"
      />
    </div>
  );
}
