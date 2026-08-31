/**
 * Zod body schema for the landing-package admin API.
 *
 * Lives in lib, NOT in the route file: a Next.js App Router route handler may
 * only export the HTTP verbs + a fixed set of config keys, so exporting a schema
 * from `route.ts` fails the generated-types check during `next build` (it does
 * not show up in a plain `tsc --noEmit`).
 */

import { z } from "zod";

export const LandingBody = z.object({
  name: z.string().min(1).max(80),
  tagline: z.string().max(500).nullable().optional(),
  priceLabel: z.string().max(40).nullable().optional(),
  unitLabel: z.string().max(40).nullable().optional(),
  setupLabel: z.string().max(40).nullable().optional(),
  setupOriginalLabel: z.string().max(40).nullable().optional(),
  discountBadge: z.string().max(40).nullable().optional(),
  seatsLabel: z.string().max(80).nullable().optional(),
  inheritsLabel: z.string().max(80).nullable().optional(),
  features: z.array(z.string().max(200)).max(40).optional(),
  featured: z.boolean().optional(),
  badgeLabel: z.string().max(40).nullable().optional(),
  isCustom: z.boolean().optional(),
  ctaLabel: z.string().max(40).optional(),
  ctaHref: z.string().max(200).optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  published: z.boolean().optional(),
});

export const LandingPatchBody = LandingBody.partial();
