"use client";

/**
 * STP Future Value Ready Reckoner — what a lumpsum routed debt → equity by a
 * monthly STP grows to, for three paired debt | equity return scenarios across
 * five horizons (₹ lakh). Math: @/lib/calculators/stp-comprehensive
 * (`stpReckonerGrid`, verified to every cell of the reference grid: ₹50L,
 * capital appreciation, 5% | 10% for 5 yrs → 65.60).
 */

import { StpReckoner } from "./StpParts";

export function StpFvReckoner() {
  return <StpReckoner kind="fv" />;
}
