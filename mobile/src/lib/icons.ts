/**
 * Icon names that arrive as plain strings — from server payloads (Home's
 * worklist, the command centre) or loosely-typed lookup tables. Feather renders
 * an unknown name as a "?" box, so validate against its real glyph map and fall
 * back to a neutral icon instead. Replaces the `name={x as any}` casts.
 */

import type { ComponentProps } from "react";
import { Feather } from "@expo/vector-icons";

export type FeatherName = ComponentProps<typeof Feather>["name"];

const glyphs = Feather.glyphMap as Record<string, number>;

export function asIcon(name: string | null | undefined, fallback: FeatherName = "circle"): FeatherName {
  return name && name in glyphs ? (name as FeatherName) : fallback;
}
