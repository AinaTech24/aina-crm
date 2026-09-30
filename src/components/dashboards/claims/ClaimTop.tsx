/**
 * §53 quick actions (with §54 search beside them), as one row in the page
 * header. Only what the viewer may do is offered. Actions ON a claim — add a
 * document, an update, an insurer query or its response, a settlement — start
 * from the claim itself: every client name on the page opens it.
 *
 * One button, the search box and "More". Six same-weight buttons, a paragraph
 * and a labelled search in a card of their own was the first thing on the
 * page, above the numbers.
 */

import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
import { MoreMenu } from "@/components/common/MoreMenu";
import { ClaimSearch } from "./ClaimSearch";

export function ClaimQuickActions({ can, hrefs }: {
  can: { write: boolean };
  hrefs: { focusFnr: string; focusSla: string; focusHv: string };
}) {
  const more = [
    { href: hrefs.focusFnr, label: "Pending documents" },
    { href: hrefs.focusSla, label: "SLA breaches" },
    { href: hrefs.focusHv, label: "High-value claims" },
    { href: "/dashboard/insurance-claims", label: "Claims register" },
    { href: "/dashboard/insurance-claims/scorecard", label: "Settlement scorecard" },
  ];
  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto" role="group" aria-label="Quick actions">
      {can.write && (
        <Link href="/dashboard/insurance-claims/new" className={buttonClass("primary", "md")}>
          <FilePlus2 className="size-4" aria-hidden /> Register claim
        </Link>
      )}
      {/* On a phone the search takes its own full-width line under the buttons. */}
      <div className="order-last w-full sm:order-none sm:w-auto"><ClaimSearch /></div>
      <MoreMenu text="More" label="More actions" items={more} />
    </div>
  );
}
