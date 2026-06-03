/**
 * Shared branding-template catalog.
 *
 * A small, named set of white-labelling presets an MFD picks per download.
 * One catalog drives BOTH consumers:
 *   - image co-branding  → maps to { position, heightPct } for compose.ts
 *   - PDF co-branding     → maps to a cover-page style for compose-pdf.ts
 *   - the MFD picker UI    → renders label + description
 *
 * The logo + theme colour themselves come from the tenant's branding
 * settings (tenants.logoUrl / primaryColor) — a template only decides the
 * *layout*, never the brand identity. That keeps the identity single-sourced
 * and the template selection purely cosmetic.
 *
 * This module is intentionally dependency-free (no `sharp`, no `pdf-lib`, no
 * server-only imports) so it is safe to import from client components.
 */

// Mirror of compose.ts' BrandingPosition — declared locally so this module
// stays importable from the browser bundle (compose.ts pulls in `sharp`).
export type BrandingPosition = "top" | "bottom" | "both" | "split";

/** How the prepended PDF cover page is laid out. */
export type PdfCoverStyle = "banner" | "minimal" | "sidebar";

export type BrandingTemplate = {
  id: string;
  label: string;
  /** One-line description shown under the template card in the picker. */
  description: string;
  /** Image co-branding knobs (consumed by compose.ts). */
  image: { position: BrandingPosition; heightPct: number };
  /** PDF cover-page style (consumed by compose-pdf.ts). */
  pdf: { coverStyle: PdfCoverStyle };
};

export const BRANDING_TEMPLATES: BrandingTemplate[] = [
  {
    id: "classic",
    label: "Classic",
    description:
      "Full details band along the bottom edge — logo, firm name, ARN and contact. The safe default.",
    image: { position: "bottom", heightPct: 18 },
    pdf: { coverStyle: "banner" },
  },
  {
    id: "minimal",
    label: "Minimal",
    description:
      "A slim, understated strip that keeps the creative front-and-centre.",
    image: { position: "bottom", heightPct: 11 },
    pdf: { coverStyle: "minimal" },
  },
  {
    id: "bold",
    label: "Bold",
    description:
      "Branding stamped on both the top and bottom edges for maximum recall.",
    image: { position: "both", heightPct: 16 },
    pdf: { coverStyle: "banner" },
  },
  {
    id: "split",
    label: "Split",
    description:
      "Logo and firm name on top, contact details on the bottom — a letterhead feel.",
    image: { position: "split", heightPct: 18 },
    pdf: { coverStyle: "sidebar" },
  },
];

export const DEFAULT_TEMPLATE_ID = "classic";

/** Resolve a template id to its definition, falling back to Classic. */
export function getBrandingTemplate(
  id: string | null | undefined
): BrandingTemplate {
  return (
    BRANDING_TEMPLATES.find((t) => t.id === id) ?? BRANDING_TEMPLATES[0]
  );
}

/** Type guard for a known template id. */
export function isBrandingTemplateId(id: string | null | undefined): boolean {
  return !!id && BRANDING_TEMPLATES.some((t) => t.id === id);
}
