# UI/UX and the Switching Problem

**How to beat Investwell, Wealth Elite, theMFBox, IFA-Planet, IFA NOW and Wylth on
experience — when the MFD's muscle memory is the incumbent's strongest moat.**

Companion to [BACK_OFFICE_STRATEGY.md](BACK_OFFICE_STRATEGY.md). Research: September 2026.

---

## 1. The tension, stated honestly

An ops person who has run the same Monday-morning report in Investwell for six years does
not want a better report. They want *that* report, in the place they expect it. Familiarity
is real switching friction and it is the incumbents' best asset.

There are two obvious strategies and both are wrong:

- **Clone their UI.** You inherit their flaws, you look like a cheap copy, and you will
  never clone it well enough to beat actual muscle memory. You also lose the one thing
  that makes you worth switching to.
- **Build something beautiful and completely different.** The MFD's ops person cannot find
  the brokerage report they run every month, and churns in week two.

The answer is a third thing:

> **Keep the nouns. Change the verbs.**
>
> Preserve their *vocabulary and information scent* — report names, folio/scheme hierarchy,
> "AUM", "SIP Book", "Brokerage", "Capital Gains Statement", "Folio Master". Replace their
> *interaction model* — deep menu trees become search-first navigation, static reports
> become drillable numbers, dashboards become worklists.
>
> A switcher should feel "everything I know is still here, and it takes a third of the clicks."

---

## 2. What the research actually found

### Scale and satisfaction (Google Play, Sept 2026)

| App | Audience | Rating | Reviews | Downloads |
|---|---|---|---|---|
| Wealth Elite (investor) | Investor | 4.6★ | 8,570 | **5L+** |
| Mint by Investwell (investor) | Investor | 4.7★ | 19,900 | 1L+ |
| Advisor X by REDVision (MFD) | MFD staff | 4.3★ | — | — |
| Wylth Pro (MFD) | MFD staff | 4.5★ | **61** | 5K+ |
| InvestWell (generic, non-white-label) | Investor | 3.6★ | — | — |
| Investwell white-labels (Golechha, PFS MONEY, SymphoniaWealth, Dhanashree, TIIS) | Investor | 4.6–5.0★ | — | — |

Three things fall out of this table:

1. **The investor app is the mass surface, not the MFD app.** Wealth Elite has 500,000+
   investor installs. That is where reputation is made — and it is currently your weakest
   surface (a read-only magic link showing stale snapshot values).
2. **White-labelling measurably improves ratings.** Investwell's generic app sits at 3.6★
   while the same product under the MFD's own brand rates 4.6–5.0★. Investors trust their
   advisor's brand, not the vendor's. You already have per-tenant domains — this validates
   that investment.
3. **Wylth, the newest and most modern-looking product, has 61 reviews.** Modern design
   alone does not win this market.

### The universal weakness: findability

This is the single most important finding in the research.

**Investwell Mint's top critical review** (8 people marked it helpful) says the app does
not show XIRR, has no web browser access, and has no Excel download. The vendor replied,
publicly, that **all three exist** — XIRR is in a report called *"My Journey"*, the web
portal is at `<advisor-domain>.investwell.app`, and Excel export is available there.

A paying user of a 4.7★ product, with 19,900 reviews behind it, concluded that three core
features were missing. They were not missing. They were unfindable, and one of them was
hidden behind a name — "My Journey" — that carries no information scent for someone
looking for XIRR.

**Wylth's critical review** says: *"A lot of time will be wasted in searching for the
necessary things."* The vendor's public reply concedes it: *"we're actively improving both
navigation and features."*

Two different products, two different generations, same failure. **Findability is the
category's open wound.**

### Why MFDs switch (mfecosystem, 2026)

1. Teams keep **manual spreadsheet backups** because they don't trust the software's reports
2. **Outdated client-facing interface** compared to modern fintech apps
3. Hidden costs — basic features sold as premium add-ons
4. Limits on **multi-branch / multi-advisor** scale
5. No **white-label** branding
6. **Lengthy onboarding requiring manual data entry**
7. Opaque pricing

Trigger #1 is the important one, and it is not a UI problem dressed as one. *People keep
spreadsheets because they cannot see where a number came from.* No incumbent shows its
working. You already compute the data you'd need to (see §4.3).

### Information architecture of the incumbents

Investwell's helpdesk reveals the real module taxonomy of Mint: *Portfolio Reports ·
Business Analytics Reports · Compliance Reports · Brokerage Reports · SIP Reports ·
Utilities for Advisors · NSE/BSE/MFU · Data Management · Entry of Different Types of Assets*.

Note what else it reveals: **"Investwell CRM" is a separate product with 7 help articles**,
against 60+ for the back office. Their CRM is a bolt-on. Yours is the spine. Do not copy
their separation — the integration *is* the product.

theMFBox organises around *Admin Reports · Investor Reports · Analytical Reports ·
Tools & Calculators · Research*. Wealth Elite around *Multi-Asset · Portfolio Analysis ·
Goal GPS · Video KYC · Online ATM · Rebalancing · Brokerage Analytics · Research*.

Visually all of them converge on the same thing: blue-and-white chrome, a left sidebar,
KPI tiles with large numbers ("AUM 49.27", "SIP ₹2,188.00"), donut charts, dense tables.
**Nobody is winning on aesthetics. The bar is interaction quality.**

---

## 3. Where your UI stands today

Verified against the code, not assumed.

| Asset | State |
|---|---|
| `src/components/layout/CommandPalette.tsx` (447 lines) | Real ⌘K palette — deep nav, omni-actions, recent records, live record search. **Good bones.** |
| `GET /api/search` | Covers investors, folios, leads, SIPs, service requests, documents. **Does not cover schemes, settings or help.** (Reports are now matched client-side in the palette — see below.) |
| `src/app/dashboard/reports/page.tsx` + `ReportsGrid` | 94 reports, 18 groups, one-line `desc` per report, per-user hide/restore, favourites, recents, collapsible groups **and a search box**. Better than I first reported — but until Sept 2026 that search matched the label and group name only, not the description it displays. |
| Page header convention | `.page-title` + one-line plain-English `.page-subtitle` on every page. Better than any incumbent. |
| One-accent design contract | Single accent, hover tint never a fill, nav pill follows tenant primary. Calmer than competitors' rainbow dashboards. |
| White-label domains | Per-tenant vanity subdomain + custom domain already shipping. **Switching trigger #5 already solved.** |
| Command Center | Prioritised cross-module worklist. **No incumbent has this.** |
| `dataQuality` telemetry | Already computed per valuation — unpriced holdings, unknown cost, incomplete history. **Computed but not surfaced as UI.** |
| Dark mode | **Absent** — no `prefers-color-scheme` in `globals.css` |
| Multilingual | **Absent** — no i18n library |
| Mobile web | Responsive-capable but the report pack is not phone-readable |

**The gap that mattered — now closed (Sept 2026).** The palette searched *records* while
the reports lived in a menu: typing "capital gains" into ⌘K returned clients, not the
report. That was precisely the Investwell "My Journey" failure reproduced in this product.

The catalog now lives in `src/lib/reports/catalog.ts`, shared by the hub and the palette,
with an `aliases` field carrying incumbent vocabulary. ⌘K matches all 94 reports locally
(no round-trip), and the hub's search matches label + description + aliases. Verified:
`LTCG` → Realised Capital Gain (whose label contains neither word), `brokerage` → Revenue
Intelligence + Trail Forecast, `goal gps` → the goal reports.

---

## 4. Seven design principles, each with the evidence and the change

### 4.1 Search is the primary navigation, not a convenience

*Evidence: Investwell's hidden XIRR; Wylth's admitted navigation problem.*

- Index **everything** in ⌘K. All 94 reports: **done**. Still to add — schemes, settings
  pages, help articles, and more actions ("import RTA file", "run reconciliation").
- Add a **synonym/alias layer** so incumbent vocabulary resolves. `WBR9` → Folio Master
  import. `My Journey` → Point-to-Point XIRR. `CG statement`, `capital gain`, `LTCG` →
  Realised Capital Gains. `Online ATM` → instant redemption. This is a lookup table, not
  an ML problem, and it is worth more than any single feature.
- Put `Press ⌘K` visibly in the header. Teach it in first-run.
- The reports hub search now matches name, description and aliases. Still to add: the
  **output columns** of each report, so "the report with a TDS column" finds it.

### 4.2 Never make the user learn a name to find a number

*Evidence: "My Journey" carries no scent for XIRR.*

- Every report gets a plain-English subtitle (you already do this) **and** an explicit
  "answers the question: …" line.
- Put the number where it is asked for, not only in a report. XIRR belongs on the client
  header, not exclusively inside a report the user must know the name of.
- Every KPI tile links to the report that explains it.

### 4.3 Show your working — the anti-spreadsheet feature

*Evidence: the #1 switching trigger is teams keeping spreadsheet backups because they
don't trust the reports.*

This is the highest-leverage UX idea in this document, and nobody in the category does it.

- Make **provenance a UI primitive.** Every AUM, XIRR, gain and brokerage figure carries an
  affordance: *"as of NAV 15-Sep · 142 of 144 holdings priced · ₹1.2L unpriced — why?"*
  You already compute all of this in `dataQuality`; it is currently invisible.
- Make **every number drillable to the rows that produced it** — AUM → folios → schemes →
  transactions → the RTA file and row it came from. The ledger work in Phase A of the
  strategy doc makes this cheap; `raw_feed_row` already exists.
- Surface the reconciliation break count as a **trust badge**, not a hidden report: "1,240
  folios reconciled to the RTA · 3 breaks · last checked 06:12."

Positioning line that falls out of this: *"the only back office that shows you where every
number came from."* You cannot say that about any competitor, and it directly answers the
reason MFDs abandon their current vendor.

### 4.4 Density is a feature for ops, an anti-feature for clients

MFD back-office staff are power users on 1366×768 laptops doing repetitive work. Consumer
SaaS whitespace actively hurts them.

- Ship a **density toggle** (comfortable / compact) on all data tables; default compact for
  `ops` and `back_office` roles.
- Full **keyboard navigation** in tables — arrow keys, `e` to edit, `/` to filter.
- Keep the column manager and saved views you already have; add **shared team views** so a
  branch head can publish "the view we use for the Monday review."
- Then invert it completely for the investor surface: generous, calm, mobile-first.

### 4.5 Open to work, not to charts

Every incumbent opens on a dashboard of charts. Charts are for the monthly review; the
daily job is a queue.

- You already have **Command Center** — a prioritised cross-module worklist. Make it the
  default landing for ops/RM roles, charts one click away.
- This is a genuine category difference. Lead the demo with it.

### 4.6 The client-facing surface is judged against Groww, not against Investwell

*Evidence: switching trigger #2; Wealth Elite's investor app has 5L+ installs at 4.6★.*

Your portal today is a shared magic link, read-only, three scopes, showing values from the
last RTA snapshot while the RM's PDF shows live valuation. **It is the weakest surface in
the product and it is the one the MFD's clients see.** Fix order:

1. Repoint it at the valuation engine so client and RM see one number.
2. Real login (email/OTP), then units, cost, gain, XIRR, transactions, statements, capital
   gains, goals, documents.
3. White-label investor app — extend the existing Expo shell; the auth, offline queue, push
   and design system are already there.

### 4.7 Onboarding with zero manual data entry is a UX feature

*Evidence: switching trigger #6.*

Your RTA mailback pipeline and 50,000-row importer are the answer, but they currently live
in a settings-shaped page. Make them the **first-run experience** with a visible progress
narrative: *connect forwarding → request historic mailback → 8,400 clients and 26,000
folios materialising → here is what reconciled and what didn't.*

---

## 5. What NOT to copy

- **Deep menu trees.** `Products ▸ submenu ▸ submenu` is how XIRR ends up unfindable.
- **A separate CRM product.** Investwell's CRM has 7 help articles against 60+ for the back
  office. Their split is a weakness; your integration is the whole pitch.
- **Bespoke-looking report pages.** You have 34 of them against 50 generic ones. Converge
  the chrome — same header, same filter bar, same export, same provenance line — even where
  the body differs.
- **Feature-name branding.** "Goal GPS", "Online ATM", "My Journey" read well in a brochure
  and cost you in search. Name things what they are; keep the cute name as an alias.

---

## 6. Parity gaps worth closing (cheap, visible)

| Gap | Evidence | Effort |
|---|---|---|
| **Dark mode** | Explicitly requested in a Wealth Elite review; you already have a dark sidebar and a token-based accent system | Low |
| **Multilingual** | Wealth Elite ships 9 languages — materially relevant for Tier-2/3 RM and ops staff | Medium |
| **Mobile-readable reports** | An Investwell user believed web access didn't exist because it wasn't usable on a phone | Medium |
| **Accessibility** | Wealth Elite shipped "accessibility improvements for SEBI compliance" in Aug 2026 — this is becoming table stakes | Medium |
| **Excel export everywhere** | Same Investwell review; you have it on report pages, make it universal and obvious | Low |

---

## 7. The switching kit — treat migration as a product

Switching cost is the whole game. Three artefacts, each of which is mostly content work:

1. **A terminology map.** A real page in the product: *"Coming from Investwell / Wealth
   Elite / theMFBox?"* — a two-column table of their report name → yours. Wire the same
   table into the ⌘K alias layer so it works from day one, silently.
2. **A "Switch in a week" wizard.** Connect RTA mailback → generate the historic-mailback
   request text for CAMS and KFintech → watch the book materialise → end on a reconciliation
   report that shows exactly what tied. Because every back office in this market rebuilds
   from the same RTA feeds, the data is not locked in the incumbent — and you already own
   the hardest part of the pipeline.
3. **A ten-minute demo path.** Command Center (nobody has this) → click a number, drill to
   the RTA row it came from (nobody has this) → ⌘K to any of 87 reports by name or by their
   old vendor's name → a workflow that already messaged the client about a bounced SIP,
   with the compliance trail attached.

---

## 8. Prioritised backlog

**Now — days, not weeks, and disproportionate payoff**
1. ~~Index all 94 reports so ⌘K finds them~~ — **done**, `src/lib/reports/catalog.ts`.
2. ~~Ship the incumbent-terminology alias table~~ — **done**, 60 reports aliased.
3. ~~Widen the reports-hub search past the label~~ — **done** (label + desc + aliases).
   Still to add: each report's output columns.
4. Extend the palette index to schemes, settings pages and help articles.
5. Add the provenance line (`as of · n priced · n unpriced`) to every AUM/XIRR surface —
   `dataQuality` already computes it.

**Next — one quarter**
5. Drill-through on every number, down to the RTA file and row.
6. Density toggle + keyboard table navigation + shared team views.
7. Command Center as the default landing for ops/RM.
8. Dark mode.
9. Converge the 34 bespoke report pages onto shared chrome.

**Then — with Phase B/E of the strategy doc**
10. Portal repointed at the valuation engine, real login, full parity.
11. White-label investor app on the existing Expo shell.
12. Multilingual, accessibility pass, mobile-readable reports.
13. The switching kit as a shipped, demoable product surface.

---

## Sources

- Google Play listings and user reviews, Sept 2026: [Wealth Elite](https://play.google.com/store/apps/details?id=com.redvision.wealth_elite&hl=en_IN) · [Mint by Investwell](https://play.google.com/store/apps/details?id=com.iw.mint.app&hl=en_IN) · [Wylth Pro](https://play.google.com/store/apps/details?id=com.wylth.ifa&hl=en_IN)
- [InvestWell Helpdesk — product module taxonomy](https://help.investwellonline.com/support/solutions)
- [Outgrown Wealth Elite, IFA-Planet, Investwell, TheMFBox or OFA? — mfecosystem](https://mfecosystem.com/signs-time-to-switch-mfd-software)
- [Wealth Elite — REDVision](https://www.redvisiontechnologies.com/mutual-fund-software-for-distributors.php) · [theMFBox — AdvisorKhoj](https://www.advisorkhoj.com/mutual-fund-software-in-india) · [Wylth platform](https://www.wylth.com/platform) · [IFA-Planet](https://www.ifaplanet.com/) · [IFANOW](https://ifanow.com/solutions/endtoend-mf-solutions)
- [Back-Office & SaaS Platforms for MFDs — Creso](https://creso.in/blog/back-office-saas-platforms-mfd)
