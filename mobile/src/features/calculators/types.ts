/**
 * Calculator framework types. A calculator is DATA: a list of typed inputs + a
 * pure `compute(values) => ResultBlock[]`. One screen (`[key].tsx`) renders any
 * calculator from its definition, so adding a calculator is adding a registry
 * entry — never a new screen. ResultBlock mirrors the web PdfBlock vocabulary
 * (stat / section / table / insight) so the on-screen output matches the web
 * illustration one-to-one.
 *
 * The maths behind every compute is the web CRM's own module, copied verbatim
 * into ./web (see web/sync-from-web.mjs) — a def only maps inputs onto it and
 * lays the answer out.
 */

import { type ComponentProps } from "react";
import { Feather } from "@expo/vector-icons";
import type { NavSeries } from "./web/fund-research/nav";

export type FeatherName = ComponentProps<typeof Feather>["name"];

export type InputType =
  | "money" | "number" | "percent" | "years" | "int"
  | "segmented" // a few short options, side by side
  | "select"    // a longer list, in a bottom sheet
  | "toggle"
  | "text"      // free text (a fund name, a goal name)
  | "date"      // ISO "YYYY-MM-DD" from the native date picker
  | "scheme";   // a mutual-fund scheme from the firm's Scheme Master: { code, name } | null

export interface InputSpec {
  key: string;
  label: string;
  type: InputType;
  default: number | string | boolean | null;
  min?: number;
  max?: number;
  step?: number;
  /** For `segmented` / `select` inputs. */
  options?: { value: string; label: string }[];
  hint?: string;
  placeholder?: string;
  /** A small heading drawn above this input (e.g. "Goal 2", "Scenario 2"). */
  section?: string;
  /** `scheme` inputs: the firm's Scheme Master (default) or the whole AMFI
   *  universe (Fund Research, as on the web). */
  source?: "master" | "universe";
  /** `date` inputs: no date after today (India). */
  maxToday?: boolean;
  /** Show this input only when the predicate holds for the current values. */
  visibleIf?: (values: Record<string, any>) => boolean;
}

export type Tone = "brand" | "success" | "warning" | "danger" | "neutral" | "violet";

export type ResultBlock =
  | { type: "stat"; label: string; value: string; tone?: Tone; hint?: string }
  | { type: "section"; text: string }
  | { type: "table"; head: string[]; rows: string[][]; highlightLast?: boolean }
  | { type: "insight"; text: string; tone?: Tone }
  /** Small print the web shows under a result (assumptions, disclaimers). */
  | { type: "note"; text: string };

/** A scheme picked in a `scheme` input. */
export type SchemePick = { code: string; name: string } | null;

/** Live data a compute needs (Fund Research): NAV histories by scheme code. */
export interface CalcContext {
  nav: Record<string, NavSeries | undefined>;
}

export interface CalculatorDef {
  /** The web CalculatorsApp tab key, so both apps name a calculator the same way. */
  key: string;
  name: string;
  group: string;
  icon: FeatherName;
  desc: string;
  inputs: InputSpec[];
  /** Pure — no side effects. Receives coerced values (numbers for numeric inputs). */
  compute: (v: Record<string, any>, ctx: CalcContext) => ResultBlock[];
  /** Fund Research: the scheme codes whose NAV history compute needs. */
  navSchemes?: (v: Record<string, any>) => string[];
}

/** What a defs/* file supplies for one catalog key; the name, group, icon and
 *  description come from catalog.ts (the web's CATALOG). */
export type CalcBody = Pick<CalculatorDef, "inputs" | "compute" | "navSchemes">;
