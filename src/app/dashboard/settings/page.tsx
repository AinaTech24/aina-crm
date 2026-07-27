import Link from "next/link";
import { Building2, Database, Users, CreditCard, MessageCircle, Mail, Webhook, ShieldCheck, Workflow, KeyRound, Palette, UserCircle, GitBranch, Target, Network, BellRing, ClipboardCheck, SlidersHorizontal } from "lucide-react";

const SECTIONS = [
  {
    icon: UserCircle,
    title: "My profile",
    desc: "Your details, change password, targets & leave entitlements.",
    href: "/dashboard/settings/profile",
  },
  {
    icon: Building2,
    title: "Organisation profile",
    desc: "Branding, contact, AUM range, business profile.",
    href: "/dashboard/settings/organisation",
  },
  {
    icon: Palette,
    title: "Appearance & theme",
    desc: "Re-skin the CRM to your brand — colours, font & density, and your white-label URL.",
    href: "/dashboard/settings/appearance",
  },
  {
    icon: SlidersHorizontal,
    title: "Custom fields",
    desc: "Add your own fields to leads & clients — text, number, date, dropdown and more.",
    href: "/dashboard/settings/custom-fields",
  },
  {
    icon: Database,
    title: "Master settings",
    desc: "15 look-up tables: lead sources, campaign types, service types, etc.",
    href: "/dashboard/settings/masters",
  },
  {
    icon: ShieldCheck,
    title: "Risk profile questionnaire",
    desc: "Customise questions, scoring, and risk-category bands for your firm.",
    href: "/dashboard/settings/risk-profile",
  },
  {
    icon: Workflow,
    title: "Blueprint editor",
    desc: "Edit stages, SLAs, required fields, and automations for leads, SRs, complaints, SIP recovery and reviews.",
    href: "/dashboard/settings/blueprints",
  },
  {
    icon: BellRing,
    title: "Notification templates",
    desc: "Edit the 18 lead-journey templates — welcome, referral, meeting, proposal, docs, portal.",
    href: "/dashboard/settings/notification-templates",
  },
  {
    icon: ClipboardCheck,
    title: "Onboarding form fields",
    desc: "Choose which client account-opening / KYC fields your team MUST fill — make any field mandatory or optional.",
    href: "/dashboard/settings/onboarding-fields",
  },
  {
    icon: Workflow,
    title: "Task templates",
    desc: "Design predefined tasks with sub-task checklists (SOPs) — your team applies them when creating a task.",
    href: "/dashboard/settings/task-templates",
  },
  {
    icon: Users,
    title: "Team & roles",
    desc: "Invite team members, assign roles, manage seats.",
    href: "/dashboard/employees",
  },
  {
    icon: Network,
    title: "Desks (sub-branch teams)",
    desc: "Group each branch into desks (DK, RC, 1…) and assign RMs — drives the monthly MIS roll-ups.",
    href: "/dashboard/settings/desks",
  },
  {
    icon: GitBranch,
    title: "Auto-assignment rules",
    desc: "Route new leads & clients to your team automatically — round-robin or load-balanced.",
    href: "/dashboard/settings/assignment-rules",
  },
  {
    icon: Target,
    title: "Targets & quota",
    desc: "Set monthly business, new-meeting and renewal-meeting targets per team member — track vs achievement.",
    href: "/dashboard/settings/targets",
  },
  {
    icon: CreditCard,
    title: "Billing & subscription",
    desc: "Current plan, payment history, renewal.",
    href: "/dashboard/billing",
  },
  {
    icon: MessageCircle,
    title: "WhatsApp connection",
    desc: "Your Aina WhatsApp number and Meta template approvals.",
    href: "/dashboard/settings/whatsapp",
  },
  {
    icon: Mail,
    title: "Email setup",
    desc: "Sending domain, DKIM, transactional + marketing streams.",
    href: "/dashboard/settings/email",
  },
  {
    icon: KeyRound,
    title: "Two-factor authentication",
    desc: "Add a TOTP authenticator code on top of your password. Self-service for your own account.",
    href: "/dashboard/settings/security",
  },
  {
    icon: Webhook,
    title: "Integrations",
    desc: "BSE Star MF, CAMS / KFintech feeds, Razorpay, KYC providers.",
    href: "/dashboard/settings/integrations",
  },
];

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">Configure your firm's workspace.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <Link
              key={s.href}
              href={s.href}
              className="border rounded-lg p-4 bg-card hover:bg-accent/40 transition-colors flex items-start gap-3"
            >
              <Icon className="size-5 text-muted-foreground mt-0.5" />
              <div className="flex-1">
                <div className="font-medium">{s.title}</div>
                <div className="text-xs text-muted-foreground mt-1">{s.desc}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
