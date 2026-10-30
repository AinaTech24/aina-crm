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

/**
 * Namespaces the SYSTEM produces and has ALREADY formatted (see
 * `lib/comms/client-links.ts`). A template may reference these freely, but it
 * does not get to redeclare their type.
 *
 * `risk.category` is a word ("Moderate"). `risk.profiled_on` / `risk.review_due`
 * are formatted date STRINGS, not Dates. `risk.score_display` is "24 / 40".
 * Declaring any of them as `date` or `number` — which the template editor
 * allows — made the type check below throw on every single send of that
 * template, for every client:
 *
 *   Variable 'risk.category' must be a valid date
 *
 * The value is correct and already display-ready; the declaration is simply
 * wrong. Pass it through as the string it is. `required` is still enforced.
 */
const SYSTEM_PREFORMATTED_PREFIXES = ["risk.", "suitability.", "link."];
function isSystemPreformatted(key: string): boolean {
  return SYSTEM_PREFORMATTED_PREFIXES.some((p) => key.startsWith(p));
}

export function resolveTokens(
  variables: VariableDef[],
  ctx: ResolveContext
): Record<string, string> {
  const resolved: Record<string, string> = {};
  // A template version can carry `variables: null` (older rows, and any version
  // duplicated from one). Iterating that threw "variables is not iterable",
  // which surfaced to the user as an unexplained "render_error" and blocked the
  // send outright — for a field list that is optional in the first place.
  if (!Array.isArray(variables)) return resolved;
  for (const v of variables) {
    const value = resolveOne(v, ctx);
    if (v.required && (value === null || value === undefined || String(value).trim() === "")) throw new TokenResolutionError(`Required variable '${v.key}' is missing`);
    // System-owned namespaces arrive display-ready — see the note above. Skip
    // the declared-type coercion entirely rather than validating a formatted
    // string against a type the template author picked by mistake.
    if (isSystemPreformatted(v.key)) {
      resolved[v.key] = value === null || value === undefined ? "" : String(value);
      continue;
    }
    if (value != null && ["number", "currency"].includes(v.type) && !Number.isFinite(Number(value))) throw new TokenResolutionError(`Variable '${v.key}' must be a number`);
    if (value != null && v.type === "date" && !Number.isFinite(new Date(value as string | number | Date).getTime())) throw new TokenResolutionError(`Variable '${v.key}' must be a valid date`);
    resolved[v.key] = formatValue(value, v);
  }
  return resolved;
}

/**
 * Resolve a merge path that the template never DECLARED, e.g. "investor.name"
 * typed straight into a designer block.
 *
 * `resolveTokens` only walks the declared `variables` array. Templates built in
 * the designer (and the seeded starters) declare nothing, so every
 * {{investor.name}} / {{investor.rm_email}} in them rendered blank on a real
 * send while looking fine in preview, which uses sample data. This lets the
 * pipeline fill anything the body actually references.
 *
 * Returns "" when the path resolves to nothing, so a missing field blanks out
 * rather than leaving a raw {{token}} in a client's inbox.
 */
export function resolveTokenPath(path: string, ctx: ResolveContext): string {
  const value = resolveOne({ key: path, type: "string" } as VariableDef, ctx);
  return value === null || value === undefined ? "" : String(value);
}

function resolveOne(def: VariableDef, ctx: ResolveContext): unknown {
  // Override always wins.
  if (ctx.overrides && def.key in ctx.overrides) {
    return ctx.overrides[def.key];
  }
  // Auto-detected designer variables (e.g. "investor.name") carry no explicit
  // `source` — fall back to the key itself as the path.
  const source = def.source || def.key;
  if (!source) return def.fallback ?? null;
  const [root, ...rest] = source.split(".");
  const subject: any = ctx.subject ?? {};
  const context: any = ctx.context ?? {};
  // Map the merge-field namespaces to the loaded records. investor/lead/client all map
  // to the subject; transaction/family/system come from the run context.
  const roots: Record<string, any> = {
    subject,
    investor: subject,
    lead: subject,
    // {{client.name}} — what the CRM's own WhatsApp templates (document
    // collection, …) and a firm's hand-made ones are written with. It is the
    // person the message goes to, i.e. the subject, like investor.* and lead.*.
    client: subject,
    family: subject.family ?? context.family ?? {},
    transaction: context.transaction ?? {},
    system: context.system ?? {},
    tenant: ctx.tenant,
    user: ctx.user ?? {},
    context,
  };
  let cur = roots[root];
  if (cur === undefined) return def.fallback ?? null;
  for (const seg of rest) {
    if (cur == null || typeof cur !== "object") return def.fallback ?? null;
    // Records are camelCase (drizzle); merge tokens are often snake_case — try
    // the exact key, then the camelCased equivalent (date_of_birth → dateOfBirth).
    const camel = seg.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
    cur = (cur as any)[seg] !== undefined ? (cur as any)[seg] : (cur as any)[camel];
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
 * Flatten a template body to the plain text the compliance gate scans.
 *
 * This is the SINGLE source of truth for "what text does this template
 * contain" — the create / PATCH / submit routes previously each carried their
 * own slightly different `extractText`, so the compliance gate scanned
 * different text on different paths (e.g. submit missed header titles + button
 * labels that the send-time gate reads). That left seams in the moat.
 *
 * It is deliberately a SUPERSET of every field any extractor reads, including
 * the send-time pipeline (`extractTextFromBlocks`: text→content, header→title,
 * button→label). Scanning a superset at authoring time means authoring is at
 * least as strict as send — a template that clears the authoring gate can never
 * be newly blocked at send for content the author couldn't see being scanned.
 */
export function templateBodyToText(channel: string, body: any): string {
  if (!body) return "";
  if (channel === "whatsapp") {
    return [body?.header?.text, body?.body?.text, body?.footer?.text].filter(Boolean).join("\n");
  }
  if (channel === "email") {
    const blocks = Array.isArray(body?.blocks) ? body.blocks : [];
    const blockText = blocks
      .map((b: any) =>
        // Every candidate text-bearing field across all block shapes, regardless
        // of `type` — guarantees we never under-scan relative to send-time.
        [b?.content, b?.text, b?.title, b?.subtitle, b?.html, b?.label]
          .filter(Boolean)
          .join("\n")
      )
      .filter(Boolean)
      .join("\n");
    return [body?.subject, body?.preheader, blockText, body?.textFallback].filter(Boolean).join("\n");
  }
  if (channel === "sms") return body?.text ?? "";
  return JSON.stringify(body);
}

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
 * Also supports `{{1}}, {{2}}` style for raw Wapi positional params.
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
