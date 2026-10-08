"use client";

/**
 * The firm's public feedback link — copy it, put it on the website or in an
 * email signature, and (owner / compliance) switch it off or replace it.
 * Page: /dashboard/support/feedback/website-form. API: PATCH /api/feedback/website-form.
 */

import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
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

/** Copy as formatted text, so Gmail / Outlook paste a clickable link into a signature. */
async function copyRich(html: string, plain: string) {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
    } else {
      await navigator.clipboard.writeText(plain);
    }
    notify.success("Copied — paste it into your email signature.");
  } catch {
    notify.error("Couldn't copy — select the text and copy it yourself.");
  }
}

export function FeedbackFormLinkPanel({
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

  const url = `${origin}/feedback/${token}`;
  const linkSnippet = `<a href="${url}" target="_blank" rel="noopener">Share your feedback</a>`;
  const frameSnippet = `<iframe src="${url}" title="Share your feedback" style="width:100%;min-height:1100px;border:0"></iframe>`;
  const signatureHtml = `<a href="${url}" target="_blank" rel="noopener" style="color:#1d4ed8;text-decoration:underline">How are we doing? Share your feedback with ${firmName}</a>`;
  const signaturePlain = `How are we doing? Share your feedback: ${url}`;

  async function act(action: "enable" | "disable" | "replace") {
    setBusy(action === "replace" ? "replace" : "toggle");
    try {
      const res = await fetch("/api/feedback/website-form", {
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
          ? "New link ready. Update your website and email signatures — the old one no longer works."
          : action === "enable"
            ? "The link is taking feedback again."
            : "The link has stopped taking feedback.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function replace() {
    const ok = await confirmDialog({
      title: "Replace the link?",
      message:
        "The current link stops working at once, wherever it is published — your website and everyone's email signature. You'll need to put the new link in their place.",
      confirmLabel: "Replace link",
      tone: "danger",
    });
    if (ok) await act("replace");
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <CardHeader
          title="Your feedback link"
          action={<Badge tone={enabled ? "success" : "neutral"}>{enabled ? "Taking feedback" : "Switched off"}</Badge>}
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            readOnly
            value={url}
            aria-label="Feedback form link"
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
        <CardHeader
          title="Add it to your email signature"
        />
        <div className="rounded-lg bg-secondary/70 px-4 py-3 text-sm">
          {/* What the signature line looks like. */}
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
            How are we doing? Share your feedback with {firmName}
          </a>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Copy className="size-4" aria-hidden />} onClick={() => copyRich(signatureHtml, signaturePlain)}>
            Copy for email signature
          </Button>
          <Button variant="ghost" icon={<Copy className="size-4" aria-hidden />} onClick={() => copy(signaturePlain, "Text")}>
            Copy as plain text
          </Button>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <CardHeader
          title="Add it to your website"
        />
        <Snippet label="As a link or button" code={linkSnippet} />
        <Snippet label="As the form itself, inside your page" code={frameSnippet} />
      </Card>

      {canManage && (
        <Card className="space-y-3 p-5">
          <CardHeader title="Manage the link" />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={busy === "toggle"} disabled={busy !== null} onClick={() => act(enabled ? "disable" : "enable")}>
              {enabled ? "Stop taking feedback" : "Start taking feedback"}
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
