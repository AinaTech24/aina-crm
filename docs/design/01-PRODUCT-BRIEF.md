# 01 — Product Brief

> Read this before designing anything. The constraints in §5 are not preferences.

---

## 1. What the product is

**Aina CRM** is a multi-tenant SaaS for **Indian Mutual Fund Distributors (MFDs)** —
independent financial advisory firms that sell mutual funds, insurance and
related products to retail investors and earn trail commission on the assets
they manage.

It is not a generic CRM. It is the **entire operating system of an advisory firm**:
client records, portfolio data pulled from the registrars, SIP tracking,
compliance registers, staff attendance, automated client messaging, and the
reports the firm's owner uses to run the business.

**Scale of the product:** 303 screens, 9 navigation groups, 44 report types.
This is enterprise-grade software, not a 12-screen app.

## 2. Who uses it

Four very different people use the same product. The design has to serve all four.

| Persona | Age / tech level | What they do all day | What they need from the UI |
|---|---|---|---|
| **Firm owner / MFD** | 40–60, low-to-medium | Checks AUM, revenue, team performance. Logs in daily for 10 minutes. | Big numbers, plain language, zero learning curve |
| **Relationship Manager (RM)** | 25–40, medium | Meets clients, records outcomes, sends proposals. Lives in the client 360 screen. | Fast search, everything about one client on one page |
| **Back-office / Operations** | 25–45, medium | Imports registrar files, fixes failed SIPs, reconciles brokerage. Scans dense tables for hours. | Information density, keyboard speed, scannable tables |
| **Compliance officer** | 35–55, low | Maintains registers, tracks KYC and nomination gaps, prepares for audit. | Clear status, obvious gaps, printable output |

**The hardest constraint is the owner.** Many are 50+, have used desktop
software for twenty years, and are not comfortable with modern app conventions.
Hamburger menus, hidden actions, gesture-only controls and icon-only buttons all
fail with this group.

> **Design rule:** if a 55-year-old who has never used a SaaS product can't find
> it in five seconds, it's in the wrong place.

## 3. What the redesign should achieve

In priority order:

1. **Premium.** It should look worth ₹60,000/year. Today it reads as functional,
   not expensive.
2. **Calm under density.** Screens carry a lot of data and that can't change.
   The design must make density feel organised rather than overwhelming.
3. **Learnable without training.** Onboarding a new firm currently costs real
   support hours. Good design directly reduces that cost.
4. **Trustworthy.** This handles people's life savings. It must feel like a
   bank, not a startup.
5. **Distinctly Indian-professional.** Competitors (WealthElite, InvestWell,
   IFA-Planet) look dated. That's the opening.

## 4. What is already good — keep it

Don't throw these away; they were deliberate and they work:

- **One accent colour.** Exactly one colour means "act on this". Charts
  deliberately share no hue with it, so red inside a chart still reads as
  "problem", not "series 1".
- **Plain-English subtitle on every page.** Every screen opens with a title plus
  one line explaining what the screen is for, in words a non-specialist
  understands. Keep this pattern.
- **Nine shallow nav groups** rather than deep nesting. Most screens are two
  clicks from anywhere.
- **Light, roomy cards on a slightly darker page.** Cards read as objects
  sitting on a surface. (The page ground is intentionally ~4% darker than the
  card — an earlier version had a 1.4% gap and every panel dissolved into the
  background.)

## 5. ⚠️ Non-negotiable constraints

### 5.1 The accent colour is per-firm, decided at runtime

This is the single most important constraint and the easiest to miss.

Every MFD firm on the platform sets its own brand colour. At runtime the app
derives the **entire interactive colour family** — buttons, focus rings, active
nav pill, hover tints, links, selected states — from that one hue.

The default happens to be Aina red (`#B71A20`). **That is a default, not the
design.** A firm running indigo, or forest green, or navy, gets the same product
with every interactive surface re-hued.

**What this means for the designer:**
- Never hardcode red. Express the accent as a single variable used everywhere.
- The design must survive any hue from 0–360°, including low-contrast ones
  (yellow, lime) and dark ones (navy, maroon).
- Semantic colours (success green, warning amber, danger red, info blue) are
  **fixed** and do not re-hue. Only the brand accent moves.
- Charts use a fixed 6-colour ramp that must not collide with any possible
  brand hue.

### 5.2 Light mode only

Dark mode was built, then **deliberately deleted**. Don't design one. Don't add
a theme toggle. Every surface is light.

### 5.3 11px is the text floor

Ops staff read PAN numbers, folio numbers and NAV dates for hours. The app
previously had 8px, 9px and 10px text in ~1,000 places; all of it collapsed onto
an 11px minimum token. Nothing may be smaller than 11px, ever.

### 5.4 Indian financial formatting

- Currency is **₹**, never `$`
- Large numbers use the **Indian system**: ₹1.25 L (lakh = 100,000),
  ₹634.98 Cr (crore = 10,000,000). **Never** M or K.
- Dates are **DD-MM-YYYY** or `15 Sep 2026`. Never MM/DD.
- Financial years run **April–March**, written `FY 2026-27`
- Domain terms appear on screen and must not be "simplified" away: **AUM, SIP,
  NAV, PAN, KYC, ARN, RTA, CAMS, KFintech, folio, XIRR, LTCG/STCG, AMC, NFO**

### 5.5 Motion is stripped

Animations were removed deliberately. Transitions are colour-only, 100–150ms.
No slide-ins, no parallax, no scroll-triggered reveals, no skeleton shimmer.
Static, instant, calm.

### 5.6 Desktop-first

Primary target is **1440×900**. The app must work down to 1280px, and be usable
on a tablet. There is a **separate native mobile app** (React Native), so the
web app does not need to be phone-perfect — with one exception: **client-facing
public pages** (see §6) are opened on phones by investors and must be
mobile-first.

## 6. Two distinct audiences, two visual registers

The product has an inside and an outside, and they should not look identical.

**Inside — the staff app** (`/dashboard/*`, 290+ screens)
Dense, efficient, information-first. Sidebar navigation. Tables everywhere.
Designed for someone who is here eight hours a day.

**Outside — client-facing public pages** (~10 screens, no login)
A risk-profile questionnaire, a feedback form, a portfolio statement, a
document-signing page. These are opened by **investors** — ordinary people, on
phones, often once, often over 60 years old. They are branded with **the firm's**
logo and ARN, not Aina's.

These must be: mobile-first, one question or one idea per screen, large touch
targets, large type, no jargon, no navigation chrome, obviously trustworthy.

## 7. Tone of voice

Every screen has a plain-English subtitle. Keep that discipline in any new copy.

- **Do:** "Clients whose SIP failed in the last 30 days — call these first."
- **Don't:** "SIP Rejection Management Module"

Direct, warm, second person. Client-facing text addresses the investor as
"you" and "your", never "the client".

## 8. Competitive context

Competitors are **WealthElite (REDVision), InvestWell, IFA-Planet, AssetPlus**.
All are functional and visually dated — dense grey tables, 2010-era chrome,
heavy use of blue gradients.

Aina already matches or beats them on features. **The redesign is the
differentiator.** Look at them for feature parity, not for visual direction.
