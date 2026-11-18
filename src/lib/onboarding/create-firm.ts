/**
 * Create an MFD firm's workspace — the ONE implementation behind self-serve
 * signup (/api/auth/signup) and the online purchase (/api/public/pricing/signup).
 *
 * One system transaction: the tenant, its Head Office branch, the owner
 * (owner + rm + compliance), a `pending` subscription (the license gate keeps
 * a pending firm to Billing and Support until it pays), the master-value seeds,
 * the default workflow recipes and the client email templates. The caller then
 * issues the email verification and the session.
 *
 * `pricing` (from a saved quote) makes the subscription AUM-priced: the
 * declared AUM, users and cycle are recorded as the package being bought, and
 * the tenant is marked `onboarding_required` so it goes through the setup
 * wizard after paying.
 */

import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { asc, eq, sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { packages, subscriptionEvents, subscriptions } from "@/db/schema";
import { PLATFORM_TENANT_ID } from "@/lib/platform";
import { MASTER_SEEDS } from "@/lib/masters/seeds";
import { installDefaultRecipes } from "@/lib/recipes/install-defaults";
import { installClientEmailTemplates } from "@/lib/templates/install-client-emails";
import { cycleLabel, type CycleKey, type CycleQuote } from "@/lib/billing/aum-pricing";

export type NewFirmInput = {
  firmName: string;
  arn: string | null;
  ownerName: string;
  ownerEmail: string;
  password: string;
  mobile?: string | null;
  /** Registered state (name) — the tax invoice's place of supply. */
  state?: string | null;
  gstin?: string | null;
  trialDays?: number;
  pricing?: {
    quoteId: string;
    aumCrore: number;
    users: number;
    cycle: CycleKey;
    quote: CycleQuote;
    packageKey: string | null;
  };
};

export type NewFirm = { tenantId: string; userId: string; branchId: string; subscriptionId: string };

export class FirmCreateError extends Error {
  constructor(
    public code: "email_taken" | "arn_taken" | "no_package",
    message: string
  ) {
    super(message);
  }
}

/** Is this email already a sign-in anywhere (any firm, or an Aina admin)? */
export async function emailInUse(email: string): Promise<boolean> {
  return withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT 1 FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE lower(u.email) = ${email.toLowerCase()}
         AND (u.tenant_id = ${PLATFORM_TENANT_ID}::uuid OR t.deleted_at IS NULL)
       LIMIT 1
    `);
    return r.rows.length > 0;
  });
}

export async function createFirmAccount(input: NewFirmInput): Promise<NewFirm> {
  const tenantId = uuid();
  const userId = uuid();
  const branchId = uuid();
  const subId = uuid();
  const email = input.ownerEmail.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(input.password, 12);
  const trialEndsAt = new Date(Date.now() + (input.trialDays ?? 14) * 86_400_000);
  const address = input.state ? { state: input.state, country: "India" } : null;

  try {
    await withSystem(async (tx) => {
      if (input.arn) {
        // Free this ARN if a soft-deleted tenant still holds it.
        await tx.execute(sql`
          UPDATE tenants SET arn = arn || '_deleted_' || to_char(now(), 'YYYYMMDDHH24MISS'), updated_at = now()
           WHERE arn = ${input.arn} AND deleted_at IS NOT NULL
        `);
      }

      await tx.execute(sql`
        INSERT INTO tenants (id, legal_name, display_name, arn, plan, status, trial_ends_at, email, phone,
                             address, gst_number, gst_registered, onboarding_required, created_at, updated_at)
        VALUES (${tenantId}, ${input.firmName}, ${input.firmName}, ${input.arn}, 'starter', 'trial', ${trialEndsAt},
                ${email}, ${input.mobile ?? null}, ${address ? JSON.stringify(address) : null}::jsonb,
                ${input.gstin ?? null}, ${input.pricing ? input.gstin != null : null}, ${!!input.pricing}, now(), now())
      `);

      await tx.execute(sql`
        INSERT INTO branches (id, tenant_id, name, code, is_hq, created_at, updated_at)
        VALUES (${branchId}, ${tenantId}, 'Head Office', 'HQ', 'true', now(), now())
      `);

      await tx.execute(sql`
        INSERT INTO users (id, tenant_id, branch_id, email, name, phone, password_hash, roles, status, activated_at, created_at, updated_at)
        VALUES (${userId}, ${tenantId}, ${branchId}, ${email}, ${input.ownerName}, ${input.mobile ?? null}, ${passwordHash},
                ARRAY['owner', 'rm', 'compliance']::text[], 'active', now(), now(), now())
      `);

      // The subscription row the license gate reads. Without it a new tenant is
      // locked out ("no_subscription"). `pending` = not paid yet.
      const wanted = input.pricing?.packageKey ?? "starter";
      const pkg =
        (await tx.select().from(packages).where(eq(packages.key, wanted)).limit(1))[0] ??
        (await tx.select().from(packages).where(eq(packages.key, "starter")).limit(1))[0] ??
        (await tx.select().from(packages).where(eq(packages.isActive, true)).orderBy(asc(packages.sortOrder)).limit(1))[0];
      if (!pkg) throw new FirmCreateError("no_package", "no_package_configured");

      const p = input.pricing;
      await tx.insert(subscriptions).values({
        id: subId,
        tenantId,
        packageId: pkg.id,
        packageKey: pkg.key,
        status: "pending",
        billingCycle: p?.cycle ?? "monthly",
        licenseStartAt: new Date(),
        trialEndsAt,
        ...(p
          ? {
              pricingModel: "aum",
              seatsOverride: p.users,
              declaredAumCrore: String(p.aumCrore),
              aumCroreInForce: String(p.aumCrore),
              aumSource: "declared",
              aumTierKey: p.quote.tierKey,
              monthlyBasePaise: p.quote.monthlyBasePaise,
              cycleTotalPaise: p.quote.totalPaise,
              quoteId: p.quoteId,
            }
          : {}),
      });
      await tx.insert(subscriptionEvents).values({
        subscriptionId: subId,
        tenantId,
        eventType: "created",
        actor: p ? "system:online_purchase" : "system:self_serve_signup",
        toStatus: "pending",
        toPackage: pkg.key,
        notes: p ? `Online purchase — ${cycleLabel(p.cycle, p.quote.months).toLowerCase()}, ${p.users} user(s), ₹${p.aumCrore} Cr declared; awaiting payment.` : "Self-serve signup — awaiting package selection.",
      });

      for (const [masterType, rows] of Object.entries(MASTER_SEEDS)) {
        for (const r of rows) {
          await tx.execute(sql`
            INSERT INTO master_values (id, tenant_id, master_type, key, label, sort_order, is_active, is_system_default, meta, created_at, updated_at)
            VALUES (gen_random_uuid(), ${tenantId}, ${masterType}, ${r.key}, ${r.label}, ${r.sortOrder ?? 0}, true, true,
                    ${r.meta ? JSON.stringify(r.meta) : null}::jsonb, now(), now())
            ON CONFLICT (tenant_id, master_type, key) DO NOTHING
          `);
        }
      }

      // Additive installs — a failure must not fail the signup.
      try {
        await tx.transaction(async (sp) => {
          await installDefaultRecipes(sp, tenantId, userId);
        });
      } catch (err) {
        console.error("[create-firm] default-recipe install failed:", err);
      }
      try {
        await tx.transaction(async (sp) => {
          await installClientEmailTemplates(sp, tenantId, userId);
        });
      } catch (err) {
        console.error("[create-firm] client email template install failed:", err);
      }
    });
  } catch (err) {
    if (err instanceof FirmCreateError) throw err;
    const e = err as { cause?: { code?: string; constraint?: string; message?: string; detail?: string }; code?: string; message?: string };
    const pg = e.cause ?? e;
    const text = `${pg.message ?? ""} ${(pg as { constraint?: string }).constraint ?? ""} ${(pg as { detail?: string }).detail ?? ""}`;
    if (pg.code === "23505" && /arn/i.test(text)) throw new FirmCreateError("arn_taken", "ARN already registered");
    if (pg.code === "23505" && /email/i.test(text)) throw new FirmCreateError("email_taken", "Email already in use");
    throw err;
  }

  return { tenantId, userId, branchId, subscriptionId: subId };
}
