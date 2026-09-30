# 05 — Component Inventory

What already exists in the build. A redesign that reuses these names is far
cheaper to ship than one that invents a parallel set.

---

## 1. Utility classes (defined in `globals.css`)

These are the real design system. Most screens are assembled from them.

### Layout & surface
| Class | What it is |
|---|---|
| `.card-surface` | **The workhorse.** `rounded-xl` + white + `border` + `shadow-sm`. Used on nearly every panel in the app. |
| `.card-elevated` | Raised variant |
| `.card-equal` | Equal-height card in a grid row |
| `.glass-card` / `.glass-panel` | Translucent + backdrop blur |
| `.dashboard-content` | Page content wrapper |
| `.divider-soft` | Low-contrast horizontal rule |

### Typography
| Class | What it is |
|---|---|
| `.page-title` | 24px bold, tight tracking, flex row with icon. **On every page.** |
| `.page-subtitle` | 14px muted — the plain-English explainer line |
| `.section-title` / `.section-subtitle` | Inner-panel headings |
| `.text-gradient` | Gradient text fill |
| `.line-clamp-2` / `.line-clamp-3` | Truncation |
| `.tabular-nums` | Aligned numerals — **all financial figures** |

### Buttons
| Class | What it is |
|---|---|
| `.btn-primary` | Solid accent, white text, `rounded-lg`, 150ms colour transition |
| `.btn-accent` | Same fill, heavier weight (historically a separate gradient; now identical) |
| `.btn-secondary` | Ghost card style |
| `.btn-ghost` | Transparent, hover tint |
| `.btn-danger` | Destructive |
| `.btn-icon` | Square icon-only |

> Note `.btn-primary` and `.btn-accent` currently render almost identically —
> a leftover from the multi-accent era. Worth collapsing or genuinely
> differentiating in the redesign.

### Navigation
`.nav-link` · `.nav-link-active` (solid accent pill) · `.nav-link-icon` ·
`.nav-sec-body` · `.sidebar-collapsed`

### Data display
| Class | What it is |
|---|---|
| `.table-modern` | The standard table. Sticky `thead`, 11px uppercase tracked headers on a tinted bar, hover rows, hairline row dividers. |
| `.table-scroll` | Horizontal scroll container with themed scrollbar |
| `.kpi-card` / `.kpi-hero` | Stat tiles |
| `.chip` / `.chip-dot` | Badges and status dots |
| `.skeleton` | Loading placeholder (static) |

### Inputs
`.input-base` — shared field styling. Native checkboxes/radios are re-tinted to
the tenant accent via `accent-color`.

### Brand decoration
`.brand-bar` · `.brand-gradient` · `.brand-mesh` · `.brand-soft` ·
`.auth-swap` · `.hover-lift` · `.hover-glow-cyan` · `.hover-glow-emerald` ·
`.pulse-dot` / `.pulse-warning-dot` / `.pulse-danger-dot` ·
`.animate-premium-*` · `.ai-icon-animated`

> ⚠️ Many of these are **legacy from the pre-"one accent" era** and are
> inconsistently applied. The `hover-glow-cyan` / `hover-glow-emerald` pair in
> particular no longer means anything — both resolve to the same accent.
> Treat this whole block as up for deletion.

---

## 2. Shared UI primitives (`src/components/ui/`)

Hand-rolled, shadcn-style. 16 components:

`Avatar` · `ConfirmDialog` · `ConfirmProvider` · `DateField` · `DatePicker` ·
`DateRangePicker` · `Dialog` · `MultiSelectField` · `PasswordInput` · `Select` ·
`SelectField` · `Sheet` · `ThemeDate` · `ThemeSelect` · `TimeField` · `Toast`

**Notably missing** (and worth adding as part of a redesign): Button, Input,
Card, Badge, Table, Tabs, Tooltip, Popover, Skeleton. These exist today only as
utility classes, not components — which is why button styling has drifted.

---

## 3. Feature component folders

Count = `.tsx` files. Size indicates where the design effort concentrates.

| Files | Folder | Notes |
|---|---|---|
| 75 | `calculators` | 20+ planning calculators. Largest surface in the app. |
| 57 | `investors` | Client 360, tables, merge hub, holdings |
| 56 | `dashboards` | Widgets, KPI tiles, charts |
| 32 | `common` | Shared building blocks |
| 28 | `super-admin` | Platform admin |
| 25 | `reports` | Report shells, `TaxReportShell`, filter bars |
| 17 | `layout` | Sidebar, nav, top bar, `CustomizableNav` |
| 17 | `families` | Family mapping |
| 16 | `ui` | Primitives (above) |
| 16 | `leads` | Pipeline |
| 14 | `settings` | Settings forms |
| 9 | `workflow-rules` | Canvas + node config |
| 9 | `review-meetings` | Meeting prep |
| 8 | `proposals` | |
| 7 | `content-library`, `compliance`, `attendance` | |
| 6 | `risk-profile`, `public`, `insurance`, `goal-planning`, `finances` | |
| 5 | `sip-rejections`, `campaigns`, `auth` | |
| 4 | `workflow`, `rta`, `nba`, `leave`, `landing`, `discovery`, `ai` | |
| 3 | `trash`, `induction`, `employees`, `commission`, `command-center`, `blueprints` | |
| 2 | `templates`, `tasks` | |

---

## 4. Icons

**Lucide React** throughout. Standard sizes: `size-3.5` (14px) inline,
`size-4` (16px) nav/buttons, `size-6` (24px) page titles.

Icons carry real semantic weight in the sidebar — see the icon column in
`03-INFORMATION-ARCHITECTURE.md`. Keep the mapping unless there's a reason not to.

---

## 5. Charts

Custom SVG plus React Flow for the workflow canvas. All chart colour comes from
the fixed `--chart-1…6` ramp (see `02-DESIGN-TOKENS.md` §1.5).

Chart types in use: line, area, bar, stacked bar, donut/pie, sparkline, gauge,
funnel, heatmap-ish grids.

---

## 6. ⚠️ Known implementation traps

Real bugs that have bitten this codebase. A designer doesn't need these, but
**whoever implements the redesign does.**

1. **`@apply size-[arbitrary]` silently drops the whole declaration.** This made
   every nav icon invisible once. Use plain CSS for arbitrary sizes.
2. **A bare single-class rule inside `@layer components` gets tree-shaken.**
   Same outcome, same cause. Use top-level CSS.
3. **Always verify CSS changes against the shipped bundle**, not the source —
   both bugs above look fine in the source file.
4. **`darkMode: ["class"]` must stay in the Tailwind config** even though dark
   mode is gone. Removing it falls back to the `media` strategy, which fires
   every `dark:` utility for anyone whose OS is dark — with no dark palette
   behind it.
5. **A sidebar item needs entries in three separate lists** to appear.
6. **`CustomizableNav` caches per-user layout in localStorage** and only
   *appends* new items. Regrouping the nav requires bumping its version constant
   or existing users keep the old arrangement.
7. **Never blanket-regex whitespace** across the codebase.
