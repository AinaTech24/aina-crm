import Link from "next/link";
import { Building2, Database, Users, CreditCard, MessageCircle, Mail, Lock, Webhook, ShieldCheck, Workflow, KeyRound } from "lucide-react";

const SECTIONS = [
  {
    icon: Building2,
    title: "Organisation profile",
    desc: "Branding, contact, AUM range, business profile.",
    href: "/dashboard/settings/organisation",
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
    icon: Mail,
    title: "Notification templates",
    desc: "Edit the 18 lead-journey templates — welcome, referral, meeting, proposal, docs, portal.",
    href: "/dashboard/settings/notification-templates",
  },
  {
    icon: Users,
    title: "Team & roles",
    desc: "Invite team members, assign roles, manage seats.",
    href: "/dashboard/employees",
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
    desc: "Connect your AiSensy / Gupshup number for client messaging.",
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
    icon: Lock,
    title: "Security & access log",
    desc: "Access tracking, PII audit, IP allow-list.",
    href: "/dashboard/cybersecurity",
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
