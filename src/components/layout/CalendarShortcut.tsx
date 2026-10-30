/**
 * Top-bar calendar icon — one click opens the viewer's own calendar (the
 * Calendar page already scopes items to the viewer's book). It used to open a
 * "This week / This month" menu first; the firm wants the whole calendar
 * straight away (2026-10-30). Week view is a switch on the page itself.
 */

import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";

export function CalendarShortcut() {
  return (
    <Tooltip label="My calendar">
      <Link
        href="/dashboard/calendar"
        className="size-9 rounded-full bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground grid place-items-center transition-colors"
        aria-label="My calendar"
      >
        <CalendarDays className="size-4" />
      </Link>
    </Tooltip>
  );
}
