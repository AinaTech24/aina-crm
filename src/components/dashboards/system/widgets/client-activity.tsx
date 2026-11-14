/**
 * Client activity — what clients did lately, newest first: a proposal viewed
 * or accepted, a risk profile filled in, an email opened, a request raised.
 * Every row is lib/metrics/client-activity.ts. Hidden when nothing happened
 * in the period (D6).
 *
 * Colour is outcome only: an accepted proposal is green; everything else is
 * the same quiet chip — an opened email is activity, not an achievement.
 */

import Link from "next/link";
import {
  ClipboardList, FileCheck, FileText, FileUp, FileX, Gauge, LifeBuoy, MailOpen, MessageSquare,
  MousePointerClick, PieChart, Star, type LucideIcon,
} from "lucide-react";
import type { Tx } from "@/db/client";
import { getClientActivity, type ClientActivityItem } from "@/lib/metrics";
import { formatRelative, humanise } from "@/lib/format";
import type { WidgetCtx, WidgetImpl } from "../types";

const CHANNEL: Record<string, string> = { email: "an email", whatsapp: "a WhatsApp message", sms: "an SMS" };

/** The icon and the sentence after the client's name. */
function describe(e: ClientActivityItem): { icon: LucideIcon; text: string; good?: boolean } {
  const quoted = e.detail ? ` “${e.detail}”` : "";
  switch (e.kind) {
    case "proposal_viewed": return { icon: FileText, text: `viewed the proposal${quoted}` };
    case "proposal_accepted": return { icon: FileCheck, text: `accepted the proposal${quoted}`, good: true };
    case "proposal_declined": return { icon: FileX, text: `declined the proposal${quoted}` };
    case "proposal_changes": return { icon: FileText, text: `asked for changes to the proposal${quoted}` };
    case "risk_profile": return { icon: Gauge, text: "completed the risk profile" };
    case "message_read":
      return {
        icon: MailOpen,
        text: e.detail
          ? `${e.channel === "whatsapp" ? "read" : "opened"}${quoted}`
          : `${e.channel === "whatsapp" ? "read" : "opened"} ${CHANNEL[e.channel ?? ""] ?? "a message"}`,
      };
    case "link_clicked": return { icon: MousePointerClick, text: e.detail ? `clicked a link in${quoted}` : "clicked a link in a message" };
    case "message_in": return { icon: MessageSquare, text: `sent ${CHANNEL[e.channel ?? ""] ?? "a message"}` };
    case "request":
      return { icon: LifeBuoy, text: e.detail === "complaint" ? "raised a complaint" : `raised a request${e.detail ? `: ${humanise(e.detail)}` : ""}` };
    case "feedback": return { icon: Star, text: "rated our service" };
    case "documents": return { icon: FileUp, text: "uploaded documents" };
    case "fact_find": return { icon: ClipboardList, text: "filled in the fact-find" };
    case "portfolio": return { icon: PieChart, text: "opened their portfolio" };
  }
}

async function clientActivity(tx: Tx, ctx: WidgetCtx) {
  const items = await getClientActivity(tx, ctx.scope, ctx.period, 8);
  if (!items.length) return { body: null };
  return {
    body: (
      <ul className="divide-y divide-border/60">
        {items.map((e, i) => {
          const d = describe(e);
          const Icon = d.icon;
          return (
            <li key={`${e.kind}-${e.investorId}-${e.at}-${i}`} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <span
                className="dash-kpi-chip"
                style={{ ["--c" as string]: d.good ? "hsl(var(--success))" : "hsl(var(--primary))" }}
                aria-hidden
              >
                <Icon className="size-4" />
              </span>
              <p className="min-w-0 flex-1 text-sm leading-snug">
                <Link href={`/dashboard/investors/${e.investorId}`} className="font-medium text-foreground hover:underline">
                  {e.investorName}
                </Link>{" "}
                {e.refId && e.kind.startsWith("proposal_") ? (
                  <Link href={`/dashboard/proposals/${e.refId}`} className="text-muted-foreground hover:underline">{d.text}</Link>
                ) : (
                  <span className="text-muted-foreground">{d.text}</span>
                )}
              </p>
              <time dateTime={e.at} className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{formatRelative(e.at)}</time>
            </li>
          );
        })}
      </ul>
    ),
    info: "What clients did themselves in the period, newest first: proposals viewed, accepted, declined or sent back; risk profiles they completed; emails and WhatsApp messages they opened or replied to, and links they clicked; requests raised and services rated through a form; documents uploaded, fact-finds filled and portfolios opened through a link.",
  };
}

export const clientActivityWidgets: WidgetImpl[] = [{ key: "client_activity", render: clientActivity }];
