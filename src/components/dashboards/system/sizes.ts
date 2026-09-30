/**
 * The width each shown card renders at. CLIENT-SAFE, no JSX (so the tests can
 * import it).
 *
 * Half-width (M) cards pair up in order; an M card left without an M partner
 * before the next full-width card, or the end, becomes full width — so a card
 * that hid itself for want of data never leaves a hole beside its partner.
 */

import type { WidgetSize } from "@/lib/dashboards/system/catalog";

export function effectiveSizes(sizes: WidgetSize[]): WidgetSize[] {
  const out = [...sizes];
  let pending: number | null = null;
  sizes.forEach((size, i) => {
    if (size === "M") {
      if (pending == null) pending = i;
      else pending = null;
    } else if (size === "L") {
      if (pending != null) out[pending] = "L";
      pending = null;
    }
  });
  if (pending != null) out[pending] = "L";
  return out;
}
