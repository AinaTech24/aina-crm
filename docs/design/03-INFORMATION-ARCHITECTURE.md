# 03 — Information Architecture

**303 screens.** Four distinct zones, each with its own navigation model.

| Zone | Screens | Who sees it | Nav model |
|---|---|---|---|
| **A. Staff app** (`/dashboard/*`) | ~250 | Firm staff, logged in | 256px left sidebar, 9 groups |
| **B. Settings** (`/dashboard/settings/*`) | 22 | Owner / admin | Sub-nav inside the shell |
| **C. Platform admin** (`/super-admin/*`) | 25 | Aina's own staff only | Separate shell |
| **D. Public / client-facing** | ~18 | Investors + prospects, **no login** | No nav at all |

---

## A. Staff app — the 9 sidebar groups

Ordered by **how often someone opens it**, not by how the system is built.
Daily work at the top, configuration at the bottom.

Sidebar is **256px expanded / 64px collapsed**, open by default, pin state saved
per user. Above the groups sits a **Dashboards dropdown** (not a group):
*My Dashboards · Team Dashboard · Team Scorecard*.

### 1. Today — *the daily driver*
| Screen | Icon | Purpose |
|---|---|---|
| **My Day** | Inbox | Landing page. Everything needing attention today. |
| Tasks | ListChecks | Task list + daily tracker |
| Meetings | Presentation | Client review meetings, prep packs |
| Service Requests | LifeBuoy | Client service tickets |
| Client Feedback | Gauge | NPS responses |

### 2. Clients — *the book of business*
| Screen | Icon | Purpose |
|---|---|---|
| Leads | UserPlus | Prospect pipeline + nurture |
| **Clients** | Users | The client list. The most-used screen in the app. |
| Family Mapping | HeartHandshake | Group clients into households |
| Client Discovery | ClipboardList | Structured fact-find |
| Risk Profile | Gauge | Risk questionnaires + bulk age-based assignment |

### 3. Advice — *what you recommend*
| Screen | Icon | Purpose |
|---|---|---|
| Calculators | Calculator | 20+ planning calculators (largest component folder: 75 files) |
| Goal Planning | Target | Client goals with progress tracking |
| Financial Plans | ClipboardList | Full written financial plans |
| Proposals | FileSignature | Investment proposals |
| Insurance | Shield | Policies, claims, renewals, protection-gap, commission |

### 4. Operations — *the back office*
| Screen | Icon | Purpose |
|---|---|---|
| MF Transactions | Repeat | All mutual fund transactions |
| SIP Book | TrendingUp | SIP tracker, at-risk SIPs, rejections |
| Business Entries | Briefcase | Manual business logging |
| Expected Inflows | IndianRupee | Forecast incoming money |
| RTA File Imports | FolderArchive | Import CAMS / KFintech registrar files |
| Reconciliation | Scale | Match brokerage against expectation |
| Activity Log | PhoneCall | Calls, meetings, notes |

### 5. Insights — *running the firm*
| Screen | Icon | Purpose |
|---|---|---|
| **Reports & MIS** | BarChart | Catalogue of **44 reports** (listed below) |
| Portfolio Intelligence | PieChart | Cross-book portfolio analytics |
| Practice Finances | Wallet | Firm P&L, expenses |
| Commission Reconciliation | CreditCard | Brokerage received vs due |
| Aina CRM Copilot | Bot | In-app AI assistant (read-only, ask-your-book) |

### 6. Automation — *the engine*
| Screen | Icon | Purpose |
|---|---|---|
| Workflow Rules | Workflow | Visual DAG builder (React Flow canvas) |
| Workflow Actions | Zap | Action library |
| Automation Monitor | Activity | Live + historical workflow runs |
| Templates | LayoutTemplate | Email / WhatsApp / SMS template designer |
| Communications | MessageSquare | Unified inbox + outbox + response tracking |
| Marketing Campaigns | Megaphone | Bulk campaigns to segments |
| AINA Content Library | Library | Shared marketing creatives |

### 7. Compliance — *the moat*
| Screen | Icon | Purpose |
|---|---|---|
| Compliance Center | ShieldCheck | Compliance dashboard |
| DDQ Readiness | FileCheck | Due-diligence questionnaire score |
| Circular Digest | Newspaper | AMFI/SEBI circulars, summarised |
| SOP Library | ScrollText | Standard operating procedures |
| Documents | FolderOpen | Document vault |
| Audit Log | ClipboardCheck | Immutable action trail |
| Legal Registrations | Stamp | ARN, GST, entity registrations |
| Sub-Distributors | Network | Sub-broker management |

### 8. People — *the team*
| Screen | Icon | Purpose |
|---|---|---|
| Employees | UserCog | Staff records, org chart, compliance |
| Attendance | CalendarCheck | Clock-in, grid, regularisation, holidays |
| Leave Applications | CalendarOff | Leave requests + approval |
| Induction | GraduationCap | New-joiner lessons + exam |
| Announcements | BellRing | Internal notice board |

### 9. Setup & data — *configure once*
| Screen | Icon | Purpose |
|---|---|---|
| Scheme Master | Boxes | Mutual fund scheme reference data |
| Products & Services | Package | What the firm sells |
| AMC Empanelments | Building | AMC tie-ups |
| Find Duplicates | CopyCheck | Duplicate client detection |
| Merge Clients | Copy | 5-option merge hub (merge / differ / merged / suggestions / system) |
| Trash | Trash | Soft-deleted records |

---

## The 44 reports

The Reports catalogue is a 3-column card grid. Every report shares one shell:
title, plain-English subtitle, filter bar, optional chart, data table, export.

**Business & revenue** — business-mis · growth-mis · business-projections ·
net-sales · revenue-intelligence · trail-forecast · impact-attribution ·
back-office-work · efforts

**Clients & risk** — churn-risk · cross-sell · referral-radar · risk-drift ·
suitability-matrix · lead-funnel · kyc-tracker · nomination-tracker ·
financial-checklist

**SIP & transactions** — sip-health · sip-expiry · sip-rejection · redemption ·
sif-status

**Taxation** (shared 5-tab shell) — realised-capital-gains ·
notional-capital-gains · dividend-report · fy-wise · tax-package ·
tax-harvesting

**Schemes & products** — mf-selection-criteria · shortlisted-schemes ·
equity-team · other-services · marketing-assets

**Insurance** — insurance-production · insurance-claims

**Team & compliance** — branch-rm · arn-euin-tracker

**Custom** — custom report builder (list / new / edit)

---

## B. Settings — 22 screens

Reached from the shell, presented with its own sub-navigation:

Profile · Firm Profile · Organisation · Appearance · Security · Email ·
WhatsApp · Integrations · Masters · Custom Fields · Onboarding Fields ·
Lead Forms · Task Templates · Notification Templates · Assignment Rules ·
Desks · Targets · Blueprints · Induction · Risk Profile · Readiness

---

## C. Platform admin (`/super-admin`) — 25 screens

**Aina's own staff only — never seen by an MFD firm.** Visually distinct from
the tenant app so there is no chance of confusing which one you're in.

Tenants · Users · Subscriptions · Packages · Landing Packages · Module Controls ·
Analytics · AWS Monitoring · AI Config · Email · Razorpay · Support ·
Content Library · KB Articles · RTA Inbox · RTA Inbound Mail · Settings

---

## D. Public / client-facing — ~18 screens, **no login, mobile-first**

⚠️ **These are the screens investors actually see.** They carry **the MFD firm's**
logo and ARN, not Aina's. Different design register entirely — see
`01-PRODUCT-BRIEF.md` §6.

### Token-gated (one-time personal links sent by email/WhatsApp)
| Route | Screen |
|---|---|
| `/r/[token]` | **Risk-profile questionnaire** — 8 questions, second person, phone |
| `/f/[token]` | **Feedback / NPS** — 0–10 scale |
| `/p/[token]` · `/portfolio/[token]` | **Portfolio statement** |
| `/d/[token]` · `/fd/[token]` | **Document view / signing** |
| `/portal/[token]` | Client portal |
| `/onboarding/[token]` | Client onboarding form |
| `/lf/[slug]` | Public lead-capture form |

### Marketing & account
Landing page · Login · Signup · Forgot / Reset password · Accept invite ·
Choose plan · Knowledge base (+ article) · Terms · Privacy · Refund

---

## Cross-cutting UI that appears everywhere

- **Command palette** (Ctrl+K) — global search + jump-to-screen
- **Global search** in the top bar
- **Toast notifications** — bottom right
- **Confirm dialogs** — centred modal (replacing native `confirm()`, still in progress)
- **Help & glossary** — explains ARN, KYC, NAV, XIRR for non-specialists
- **Top bar** — firm switcher, notifications, user menu
- **Customisable nav** — users may reorder their own sidebar; layout is cached per user
