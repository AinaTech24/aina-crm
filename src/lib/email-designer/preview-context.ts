/**
 * Shared render context for the two "show me this email" paths: the on-screen
 * preview and the test send. Both must produce the SAME mail — a preview that
 * differs from the test send is worse than no preview.
 *
 * It supplies:
 *   - the firm's real branding (logo, colours, ARN, address, website), and
 *   - sample merge values for client data, EXCEPT the sign-off, which uses the
 *     viewer's own name, designation, contact and signature image. The sign-off
 *     is the one part that differs per sender, so showing sample values there
 *     would misrepresent what the recipient actually gets.
 *
 * Best-effort throughout: an unreadable tenant or user degrades to sample data
 * rather than failing the preview.
 */

import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { tenants, users } from "@/db/schema";
import { MERGE_FIELDS } from "@/lib/email-designer/merge-fields";
import { firmIntroTokens, readFirmEmailIntro, type FirmEmailIntro } from "@/lib/firm/email-intro";

/**
 * A client-facing sign-off states the firm's REGISTRATION, never the sender's
 * internal department.
 *
 * `users.department` is an org chart field ("advisory", "back_office", …). It
 * was being printed under the sender's name, so client emails went out reading
 * "Advisory" — which implies investment advice, something an AMFI-registered
 * distributor is not registered to give (advice is incidental to distribution).
 * The department never reaches a client now.
 */
const CLIENT_FACING_DESIGNATION = "AMFI Registered Mutual Fund Distributor";

/** Nest every catalogued merge field's example into a variables envelope. */
export function buildSampleVariables(): Record<string, unknown> {
  const out: Record<string, any> = {};
  for (const f of MERGE_FIELDS) {
    const [root, ...rest] = f.token.split(".");
    // A flat token ({{minutes}}) is a plain value, not a namespace.
    if (rest.length === 0) {
      out[root] = f.example;
      continue;
    }
    out[root] ??= {};
    let cur: any = out[root];
    for (let i = 0; i < rest.length - 1; i++) {
      cur[rest[i]] ??= {};
      cur = cur[rest[i]];
    }
    cur[rest[rest.length - 1]] = f.example;
  }
  return out;
}

/** `tenants.address` is structured JSON; the email footer wants one line. */
export function formatTenantAddress(addr: unknown): string | null {
  if (!addr) return null;
  if (typeof addr === "string") return addr.trim() || null;
  if (typeof addr === "object") {
    const a = addr as Record<string, unknown>;
    const parts = [a.line1, a.line2, a.city, a.state, a.pincode]
      .map((p) => (p == null ? "" : String(p).trim()))
      .filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

/** Make an app-relative asset path absolute — a mail client cannot load "/…". */
function absolute(url: string): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
  if (!base) return url;
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

export type PreviewBrand = {
  legalName: string | null;
  displayName: string | null;
  arn: string | null;
  principalEuin: string | null;
  address: string | null;
  websiteUrl: string | null;
  brandColor: string | null;
  logoUrl: string | null;
};

export type PreviewContext = {
  variables: Record<string, unknown>;
  tenant: PreviewBrand;
};

/**
 * Branding + sample variables for one tenant, signed off as `userId`.
 * Selects only the columns needed, so an unrelated schema change (a migration
 * not yet applied) cannot break the preview.
 */
export async function loadPreviewContext(tenantId: string, userId?: string | null): Promise<PreviewContext> {
  let brand: PreviewBrand = {
    legalName: null,
    displayName: null,
    arn: null,
    principalEuin: null,
    address: null,
    websiteUrl: null,
    brandColor: null,
    logoUrl: null,
  };
  let intro: FirmEmailIntro = {};
  let me: {
    name: string | null;
    email: string | null;
    phone: string | null;
    department: string | null;
    signatureUrl: string | null;
  } | null = null;

  try {
    const loaded = await withTenant(tenantId, async (tx) => {
      const [t] = await tx
        .select({
          legalName: tenants.legalName,
          displayName: tenants.displayName,
          arn: tenants.arn,
          principalEuin: tenants.principalEuin,
          address: tenants.address,
          website: tenants.website,
          primaryColor: tenants.primaryColor,
          logoUrl: tenants.logoUrl,
          emailIntro: tenants.emailIntro,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId));

      let u = null;
      if (userId) {
        const [row] = await tx
          .select({
            name: users.name,
            email: users.email,
            phone: users.phone,
            department: users.department,
            signatureUrl: users.signatureUrl,
          })
          .from(users)
          .where(eq(users.id, userId));
        u = row ?? null;
      }
      return { t: t ?? null, u };
    });

    if (loaded.t) {
      brand = {
        legalName: loaded.t.legalName ?? null,
        displayName: loaded.t.displayName ?? null,
        arn: loaded.t.arn ?? null,
        principalEuin: loaded.t.principalEuin ?? null,
        address: formatTenantAddress(loaded.t.address),
        websiteUrl: loaded.t.website ?? null,
        brandColor: loaded.t.primaryColor ?? null,
        logoUrl: loaded.t.logoUrl ?? null,
      };
      intro = readFirmEmailIntro(loaded.t.emailIntro);
    }
    me = loaded.u;
  } catch (e) {
    console.error("[email-preview] branding/sender lookup failed; rendering with samples:", e);
  }

  const variables = buildSampleVariables();
  // Once the firm has written its introduction the preview uses exactly that —
  // a field it left blank drops out, as it will in the real email. Before then
  // the examples show where each part sits.
  const own = firmIntroTokens(intro, absolute);
  if (Object.keys(own).length) {
    variables.firm = Object.fromEntries(Object.entries(own).map(([k, v]) => [k.slice("firm.".length), v]));
  }
  if (me) {
    const inv = (variables.investor ??= {}) as Record<string, unknown>;
    if (me.name) inv.rm_name = me.name;
    if (me.email) inv.rm_email = me.email;
    if (me.phone) inv.rm_phone = me.phone;
    inv.rm_designation = CLIENT_FACING_DESIGNATION;
    inv.rm_signature_url = absolute(me.signatureUrl ?? "");
  }

  return { variables, tenant: brand };
}

/** Replace merge tokens in a subject line with their sample values. */
export function resolveSubjectSample(subject: string, variables: Record<string, unknown>): string {
  return (subject || "(no subject)").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (full, path: string) => {
    const v = path.split(".").reduce<any>((acc, k) => (acc == null ? acc : acc[k]), variables);
    return v == null || v === "" ? full : String(v);
  });
}
