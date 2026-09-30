# 02 — Design Tokens (current system)

Extracted verbatim from `src/app/globals.css` and `tailwind.config.ts`.
This is what exists **today**. Treat it as the baseline to improve on, and as
the contract the new design must fit into.

> **Why this matters:** every one of the 303 screens draws its colour from these
> variables. Change the variables and the whole app re-skins at once. A redesign
> expressed as new token values is cheap to ship; a redesign expressed as 303
> bespoke screens is not.

---

## 1. Colour

All colours are stored as **HSL triplets without the `hsl()` wrapper**, so
opacity can be applied per use (`hsl(var(--primary) / 0.9)`).

### 1.1 Surfaces

| Token | HSL | Hex | Role |
|---|---|---|---|
| `--background` | `200 22% 95.5%` | `#EFF3F4` | Page ground — cool paper |
| `--card` | `0 0% 100%` | `#FFFFFF` | Card / panel surface |
| `--popover` | `0 0% 100%` | `#FFFFFF` | Dropdowns, menus, dialogs |
| `--secondary` | `200 20% 95.5%` | `#EFF3F4` | Chips, hover fills, table header |
| `--muted` | `200 18% 95%` | `#EEF2F3` | Disabled / de-emphasised fills |

> **The 4% rule.** `--background` sits ~4% below `--card` in lightness. An
> earlier build used a 1.4% gap and every panel dissolved into the page — the app
> looked flat no matter how much structure was there. Keep a visible step.

### 1.2 Text

| Token | HSL | Hex | Role |
|---|---|---|---|
| `--foreground` | `200 30% 12%` | `#16262A` | Primary text — charcoal-teal, not pure black |
| `--muted-foreground` | `200 12% 44%` | `#63757B` | Secondary text, labels, captions |
| `--secondary-foreground` | `200 30% 20%` | `#253F46` | Text on secondary fills |

### 1.3 Brand accent — ⚠️ per-tenant, re-hued at runtime

| Token | Default HSL | Default Hex | Role |
|---|---|---|---|
| `--primary` | `358 75% 41%` | `#B71A20` | **The one accent.** Buttons, links, active nav |
| `--primary-foreground` | `0 0% 100%` | `#FFFFFF` | Text on the accent |
| `--accent` | `358 70% 96%` | `#FDEEEF` | Light brand tint — **hover surface only, never a fill** |
| `--accent-foreground` | `358 60% 30%` | `#7A1F24` | Text on the tint |
| `--ring` | `358 75% 41%` | `#B71A20` | Focus ring |
| `--nav-active-bg` | `358 75% 41%` | `#B71A20` | Solid pill behind the active sidebar item |
| `--nav-active-fg` | `0 0% 100%` | `#FFFFFF` | Label + icon on that pill |

**Every value in this table is derived from a single tenant hue at runtime.**
The defaults shown are Aina's own. Design with one accent variable, not a red.

There is also a legacy `--brand-*` family (`brand-navy`, `brand-cyan`,
`brand-mint`, `brand-violet`). **These names are historical and lie** — they
were a multi-colour palette that has since been collapsed onto the single
accent. `brand-cyan` is currently red. Do not design against these names; they
exist only so hundreds of old class references keep working.

### 1.4 Semantic — fixed, never re-hued

| Token | HSL | Hex | Meaning |
|---|---|---|---|
| `--success` | `151 55% 35%` | `#288B5F` | Done, healthy, gain |
| `--warning` | `37 92% 50%` | `#F59E0B` | Needs attention soon |
| `--destructive` | `4 80% 52%` | `#E8453C` | Error, delete, loss (warmer than brand red, deliberately distinguishable) |
| `--info` | `199 74% 45%` | `#1E90C8` | Neutral information |

### 1.5 Chart ramp — fixed, must not collide with any brand hue

Six muted, mutually distinguishable series colours. **None shares a hue with the
accent**, so red inside a chart still means "look here" rather than "series 1".

| Token | Hex | Colour |
|---|---|---|
| `--chart-1` | `#1E7FA8` | blue |
| `--chart-2` | `#1D7A54` | green |
| `--chart-3` | `#B0700A` | amber |
| `--chart-4` | `#6B5CA5` | violet |
| `--chart-5` | `#2A8F8A` | teal |
| `--chart-6` | `#8593A0` | slate |

### 1.6 Lines

| Token | HSL | Hex |
|---|---|---|
| `--border` | `200 20% 90%` | `#E1E8EA` |
| `--input` | `200 20% 90%` | `#E1E8EA` |

---

## 2. Typography

**Family:** Inter (`--font-inter`), fallback `ui-sans-serif, system-ui, sans-serif`.
One family for both body and display — there is no second typeface today.
*A display face for headings is a legitimate thing to propose.*

| Token | Size | Line height | Use |
|---|---|---|---|
| `text-2xs` | **11px** | 16px, `+0.01em` | **The floor.** Table meta, badges, captions |
| `text-xs` | 12px | 16px | Dense table cells, helper text |
| `text-sm` | 14px | 20px | **Body default** — most of the app |
| `text-base` | 16px | 24px | Emphasised body, form inputs |
| `text-lg` | 18px | 28px | Section headings |
| `text-xl` | 20px | 28px | Card titles, stat values |
| `text-2xl` | 24px | 32px | **Page title** |

**Never below 11px.** Tailwind's own scale is otherwise untouched — redefining
`text-sm` would silently move 2,662 call sites.

**Numerals:** all financial figures use `tabular-nums` so columns align.

### Established heading pattern

Every page opens with exactly this, and it should survive the redesign:

```
.page-title      24px, bold, tight tracking, flex row with a 24px icon
.page-subtitle   14px, muted — one plain-English line explaining the screen
```

---

## 3. Radius

Base `--radius: 0.75rem` (12px). Everything else derives from it.

| Token | Value | Use |
|---|---|---|
| `sm` | 8px | Badges, chips |
| `md` | 10px | Inputs, small buttons |
| `lg` | **12px** | Buttons, nav pills |
| `xl` | 16px | **Cards** |
| `2xl` | 20px | Modals, hero panels |

---

## 4. Elevation

Soft, multi-stop, low-opacity, cool-tinted (`rgb(15 23 42 / …)`). No hard drop shadows.

| Token | Value | Use |
|---|---|---|
| `shadow-sm` | `0 1px 2px 0 rgb(15 23 42 / 0.04)` | **Cards at rest** |
| `shadow` | `0 1px 3px 0 / 0.05, 0 1px 2px -1px / 0.04` | Raised card |
| `shadow-md` | `0 4px 8px -2px / 0.06, 0 2px 4px -2px / 0.04` | Dropdown |
| `shadow-lg` | `0 12px 20px -6px / 0.08, 0 4px 8px -4px / 0.05` | Popover |
| `shadow-xl` | `0 24px 40px -12px / 0.12, 0 8px 16px -6px / 0.06` | Modal |
| `shadow-2xl` | `0 32px 60px -16px / 0.18, 0 12px 24px -8px / 0.08` | Command palette |

---

## 5. Spacing & layout

- Tailwind's default 4px scale, unmodified.
- Page container: `max-w-7xl` (1280px), `px-4` gutter.
- Standard page rhythm: `space-y-5` (20px) between major blocks.
- Card padding: `p-4` (16px) standard, `p-5`/`p-6` for feature cards.
- **Sidebar: 256px expanded, 64px collapsed.** Pin state persists per user.
- Target viewport **1440×900**; must hold to 1280px.

---

## 6. Motion — deliberately near-zero

Animation was **stripped on purpose**. What remains:

- Colour transitions only: `transition-colors duration-150` (buttons, links)
- Table row hover: `duration-100`
- Dialog enter: a 96%→100% scale + fade, ~150ms

There is no scroll animation, no parallax, no shimmer, no float, no
page-transition. `keyframes` left in the Tailwind config are **legacy and
largely unused** — do not treat them as the intended motion language.

If the redesign proposes motion, it must justify itself against: staff use this
eight hours a day, and movement they didn't ask for is friction.

---

## 7. What is genuinely weak today — fair targets for the redesign

Stated plainly so the designer knows where to push:

1. **Everything is a white card on grey.** There is almost no other structural
   device — no grouping by rule, no tinted zones, no varied card weights.
   The result reads as flat and samey across 303 screens.
2. **Only one typeface, and headings are just bold body text.** No typographic
   personality at all.
3. **Tables are visually undifferentiated.** A 16-column holdings table and a
   4-column list look the same. Density tiers would help.
4. **Stat cards are plain.** Label + number in a bordered box, repeated
   everywhere. This is the single most-seen component and the least designed.
5. **Empty states are inconsistent** — some are designed, many are a bare line
   of muted text.
6. **No visual hierarchy between the 9 nav groups.** All items look equally
   important, so daily-use screens don't stand out from once-a-quarter ones.
7. **The legacy `brand-*` token names actively mislead.** Worth renaming to
   something honest as part of the work.
