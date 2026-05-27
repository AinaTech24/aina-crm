/**
 * Token / variable resolver for templates.
 *
 * Templates declare their variables in a typed `variables` array. The resolver
 * walks that declaration, fetches each value from a context object built from
 * the subject (investor/lead), tenant, user, and run-scope vars, and applies
 * formatting (currency, date, etc.). Missing required variables throw —
 * better to fail at compose time than send a half-rendered message.
 */

import { format as formatDate } from "date-fns";

export interface VariableDef {
  key: string;
  type: "string" | "number" | "currency" | "date" | "boolean" | "url";
  source?: string;
  required?: boolean;
  fallback?: unknown;
  format?: string;
}

export interface ResolveContext {
  subject: Record<string, any> | null;
  tenant: Record<string, any>;
  user?: Record<string, any>;
  context?: Record<string, any>;
  overrides?: Record<string, any>;
}

export class TokenResolutionError extends Error {}

export function resolveTokens(
  variables: VariableDef[],
  ctx: ResolveContext
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const v of variables) {
    const value = resolveOne(v, ctx);
    if ((value === null || value === undefined || value === "") && v.required) {
      throw new TokenResolutionError(`Required variable '${v.key}' could not be resolved`);
    }
    resolved[v.key] = formatValue(value, v);
  }
  return resolved;
}

function resolveOne(def: VariableDef, ctx: ResolveContext): unknown {
  // Override always wins
  if (ctx.overrides && def.key in ctx.overrides) {
    return ctx.overrides[def.key];
  }
  if (!def.source) {
    return def.fallback ?? null;
  }
  const [root, ...rest] = def.source.split(".");
  const roots: Record<string, any> = {
    subject: ctx.subject ?? {},
    tenant: ctx.tenant,
    user: ctx.user ?? {},
    context: ctx.context ?? {},
  };
  let cur = roots[root];
  if (cur === undefined) return def.fallback ?? null;
  for (const seg of rest) {
    if (cur == null) return def.fallback ?? null;
    cur = cur[seg];
  }
  if (cur === undefined || cur === null) return def.fallback ?? null;
  return cur;
}

function formatValue(value: unknown, def: VariableDef): string {
  if (value === null || value === undefined) return "";
  switch (def.type) {
    case "currency":
      return formatINR(Number(value), def.format === "inr_paise");
    case "number":
      return Number(value).toLocaleString("en-IN");
    case "date":
      try {
        return formatDate(typeof value === "string" ? new Date(value) : (value as Date), def.format ?? "dd MMM yyyy");
      } catch {
        return String(value);
      }
    case "boolean":
      return value ? "Yes" : "No";
    case "url":
    case "string":
    default:
      return String(value);
  }
}

function formatINR(n: number, asRupeesFromPaise = false): string {
  const rupees = asRupeesFromPaise ? n / 100 : n;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees);
}

/**
 * Render a WhatsApp template body by replacing `{{key}}` mustache placeholders.
 * Also supports `{{1}}, {{2}}` style for raw AiSensy positional params.
 */
export function renderTemplateText(text: string, tokens: Record<string, string>): string {
  return text.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, key) => {
    const k = key.trim();
    if (k in tokens) return tokens[k];
    // numeric positional — keys named 'p1', 'p2', etc. or '1', '2'
    if (/^\d+$/.test(k) && `p${k}` in tokens) return tokens[`p${k}`];
    return "";
  });
}
