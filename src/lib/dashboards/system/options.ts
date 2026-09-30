/**
 * The choices the filter bar offers — client-safe shape, filled server-side
 * (lib/dashboards/load-options.ts).
 */

import type { FilterKey } from "./filters";

export type Option = { value: string; label: string };

export type FilterOptions = Partial<Record<FilterKey, Option[]>>;

export const PRODUCT_OPTIONS: Option[] = [
  { value: "mf", label: "Mutual funds" },
  { value: "insurance", label: "Insurance" },
  { value: "pms", label: "PMS" },
  { value: "aif", label: "AIF" },
];

export const SEGMENT_OPTIONS: Option[] = ["HNI", "Affluent", "Retail", "NRI", "Corporate"].map((s) => ({ value: s, label: s }));

export const CATEGORY_OPTIONS: Option[] = [
  ...["A", "B", "C", "D"].map((c) => ({ value: c, label: `Category ${c}` })),
  { value: "none", label: "No category" },
];
