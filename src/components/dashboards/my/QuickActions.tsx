/**
 * §24 quick actions. (§23's client search is the top bar's — Ctrl K — on every page.)
 *
 * One row, at the top, because both answer the same impulse: "I know what I
 * want to do, get me there". Search is the first thing because a name is the
 * most common way an RM enters the CRM at all — the client rings, and
 * everything else follows from finding them.
 *
 * Actions respect permissions. A button that opens a 403 is worse than no
 * button, so anything the signed-in user cannot do is simply not rendered
 * rather than rendered disabled — a greyed-out control invites a support
 * ticket asking how to enable it.
 */

import Link from "next/link";
import {
  AlertOctagon, CalendarPlus, FileSignature, ListPlus, MessageSquarePlus, NotebookPen, Repeat,
  UserPlus, CalendarCheck,
} from "lucide-react";
import { MoreMenu } from "@/components/common/MoreMenu";
import { LogActivityButton } from "@/components/activities/ActivityLogger";
import { buttonClass } from "@/components/ui/button-class";
import { can, type Capability } from "@/lib/auth/rbac";
import type { SessionUser } from "@/lib/auth/session";

type Action = {
  key: string;
  label: string;
  href: string;
  icon: typeof UserPlus;
  /** Rendered only when the user holds ANY of these. Undefined = always available. */
  caps?: Capability[];
  primary?: boolean;
};

/**
 * The RM brief's fixed quick actions (§34). "Add follow-up" is the activity
 * logger (a call, a note, the next follow-up date) rather than a link, so it
 * sits beside these as its own button.
 */
const ACTIONS = (userId: string): Action[] => [
  // The one primary action. An RM's day starts by logging what just happened
  // or booking what happens next; everything else is navigation.
  { key: "meeting", label: "Schedule meeting", href: "/dashboard/review-meetings/new", icon: CalendarPlus, primary: true,
    caps: ["review_meeting.manage.assigned", "review_meeting.manage.all"] },
  { key: "review", label: "Schedule review", href: "/dashboard/review-meetings/new?category=review", icon: CalendarCheck,
    caps: ["review_meeting.manage.assigned", "review_meeting.manage.all"] },
  { key: "lead", label: "Add lead", href: "/dashboard/leads/new", icon: UserPlus, caps: ["lead.edit.assigned", "lead.edit.all"] },
  { key: "proposal", label: "Create proposal", href: "/dashboard/proposals/new", icon: FileSignature, caps: ["proposal.write"] },
  { key: "task", label: "Add task", href: "/dashboard/tasks/new", icon: ListPlus, caps: ["task.edit.assigned", "task.edit.all"] },
  { key: "query", label: "Add service request", href: "/dashboard/service-requests/new", icon: MessageSquarePlus, caps: ["service_request.manage"] },
  { key: "rejections", label: "SIP rejections", href: "/dashboard/sip-rejections?recovery=pending,client_contacted,bank_issue,mandate_issue", icon: Repeat },
  { key: "overdue", label: "Overdue actions", href: "#attention", icon: AlertOctagon },
  { key: "note", label: "Add meeting note", href: `/dashboard/review-meetings?rm=${userId}&status=completed`, icon: NotebookPen,
    caps: ["review_meeting.manage.assigned", "review_meeting.manage.all"] },
];

/**
 * The actions shown as buttons; everything else the user may do sits under
 * "More". Nine same-weight buttons plus a search box was the busiest thing on
 * the page, and the search duplicated the one in the top bar (Ctrl K), so it
 * is gone from here. The primary action plus the two an RM reaches for most —
 * logging a follow-up and adding a task — stay one click away.
 */
const ON_BAR = new Set(["meeting", "task"]);

export function QuickActions({ session }: { session: SessionUser }) {
  const allowed = ACTIONS(session.userId).filter((a) => !a.caps || a.caps.some((c) => can(session.roles, c, session.permissions)));
  const canLog = can(session.roles, "investor.note.add", session.permissions)
    || can(session.roles, "lead.edit.assigned", session.permissions);
  const bar = allowed.filter((a) => ON_BAR.has(a.key));
  const more = allowed.filter((a) => !ON_BAR.has(a.key));

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Quick actions">
      {bar.map((a) => {
        const Icon = a.icon;
        return (
          <Link key={a.key} href={a.href} className={buttonClass(a.primary ? "primary" : "secondary", "md")}>
            <Icon className="size-4" aria-hidden />
            {a.label}
          </Link>
        );
      })}
      {canLog && <LogActivityButton label="Add follow-up" variant="secondary" />}
      <MoreMenu text="More" label="More actions" items={more.map((a) => ({ href: a.href, label: a.label }))} />
    </div>
  );
}
