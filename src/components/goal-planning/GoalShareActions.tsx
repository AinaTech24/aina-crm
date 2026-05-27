"use client";

/**
 * Quick-share strip for a goal — pre-fills a WhatsApp message and a mailto link
 * with the public print URL. Click and the RM's WhatsApp / Outlook opens with
 * the message ready to send.
 *
 * "Copy link" gets the same URL into the clipboard for ad-hoc sharing.
 */

import { useState } from "react";
import { MessageCircle, Mail, Copy, Check } from "lucide-react";

export function GoalShareActions({
  goalId,
  goalName,
  investorName,
  investorPhone,
  investorEmail,
}: {
  goalId: string;
  goalName: string;
  investorName: string;
  investorPhone: string | null;
  investorEmail: string | null;
}) {
  const [copied, setCopied] = useState(false);

  // The print page URL — opens in a new tab, ready for browser-print to PDF.
  const printUrl =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/dashboard/goals/${goalId}/print?view=detailed`;

  const waMsg = encodeURIComponent(
    `Hi ${investorName}, sharing the latest plan for your "${goalName}" goal. ` +
      `Open this report:\n${printUrl}\n\nLet me know a good time to discuss.`
  );
  const emailSubject = encodeURIComponent(`Your goal plan — ${goalName}`);
  const emailBody = encodeURIComponent(
    `Hi ${investorName},\n\nSharing the latest plan for your "${goalName}" goal. ` +
      `You can view (and print) the full report here:\n${printUrl}\n\n` +
      `Happy to walk through it on a call.\n\nThanks.`
  );

  const waHref = investorPhone
    ? `https://wa.me/${investorPhone.replace(/[^\d]/g, "")}?text=${waMsg}`
    : `https://wa.me/?text=${waMsg}`;
  const mailHref = investorEmail
    ? `mailto:${investorEmail}?subject=${emailSubject}&body=${emailBody}`
    : `mailto:?subject=${emailSubject}&body=${emailBody}`;

  function copy() {
    if (!printUrl) return;
    navigator.clipboard.writeText(printUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="card-surface p-3 flex items-center justify-between flex-wrap gap-2">
      <div className="text-xs text-muted-foreground">
        Send this goal plan to <span className="font-medium text-foreground">{investorName}</span>:
      </div>
      <div className="flex items-center gap-2">
        <a
          href={waHref}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary text-xs"
          title={investorPhone ? `WhatsApp ${investorPhone}` : "Pick number in WhatsApp Web"}
        >
          <MessageCircle className="size-3.5 text-emerald-600" /> WhatsApp
        </a>
        <a href={mailHref} className="btn-secondary text-xs">
          <Mail className="size-3.5 text-blue-600" /> Email
        </a>
        <button onClick={copy} className="btn-secondary text-xs">
          {copied ? (
            <>
              <Check className="size-3.5 text-emerald-600" /> Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" /> Copy link
            </>
          )}
        </button>
      </div>
    </div>
  );
}
