import { cache } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Workflow,
  MessageSquare,
  ListChecks,
  Settings,
  HeartHandshake,
  Target,
  TrendingUp,
  Repeat,
  FileSignature,
  Shield,
  UserCog, GraduationCap,
  CalendarOff,
  CalendarCheck,
  BarChart3,
  FolderArchive,
  Scale,
  Lock,
  Bot,
  CreditCard,
  AlertTriangle,
  Briefcase,
  Boxes,
  PhoneCall,
  CopyCheck,
  PieChart,
  Calculator,
  Wallet,
  // palette-only pages (PALETTE_ONLY)
  Zap, Activity, Megaphone, FileCheck, ScrollText, ClipboardCheck, Stamp, Network, Package, Copy, Trash2,
  // ── unique-icon replacements for the de-duplicated sidebar ──
  UserPlus,
  Presentation,
  LayoutTemplate,
  Gauge,
  ClipboardList,
  BellRing,
  FolderOpen,
  Building2,
  LifeBuoy,
  IndianRupee,
  Landmark,
  Crosshair,
  Sparkles,
} from "lucide-react";
import { eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { tenants, users, tenantUiLayouts } from "@/db/schema";
import { requireSession, requirePageSession } from "@/lib/auth/session";
import { primaryRoleLabel, can } from "@/lib/auth/rbac";
import { loadTenantLicense, isPathAllowedWhenRestricted } from "@/lib/auth/license";
import { tenantAccessibleNavKeys, isGatableNav, gatedNavKeyForPath } from "@/config/nav-access";
import { pickLogo } from "@/lib/branding/logo";
import type { Metadata } from "next";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { QuickAdd, type QuickAddItem } from "@/components/layout/QuickAdd";
import { BackButton } from "@/components/layout/BackButton";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { BirthdayBell } from "@/components/layout/BirthdayBell";
import { HelpMenu } from "@/components/layout/HelpMenu";
import { Tooltip } from "@/components/ui/Tooltip";
import { DesktopSidebar } from "@/components/layout/DesktopSidebar";
import { CustomizableNav, type NavItemData } from "@/components/layout/CustomizableNav";
import { loadModuleControls } from "@/lib/platform/module-controls";
import { QuickCreateFab } from "@/components/layout/QuickCreateFab";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { ActivityLauncher } from "@/components/activities/ActivityLauncher";
import ProductTour from "@/components/layout/ProductTour";
import { MobileNav } from "@/components/layout/MobileNav";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import { ToastProvider } from "@/components/ui/Toast";
import { ConfirmProvider } from "@/components/ui/ConfirmProvider";
import { buildTenantThemeCss } from "@/lib/branding/theme";
import { overdueTaskSql } from "@/lib/metrics/tasks";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type NavItem = {
  href: string;
  label: string;
  icon: any;
  /** Required role (any of). If omitted, visible to all. */
  roles?: string[];
  /** Required module key — gated by tenant package. */
  module?: string;
  /** Always tag as Beta, regardless of the platform Module Controls setting. */
  beta?: boolean;
  /** The key access is granted by, when it differs from `href` — a page that
   *  moved keeps the key firms' grants, Module Controls and people's module
   *  lists were stored under (see src/config/nav-access.ts: never change a key). */
  accessKey?: string;
};

type NavSection = { title: string; items: NavItem[] };

/** "Owner / Admin / Back-office". Owner is the tenant admin; ops is back_office's alias. */
const DATA_ADMIN_ROLES = ["owner", "back_office", "ops"];

const NAV: NavSection[] = [
  // Ten groups, ordered by how often a person opens them. Two rules hold for
  // every item below:
  //   1. The menu label is the page's H1, word for word. A user who clicks
  //      "Families" must land on a page titled "Families", not "Family mapping".
  //   2. Every role gate and module key is preserved from the previous layout;
  //      only Data & Admin is narrowed, to the people who run the back office.
  //
  // Some pages are deliberately NOT in the sidebar any more (campaigns, DDQ,
  // SOPs, audit log, trash, and others). Their routes are untouched and they
  // are listed in PALETTE_ONLY below, so Ctrl/Cmd+K still finds them behind
  // the same role and module gates as the menu.
  //
  // CustomizableNav caches each user's layout and only APPENDS new hrefs, so a
  // regroup is invisible to anyone who has used the app until its VERSION is
  // bumped. It was, alongside this change.
  {
    title: "Home",
    items: [
      // A plain item now. It used to be a separate DashboardNavDropdown rendered
      // above the groups; the module kill-switch still hides it, because
      // moduleControls is checked for every item below.
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      // Who to call today and why, ranked by what is at stake (lib/nba). It had
      // no way in but a typed address; the cue has to be where people look.
      { href: "/dashboard/next-best-action", label: "Next Best Action", icon: Sparkles,
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      // My Day was removed 2026-10-01 at the firm's request; /dashboard/command-center
      // now redirects here.
    ],
  },
  {
    title: "Work",
    items: [
      { href: "/dashboard/tasks", label: "Tasks", icon: ListChecks, module: "tasks" },
      // Plan the morning, close the evening (lib/daily-tracker). Clocking in and
      // the 6:30 pm "close your day" nudge both open it.
      // accessKey: the page is gated as part of Tasks (gatedNavKeyForPath), so
      // the menu item follows the same grant rather than showing a locked page.
      { href: "/dashboard/tasks/daily", accessKey: "/dashboard/tasks", label: "Daily Job Tracker", icon: CalendarCheck, module: "tasks" },
      { href: "/dashboard/review-meetings", label: "Meetings", icon: Presentation, module: "review_meetings",
        roles: ["owner", "rm", "branch_head", "back_office", "ops"] },
      { href: "/dashboard/service-requests", label: "Service Requests", icon: LifeBuoy, module: "service_requests" },
      // No "Operations" item: the Operations Dashboard lives in the Dashboard
      // dropdown like every role dashboard (removed from WORK 2026-10-01).
      // /dashboard/operations still redirects there for old links.
    ],
  },
  {
    title: "Clients",
    items: [
      { href: "/dashboard/leads", label: "Leads", icon: UserPlus, module: "lead_management",
        roles: ["owner", "marketing", "rm", "branch_head", "back_office", "ops", "compliance"] },
      { href: "/dashboard/investors", label: "Clients", icon: Users, module: "client_master",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      // An existing client who wants another product (lib/opportunities).
      { href: "/dashboard/opportunities", label: "Opportunities", icon: Crosshair, module: "client_master",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      { href: "/dashboard/families", label: "Families", icon: HeartHandshake, module: "family_mapping",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      { href: "/dashboard/risk-profiles", label: "Risk Profiles", icon: Gauge, module: "risk_profile",
        roles: ["owner", "compliance", "back_office", "ops", "rm"] },
      { href: "/dashboard/discovery", label: "Discovery (Fact-find)", icon: ClipboardList,
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      { href: "/dashboard/support/feedback", label: "Client Feedback", icon: MessageSquare, module: "service_requests" },
    ],
  },
  {
    title: "Planning Tools",
    items: [
      { href: "/dashboard/calculators", label: "Calculators", icon: Calculator },
      { href: "/dashboard/goals", label: "Goals", icon: Target, module: "goal_planning",
        roles: ["owner", "rm", "branch_head", "back_office", "ops"] },
      { href: "/dashboard/financial-plans", label: "Financial Health Check", icon: ClipboardList, module: "goal_planning",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      { href: "/dashboard/proposals", label: "Proposals", icon: FileSignature, module: "proposals",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
      // Claims / Renewals / Protection-gap / Commission are tabs inside this module.
      { href: "/dashboard/insurance", label: "Insurance", icon: Shield, module: "insurance",
        roles: ["owner", "rm", "branch_head", "back_office", "ops", "compliance"] },
    ],
  },
  {
    title: "Business",
    items: [
      // Rejections + At-risk are tabs inside the SIP module.
      { href: "/dashboard/sips", label: "SIP Book", icon: TrendingUp, module: "sip_tracker",
        roles: ["owner", "back_office", "ops", "rm", "branch_head", "compliance"] },
      { href: "/dashboard/transactions", label: "MF Transactions", icon: Repeat, module: "transactions",
        roles: ["owner", "back_office", "ops", "rm", "branch_head", "compliance"] },
      { href: "/dashboard/business-entries", label: "Business Entries", icon: Briefcase, module: "business_entries",
        roles: ["owner", "branch_head", "rm", "back_office", "ops"] },
      { href: "/dashboard/fixed-deposits", label: "Fixed Deposits", icon: Landmark,
        roles: ["owner", "branch_head", "rm", "back_office", "ops", "compliance"] },
      { href: "/dashboard/expected-inflows", label: "Expected Inflows", icon: IndianRupee,
        roles: ["owner", "branch_head", "rm", "back_office", "ops"] },
    ],
  },
  {
    title: "Insights",
    items: [
      { href: "/dashboard/reports", label: "Reports", icon: BarChart3, module: "reports", roles: ["owner", "branch_head", "compliance"] },
      { href: "/dashboard/portfolio-intelligence", label: "Portfolio Insights", icon: PieChart, roles: ["owner", "branch_head", "compliance", "rm", "back_office", "ops"] },
      // The firm's own P&L and salary ledger: owner-confidential, never an RM's.
      { href: "/dashboard/finances", label: "Practice Finances", icon: Wallet, module: "reports", roles: ["owner", "compliance", "back_office"] },
      { href: "/dashboard/ai-assistant", label: "Aina Copilot", icon: Bot, module: "ai_assistant", beta: true },
    ],
  },
  // No "Automation" group: Automations, Message Templates and Communications
  // are set up by an admin, so since 2026-10-01 they live in Settings (cards in
  // SettingsDirectory) and in PALETTE_ONLY below for Ctrl/Cmd+K.
  {
    title: "Compliance",
    items: [
      // DDQ, SOPs, the audit log, legal registrations and sub-distributors are
      // in PALETTE_ONLY below: searchable with Ctrl/Cmd+K, not in the menu.
      // Compliance Center and Circulars were removed at the firm's request
      // (2026-10-07) — do not restore them; their addresses redirect.
      { href: "/dashboard/documents", label: "Documents", icon: FolderOpen, module: "documents", roles: ["owner", "compliance", "back_office", "ops", "rm", "branch_head"] },
    ],
  },
  {
    title: "Team",
    items: [
      // Team Members is Settings → "Team & roles" (and Ctrl/Cmd+K), not the menu.
      // Attendance and Leave are each person's OWN record, so they stay open to
      // everyone; the admin views (grid, settings, approvals) are gated in-page.
      { href: "/dashboard/attendance", label: "Attendance", icon: CalendarCheck },
      { href: "/dashboard/leave-applications", label: "Leave", icon: CalendarOff },
      { href: "/dashboard/induction", label: "Induction", icon: GraduationCap },
      { href: "/dashboard/announcements", label: "Announcements", icon: BellRing },
    ],
  },
  {
    // Configure-once reference data and back-office tooling. Shown only to the
    // people who run the back office, and collapsed unless you are on one of
    // its pages. The pages keep their own guards; this only trims the menu.
    title: "Data & Admin",
    items: [
      { href: "/dashboard/rta-imports", label: "RTA File Imports", icon: FolderArchive, module: "transactions", roles: DATA_ADMIN_ROLES },
      { href: "/dashboard/reconciliation", label: "Holdings Reconciliation", icon: Scale, module: "transactions", roles: DATA_ADMIN_ROLES },
      { href: "/dashboard/commission-reconciliation", label: "Brokerage Reconciliation", icon: CreditCard, module: "reports", roles: DATA_ADMIN_ROLES },
      // Scheme Master and AMC Empanelments are master data: Settings → Clients &
      // onboarding (and Ctrl/Cmd+K), not the menu.
      { href: "/dashboard/duplicates", label: "Find Duplicates", icon: CopyCheck, roles: DATA_ADMIN_ROLES },
      { href: "/dashboard/activities", label: "Activity Log", icon: PhoneCall, roles: DATA_ADMIN_ROLES },
      // Everyone else still reaches their own profile from the avatar menu.
      { href: "/dashboard/settings", label: "Settings", icon: Settings, roles: DATA_ADMIN_ROLES },
    ],
  },
];

/**
 * Pages that left the sidebar in the ten-group layout but must stay findable.
 * The Ctrl/Cmd+K palette searches these alongside NAV, filtered by exactly the
 * same rules, so nobody finds a page here that the menu would have hidden.
 * Labels are the pages' own H1s, which is what a user types.
 */
const PALETTE_ONLY: NavSection[] = [
  {
    title: "Home",
    items: [
      // The dashboard dropdown's footer links, findable with Ctrl/Cmd+K too.
      { href: "/dashboard/manage", label: "Manage dashboards", icon: LayoutDashboard },
      { href: "/dashboard/new", label: "New dashboard", icon: LayoutDashboard },
    ],
  },
  {
    title: "Automation",
    items: [
      { href: "/dashboard/automations/actions", accessKey: "/dashboard/workflows/actions", label: "Automation Actions", icon: Zap, module: "automation_workflows" },
      { href: "/dashboard/automations/history", accessKey: "/dashboard/workflows/runs", label: "Automation Run History", icon: Activity, module: "automation_workflows",
        roles: ["owner", "compliance", "back_office", "ops"] },
      { href: "/dashboard/campaigns", label: "Marketing Campaigns", icon: Megaphone, module: "marketing_campaigns", roles: ["owner", "marketing"] },
      // These four open from Settings; same access rules as when they were in the menu.
      { href: "/dashboard/communications", label: "Communications", icon: MessageSquare, module: "broadcasts" },
      { href: "/dashboard/automations", accessKey: "/dashboard/workflows/rules", label: "Automations", icon: Workflow, module: "automation_workflows" },
      { href: "/dashboard/templates", label: "Message Templates", icon: LayoutTemplate, module: "broadcasts" },
    ],
  },
  {
    title: "Team",
    items: [
      { href: "/dashboard/employees", label: "Team Members", icon: UserCog, module: "employees", roles: ["owner", "branch_head"] },
    ],
  },
  {
    title: "Compliance",
    items: [
      { href: "/dashboard/compliance", label: "Compliance & DDQ readiness", icon: FileCheck, module: "ddq", roles: ["owner", "compliance"] },
      { href: "/dashboard/sops", label: "SOP library", icon: ScrollText, roles: ["owner", "compliance"] },
      { href: "/dashboard/audit-log", label: "Audit log", icon: ClipboardCheck, module: "audit_log", roles: ["owner", "compliance"] },
      { href: "/dashboard/legal-registrations", label: "Legal registrations", icon: Stamp, roles: ["owner", "compliance"] },
      { href: "/dashboard/sub-distributors", label: "Sub-distributors", icon: Network, roles: ["owner", "compliance"] },
    ],
  },
  {
    title: "Data & Admin",
    items: [
      { href: "/dashboard/product-offerings", label: "Products & services offered", icon: Package, roles: ["owner", "compliance"] },
      { href: "/dashboard/merge-clients", label: "Merge Clients", icon: Copy, roles: ["owner", "branch_head"] },
      { href: "/dashboard/trash", label: "Trash", icon: Trash2, roles: ["owner", "compliance"] },
      { href: "/dashboard/schemes", label: "Scheme Master", icon: Boxes, roles: DATA_ADMIN_ROLES },
      { href: "/dashboard/amc-empanelments", label: "AMC Empanelments", icon: Building2, roles: DATA_ADMIN_ROLES },
    ],
  },
];

function NavBlockedNotice() {
  return (
    <div className="max-w-lg mx-auto mt-12 card-elevated p-10 text-center">
      <div className="size-16 mx-auto rounded-2xl bg-amber-100 grid place-items-center shadow-md">
        <Lock className="size-8 text-amber-600" />
      </div>
      <h1 className="text-2xl font-bold mt-5 tracking-tight">Section not available</h1>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        This module isn&apos;t enabled for your account. Ask your firm owner (or AINA) to grant access.
      </p>
      <Link href="/dashboard" className="btn-primary mt-6 inline-flex">
        Back to dashboard
      </Link>
    </div>
  );
}

/**
 * The firm's row, read ONCE per request: generateMetadata (tab title, favicon)
 * and the layout (logo, theme, name) both need it, and each used to open its
 * own transaction for it. React cache() shares the result within a request.
 */
const getShellTenant = cache(async (tenantId: string) =>
  withTenant(tenantId, async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return t;
  })
);

export async function generateMetadata(): Promise<Metadata> {
  // Per-tenant favicon + browser-tab title. Wrapped in try/catch so a metadata
  // hiccup (e.g. no session) never takes down the dashboard render.
  try {
    const session = await requireSession();
    const branding = await getShellTenant(session.tenantId);
    const icon = pickLogo(branding, "favicon");
    return {
      title: branding?.displayName ? `${branding.displayName} — CRM` : undefined,
      icons: icon ? { icon } : undefined,
    };
  } catch {
    return {};
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePageSession();
  const license = await loadTenantLicense(session.tenantId, session.roles);
  // Brand-new tenant that hasn't chosen/paid for a plan yet — send them to
  // plan selection, never the dashboard.
  if (license.needsOnboarding) {
    redirect("/onboarding/choose-plan");
  }
  // Admin → MFD sidebar access: the exact set of nav hrefs the firm can open
  // (the platform admin's explicit grant, else the package-module default).
  const tenantAllowedSet = new Set(
    tenantAccessibleNavKeys({
      allowedNav: license.allowedNav,
      enabledModules: license.enabledModules,
      enabledFeatures: license.enabledFeatures,
    })
  );

  // Read the current path from the middleware-set header so we can carve out
  // billing + support pages while the rest of the dashboard is restricted.
  const reqHeaders = await headers();
  const pathname = reqHeaders.get("x-pathname") ?? "";
  const pathAllowed = isPathAllowedWhenRestricted(pathname);

  const tenantP = getShellTenant(session.tenantId);
  const { userModules, avatarUrl, twoFaEnabled, whatsNewUnread, navBadges, branchList, firmLayoutRows } = await withTenant(session.tenantId, async (tx) => {
    // Per-user sidebar module grant (Module-19). null = inherit all tenant modules.
    const [u] = await tx
      .select({ enabledModules: users.enabledModules, avatarUrl: users.avatarUrl, twoFaEnabled: users.twoFaEnabled })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    const whatsNewRes = await tx.execute(sql`
      SELECT count(*)::int AS n FROM release_notes rn
       WHERE rn.published_at IS NOT NULL AND rn.published_at <= now()
         AND NOT EXISTS (
           SELECT 1 FROM release_note_reads r
            WHERE r.release_note_id = rn.id
              AND r.user_id = ${session.userId}::uuid
              AND r.tenant_id = ${session.tenantId}::uuid)
    `);
    // Sidebar count badges -- ONLY where the reader has something to act on:
    // their overdue tasks, the service requests waiting on them, and leave
    // they can approve. Everything else is noise that trains people to ignore
    // badges. This layout wraps every page, so the counts run in ONE statement
    // in its own savepoint and fall back to 0 rather than taking the app down
    // (they used to be three statements in three savepoints: ~9 round trips).
    const isLeaveApprover = session.roles.some((r) => r === "owner" || r === "branch_head");
    const srSeeAll = can(session.roles, "service_request.view.all", session.permissions);
    const badges = await tx
      .transaction(async (sp) => sp.execute(sql`
        SELECT
          -- Overdue tasks assigned to ME — lib/metrics/tasks.ts, the same
          -- definition as every overdue count on the dashboards and My Day.
          (SELECT count(*)::int FROM tasks t
            WHERE t.tenant_id = ${session.tenantId}::uuid
              AND t.assignee_id = ${session.userId}::uuid
              AND ${overdueTaskSql("t")}) AS tasks_overdue,
          -- waiting_customer is excluded on purpose: the ball is in the client's court.
          (SELECT count(*)::int FROM service_requests
            WHERE tenant_id = ${session.tenantId}::uuid
              AND status IN ('open', 'in_progress', 'escalated')
              AND ${srSeeAll ? sql`TRUE` : sql`assigned_to_user_id = ${session.userId}::uuid`}) AS sr_open,
          -- Only managers approve leave, and never their own -- so nobody else
          -- is shown a count they can do nothing about.
          ${isLeaveApprover
            ? sql`(SELECT count(*)::int FROM leave_applications
                    WHERE tenant_id = ${session.tenantId}::uuid
                      AND status = 'requested'
                      AND employee_user_id <> ${session.userId}::uuid)`
            : sql`0`} AS leave_pending`))
      .then((r) => r.rows[0] as { tasks_overdue?: number; sr_open?: number; leave_pending?: number } | undefined)
      .catch(() => undefined);
    const tasksOverdue = Number(badges?.tasks_overdue ?? 0);
    const srOpen = Number(badges?.sr_open ?? 0);
    const leavePending = Number(badges?.leave_pending ?? 0);

    // "Switch branch" opens the firm cockpit for one branch, so only a viewer of
    // the firm cockpit is offered it. Own savepoint: a failure hides the item,
    // it never takes the layout down.
    const branchList: { id: string; name: string }[] = can(session.roles, "dashboard.view.owner", session.permissions)
      ? await tx
          .transaction(async (sp) =>
            sp.execute(sql`SELECT id, name FROM branches WHERE tenant_id = ${session.tenantId}::uuid ORDER BY name`)
          )
          .then((r) => (r.rows as { id: string; name: string | null }[]).map((b) => ({ id: String(b.id), name: b.name ?? "—" })))
          .catch(() => [])
      : [];

    // Firm-wide layout defaults (owner-set) — injected as a global so the
    // RelatedLists + ColumnManager components can use them as the fallback
    // before a user personalizes (their own localStorage choice still wins).
    // Read in this transaction rather than a second one.
    const firmLayoutRows = await tx
      .select({ moduleKey: tenantUiLayouts.moduleKey, kind: tenantUiLayouts.kind, data: tenantUiLayouts.data })
      .from(tenantUiLayouts)
      .where(eq(tenantUiLayouts.tenantId, session.tenantId));

    return {
      firmLayoutRows,
      userModules: (u?.enabledModules as string[] | null) ?? null,
      avatarUrl: (u?.avatarUrl as string | null) ?? null,
      twoFaEnabled: !!u?.twoFaEnabled,
      branchList,
      navBadges: {
        "/dashboard/tasks": tasksOverdue,
        "/dashboard/service-requests": srOpen,
        "/dashboard/leave-applications": leavePending,
      } as Record<string, number>,
      // Published release notes this user hasn't opened yet — drives the
      // "what's new" sparkle badge so shipped features get discovered.
      whatsNewUnread: Number((whatsNewRes.rows[0] as any)?.n ?? 0),
    };
  });

  const tenant = await tenantP;
  const firmLayoutMap: Record<string, Record<string, any>> = {};
  for (const r of firmLayoutRows) (firmLayoutMap[r.moduleKey] ??= {})[r.kind] = r.data;
  const layoutAdmin = can(session.roles, "settings.users", session.permissions);

  // Global "+ Add" (spec 23). Gated here on the SERVER so the capability matrix
  // never reaches the browser and nobody is offered an action that would 403.
  const perms = session.permissions;
  const cap = (c: Parameters<typeof can>[1]) => can(session.roles, c, perms);
  const canLogActivity = cap("investor.note.add") || cap("lead.edit.all") || cap("lead.edit.assigned");
  const quickAddItems: QuickAddItem[] = [
    // First: the thing an RM does most often. Opens the Log activity drawer with
    // a client / lead picker in place (ActivityLauncher) — no page to find first.
    { label: "Log a call", href: "#log-call", hint: "Call, WhatsApp, visit or note", action: "log-activity" as const, show: canLogActivity },
    { label: "Lead", href: "/dashboard/leads/new", show: cap("lead.edit.all") || cap("lead.edit.assigned") },
    { label: "Client", href: "/dashboard/investors/new", show: cap("investor.edit.all") || cap("investor.edit.assigned") },
    { label: "Family", href: "/dashboard/families/new", show: cap("family.create") },
    { label: "Task", href: "/dashboard/tasks/new", show: cap("task.edit.all") || cap("task.edit.assigned") },
    { label: "Meeting", href: "/dashboard/review-meetings/new", show: cap("review_meeting.manage.all") || cap("review_meeting.manage.assigned") },
    { label: "SIP", href: "/dashboard/sips/new", show: cap("transactions.execute") },
    // There is no manual transaction form — the book is built from registrar
    // files — so this points at the real entry path rather than a dead link.
    { label: "Transactions", href: "/dashboard/transactions/import", hint: "Import from an RTA file", show: cap("transactions.execute") },
    { label: "Proposal", href: "/dashboard/proposals/new", show: cap("proposal.write") },
    { label: "Insurance policy", href: "/dashboard/insurance/new", show: cap("insurance.write") },
    { label: "Service query", href: "/dashboard/service-requests/new", show: cap("service_request.manage") },
    // The note on the client's own page (Notes tab) is still the long-form one;
    // a quick note is "Log a call" above with type Note.
    { label: "Note", href: "/dashboard/investors", hint: "Pick a client to add a note", show: cap("investor.note.add") },
  ]
    .filter((i) => i.show)
    .map(({ label, href, hint, action }) => ({ label, href, hint, action }));

  // Sidebar badge uses the square icon variant, falling back to monogram → full
  // logo so a firm that only uploaded a wide logo still gets a sensible badge.
  const sidebarLogo = pickLogo(tenant, "icon");

  // MFD → team sidebar gate. Owners always see the full firm set; everyone else
  // is limited to the items the owner granted them (a subset of the firm's).
  const isOwnerUser = session.roles.includes("owner");

  // Enforce nav/module access SERVER-SIDE, not just by hiding the sidebar item:
  // if the requested page belongs to a module the firm (or this team member)
  // wasn't granted, block the render. (Audit: UI-only gating was bypassable by
  // typing the URL directly.)
  const gatedKey = gatedNavKeyForPath(pathname);
  const navBlocked =
    gatedKey !== null &&
    (!tenantAllowedSet.has(gatedKey) ||
      (!isOwnerUser && userModules !== null && !userModules.includes(gatedKey)));

  // Per-tenant white-label theme: override the brand CSS variables from the
  // firm's chosen primary/accent colours (Settings → Appearance). Empty string
  // when the tenant uses the stock AINA palette, so we inject nothing.
  const themeCss = buildTenantThemeCss(
    tenant?.primaryColor,
    (tenant as any)?.secondaryColor,
    (tenant as any)?.textColor,
    (tenant as any)?.hoverColor,
    (tenant as any)?.fontFamily,
    (tenant as any)?.uiDensity
  );

  // Global module controls (platform admin): 'disabled' hides a module for every
  // tenant; 'beta' shows a Beta tag. Loaded from platform_settings('modules').
  const moduleControls = await loadModuleControls();

  // /dashboard is where every login lands, so it must ALWAYS be in the sidebar.
  // It is an ordinary NAV item now, and that still holds: it carries no roles,
  // and it is not in the nav-access gating catalog, so the only thing that can
  // hide it is the platform Module Control kill-switch below. (An earlier
  // version also required a "dashboards" module grant, and every firm on an
  // explicit nav grant silently lost its Dashboard link.)

  const canSee = (i: NavItem) => {
    const key = i.accessKey ?? i.href;
    // Platform kill-switch — a globally-disabled sidebar item is hidden for everyone.
    if (moduleControls[key] === "disabled") return false;
    if (i.roles && !session.roles.some((r) => i.roles!.includes(r) || r === "owner")) return false;
    if (isGatableNav(key)) {
      // Admin → MFD: the firm must have access to this sidebar item.
      if (!tenantAllowedSet.has(key)) return false;
      // MFD → team: owners see all; others limited to their granted items.
      if (!isOwnerUser && userModules && !userModules.includes(key)) return false;
    }
    return true;
  };
  const visible = NAV.map((section) => ({ ...section, items: section.items.filter(canSee) }))
    .filter((s) => s.items.length > 0);

  // Flatten the role/module-filtered nav into items the client CustomizableNav
  // can reorder/regroup. Pass the icon by NAME (lucide displayName) — a string —
  // not a pre-rendered element, so React never tries to serialize a lucide
  // component across the RSC boundary. The section title is the default group.
  const flatNavItems: NavItemData[] = visible.flatMap((section) =>
    section.items.map((item) => ({
      href: item.href,
      label: item.label,
      iconName: (item.icon?.displayName || item.icon?.name || "") as string,
      defaultGroup: section.title,
      badge: navBadges[item.href] > 0 ? navBadges[item.href] : undefined,
      beta: !!item.beta || moduleControls[item.accessKey ?? item.href] === "beta",
    }))
  );
  // The palette searches the menu plus the pages that left it.
  const paletteNavItems: NavItemData[] = [
    ...flatNavItems,
    ...PALETTE_ONLY.flatMap((section) =>
      section.items.filter(canSee).map((item) => ({
        href: item.href,
        label: item.label,
        iconName: (item.icon?.displayName || item.icon?.name || "") as string,
        defaultGroup: section.title,
      }))
    ),
  ];


  // Only a multi-branch firm has anything to switch between.
  const profileBranches = branchList.length > 1 ? branchList : null;

  const roleLabel = primaryRoleLabel(session.roles);

  const initials = session.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Sidebar inner content — brand header + nav + user card. Rendered in BOTH
  // the desktop aside and the mobile drawer (MobileNav), so the navigation has
  // a single source of truth and never drifts between the two.
  const sidebarInner = (
    <>
        {/* Brand header — light neutral row; tenant identity carried by the logo tile only. */}
        <div className="border-b border-border bg-card">
          <div className="sidebar-brand-row px-5 h-16 flex items-center gap-3">
            {tenant ? (
              <>
                {sidebarLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={sidebarLogo}
                    alt="logo"
                    className="size-10 rounded-xl ring-1 ring-border object-cover"
                  />
                ) : (
                  <div
                    className="size-10 rounded-xl bg-secondary text-brand-navy grid place-items-center text-lg font-extrabold ring-1 ring-border"
                    style={tenant.primaryColor ? { color: tenant.primaryColor } : {}}
                  >
                    {(tenant.displayName ?? "A").charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="sidebar-brand-text min-w-0">
                  <div className="font-semibold tracking-tight truncate text-sm leading-tight text-foreground">
                    {tenant.displayName ?? "Aina CRM"}
                  </div>
                  <div className="mt-0.5 inline-flex items-center gap-1 text-2xs text-muted-foreground font-mono">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    <span className="truncate">{tenant.arn ?? "—"}</span>
                  </div>
                </div>
              </>
            ) : (
              // No tenant context → product default: the Aina wordmark on a white card.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/aina-wordmark.png"
                alt="Aina CRM"
                className="h-8 w-auto"
              />
            )}
          </div>
        </div>

        {/* Nav — searchable, user-personalizable (reorder + custom groups) */}
        <CustomizableNav
          items={flatNavItems}
          storageKey={`aina:nav:${session.userId}`}
        />

    </>
  );

  return (
    <ToastProvider>
    <ConfirmProvider>
      {/* Per-tenant theme override — re-declares the brand CSS variables on
          :root. Rendered after globals.css in document order, so it wins. */}
      {themeCss && (
        <style id="tenant-theme" dangerouslySetInnerHTML={{ __html: themeCss }} />
      )}
      {/* Firm-wide layout defaults + whether this user can save them. Read
          synchronously by RelatedLists/ColumnManager — no extra fetch, no flash. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `window.__AINA_FIRM_LAYOUTS__=${JSON.stringify(firmLayoutMap)};window.__AINA_LAYOUT_ADMIN__=${layoutAdmin ? "true" : "false"};`,
        }}
      />
    {/* h-screen + overflow-hidden on the outer wrapper means the page itself
        never scrolls — the sidebar and the main pane each get their own
        scrollbar from the `overflow-y-auto` they already declare. Print mode
        reverts to block flow so the whole document prints in one stream.

        `relative` here and on <main> is what makes that hold. An absolutely
        positioned element with no positioned ancestor (an `sr-only` label is
        one) is placed against the BODY, so overflow-hidden here never clipped
        it: one such label deep in a dashboard made the document 6,741px tall,
        and the window scrolled the whole shell away into blank space. */}
    <div className="relative h-screen flex bg-background overflow-hidden print:static print:block print:h-auto print:overflow-visible">
      {/* ───────────── Desktop sidebar (hidden below lg — mobile uses drawer) ─────────────
          Hover-expand + click-to-pin icon rail. State lives in DesktopSidebar. */}
      <DesktopSidebar>{sidebarInner}</DesktopSidebar>

      {/* ────────────────────────── Main ────────────────────────── */}
      {/* h-full + overflow-y-auto = independent scroll, sticky topbar stays
          pinned inside this pane (not at viewport top). */}
      <main id="main-content" tabIndex={-1} className="relative flex-1 min-w-0 h-full overflow-y-auto print:static print:overflow-visible print:h-auto">
        {/* Topbar — glass, sticky; hidden when printing */}
        <div className="sticky top-0 z-40 border-b border-border bg-card px-4 sm:px-6 h-16 flex items-center gap-3 sm:gap-4 print:hidden">
          <div className="flex items-center gap-3 min-w-0">
            {/* Mobile hamburger — opens the nav drawer (shares sidebarInner).
                Firm name + ARN live in the sidebar header only (no duplication). */}
            <MobileNav>{sidebarInner}</MobileNav>
            <BackButton />
          </div>
          {/* Reference: a bounded grey search pill, not a full-width bar. */}
          <div data-tour="global-search" className="flex-1 min-w-0 flex max-w-md">
            {!license.isRestricted && <GlobalSearch />}
          </div>
          <div className="ml-auto flex items-center gap-2 sm:gap-3 text-sm">
            <QuickAdd items={quickAddItems} />
            {/* Convenience icons collapse on phones — everything stays reachable
                (help via its page, birthdays via My Day, two-factor via the
                avatar menu). */}
            <div className="hidden sm:flex items-center gap-3">
            {/* "What's new" is inside this menu now: four icons, not five. */}
            <HelpMenu whatsNewUnread={whatsNewUnread} />
            <BirthdayBell />
            </div>
            <span data-tour="notifications" className="inline-flex">
              <NotificationBell />
            </span>
            <span className="hidden sm:block h-6 w-px bg-border mx-0.5" />
            <ProfileMenu
              twoFaEnabled={twoFaEnabled}
              branches={profileBranches}
              name={session.name}
              email={session.email}
              roleLabel={roleLabel}
              initials={initials}
              avatarUrl={avatarUrl}
              packageKey={license.packageKey}
              licenseStatus={license.status}
              trialEndsLabel={
                license.status === "trial" && license.trialEndsAt
                  ? formatDate(license.trialEndsAt, "dayMonth")
                  : null
              }
            />
          </div>
        </div>
        {/* pb-24 on phones keeps the floating + button clear of the last row/link. */}
        <div className="dashboard-content p-4 pb-24 sm:p-6 sm:pb-6 animate-fade-in print:p-0 print:animate-none">
          {license.isRestricted && !pathAllowed ? (
            <RestrictedNotice license={license} />
          ) : navBlocked ? (
            <NavBlockedNotice />
          ) : (
            <>
              {license.isRestricted && pathAllowed && <RestrictedBanner license={license} />}
              {children}
            </>
          )}
        </div>
      </main>
      {/* Floating quick-create button — bottom-right. Lets users add a lead,
          client, task, meeting, proposal or service request from anywhere
          without hunting through the sidebar. */}
      {!license.isRestricted && <QuickCreateFab />}
      {/* Ctrl/⌘-K command palette — jump to any module, quick-create, or search
          records. Gets the same role/license-filtered nav as the sidebar. */}
      {!license.isRestricted && <CommandPalette navItems={paletteNavItems} />}
      {/* "How did the call go?" after any Call / WhatsApp launcher, and the
          global Log a call drawer (Ctrl/⌘-K, + Add, the floating button). */}
      {!license.isRestricted && <ActivityLauncher />}
      {/* First-run coachmark tour — runs once, spotlighting nav, search, Ctrl+K,
          quick-create and notifications so a new user isn't overwhelmed. */}
      {!license.isRestricted && <ProductTour />}
    </div>
    </ConfirmProvider>
    </ToastProvider>
  );
}

function RestrictedBanner({ license }: { license: any }) {
  return (
    <div className="mb-6 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-amber-50/60 p-3.5 flex items-center gap-3 text-sm shadow-sm">
      <div className="size-9 rounded-lg bg-amber-100 grid place-items-center flex-shrink-0">
        <AlertTriangle className="size-4 text-amber-700" />
      </div>
      <div className="flex-1">
        <span className="font-semibold text-amber-900">
          Your license is {license.status}.
        </span>{" "}
        <span className="text-amber-800/80">
          You can still access billing and support to renew. Other modules are paused.
        </span>
      </div>
      <Link href="/dashboard/billing" className="btn-accent text-xs whitespace-nowrap">
        Renew now
      </Link>
    </div>
  );
}

function RestrictedNotice({ license }: { license: any }) {
  return (
    <div className="max-w-2xl mx-auto mt-12 card-elevated p-10 text-center brand-soft">
      <div className="size-16 mx-auto rounded-2xl bg-amber-100 grid place-items-center shadow-md">
        <AlertTriangle className="size-8 text-amber-600" />
      </div>
      <h1 className="text-2xl font-bold mt-5 tracking-tight">
        Your license is {license.status}
      </h1>
      <p className="text-muted-foreground mt-2 max-w-md mx-auto">
        {license.reason ?? "Your subscription needs attention before you can continue using the app."}
      </p>
      <div className="mt-6 space-y-2 text-sm text-left bg-secondary/60 rounded-xl p-4 border border-border/60">
        <Row label="Package" value={license.packageKey ?? "—"} />
        <Row label="Status" value={license.status} />
        <Row label="License end" value={license.licenseEndAt?.toLocaleDateString("en-IN") ?? "—"} />
      </div>
      <div className="mt-6 flex gap-2 justify-center">
        <Link href="/dashboard/billing" className="btn-primary">
          Renew subscription
        </Link>
        <Link href="/dashboard/support" className="btn-secondary">
          Contact support
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
