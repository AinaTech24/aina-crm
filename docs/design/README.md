# Aina CRM — Design Package

Everything an external designer (human or AI — Google Stitch, Claude, Figma Make,
v0, Lovable) needs to redesign this product **without access to the codebase**.

Hand over this whole folder. It is self-contained.

---

## The files, in reading order

| File | What it is | Give it to the designer? |
|---|---|---|
| [01-PRODUCT-BRIEF.md](01-PRODUCT-BRIEF.md) | What the product is, who uses it, the non-negotiable constraints | **Yes — read first** |
| [02-DESIGN-TOKENS.md](02-DESIGN-TOKENS.md) | Current colour / type / spacing / radius system, extracted from the live CSS | **Yes** |
| [03-INFORMATION-ARCHITECTURE.md](03-INFORMATION-ARCHITECTURE.md) | All 9 nav groups, 303 screens, the full route map | **Yes** |
| [04-SCREEN-SPECS.md](04-SCREEN-SPECS.md) | Detailed specs for the 16 screens that define the design language | **Yes** |
| [05-COMPONENT-INVENTORY.md](05-COMPONENT-INVENTORY.md) | Every reusable component + utility class already in the build | **Yes** |
| [06-AI-DESIGN-PROMPTS.md](06-AI-DESIGN-PROMPTS.md) | Copy-paste prompts, one per screen, tuned for Stitch / Claude | **This is the one you'll actually use** |

---

## How to use this with Google Stitch

Stitch generates one screen per prompt. Don't paste the whole brief.

1. Open [06-AI-DESIGN-PROMPTS.md](06-AI-DESIGN-PROMPTS.md).
2. Paste the **Global Style Prompt** (top of that file) into Stitch first — it sets
   the visual language for the session.
3. Then paste screen prompts **one at a time**, starting with `A1 — App Shell`.
   Get the shell right before anything else; every other screen sits inside it.
4. Work down the list. Screens are ordered so each one builds on the last.
5. Export the results (Figma or image) and bring them back to me.

## How to use this with Claude

Paste `01`, `02` and `03` in one message, then ask for screens from `04`. Claude
holds the whole system in context, so you can ask for several screens at once and
they'll stay consistent — that's the advantage over Stitch.

---

## When you bring designs back to me

Give me whichever of these you have — more is better, but any one is enough to start:

- Figma link, or exported PNGs per screen
- The new token values (hex codes, font, radius, spacing scale)
- Notes on anything that should behave differently, not just look different

I'll then map the new design onto the existing token system. **Most of a
redesign lands in `src/app/globals.css` and `tailwind.config.ts`** — because
every screen already draws from those variables, retokenising moves the whole
app at once. Screen-by-screen rework is only needed where the *layout* changes,
not where the *styling* changes.

---

## ⚠️ Four constraints a designer will break unless you tell them

These are the ones that will cost real money if they're discovered after the
design is done. They're explained in full in `01-PRODUCT-BRIEF.md` §5, but in short:

1. **The accent colour is not fixed.** Every MFD firm gets its own brand hue,
   derived at runtime. A design that only works in red is unusable.
2. **Light mode only.** Dark mode was deliberately removed. Don't design one.
3. **11px is the smallest permitted text.** Staff scan PANs and folio numbers all day.
4. **Indian number formatting throughout** — ₹, lakh, crore. Never `$` or `M`/`K`.
