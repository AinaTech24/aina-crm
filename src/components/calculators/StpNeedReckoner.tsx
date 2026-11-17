"use client";

/**
 * STP Need-Based Ready Reckoner — the lumpsum to park in a debt fund today so a
 * monthly STP into equity reaches a target, for three paired debt | equity
 * return scenarios across five horizons (₹ lakh). Math:
 * @/lib/calculators/stp-comprehensive (`stpReckonerGrid`, verified to every
 * cell of the reference grid: ₹50L target, 5% | 10% for 5 yrs → 38.11).
 */

import { StpReckoner } from "./StpParts";

export function StpNeedReckoner() {
  return <StpReckoner kind="need" />;
}
