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

/** System-provided tokens available to every template (footer + pipeline). */
const SYSTEM_TOKENS = new Set([
  "unsubscribe_url", "tenant_name", "tenant_display_name", "tenant_arn", "arn_no", "arn_name",
  "euin", "firm_phone", "firm_email", "firm_website", "firm_address", "brand_color",
  "tenant_logo_url", "logo_url",
]);

/**
 * Find `{{placeholders}}` in template text that have no matching declared
 * variable (and aren't system tokens or positional params). Surfaced as a
 * non-blocking warning so authors catch typo'd merge fields before they
 * silently render blank at send time.
 */
export function findUndeclaredPlaceholders(text: string, declaredKeys: string[]): string[] {
  const declared = new Set(declaredKeys);
  const found = new Set<string>();
  const re = /\{\{\s*([^}]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text ?? "")) !== null) {
    const k = m[1].trim();
    if (!k || declared.has(k) || SYSTEM_TOKENS.has(k)) continue;
    if (/^\d+$/.test(k) || /^p\d+$/.test(k)) continue; // positional params
    found.add(k);
  }
  return [...found];
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
