/**
 * The post-payment setup wizard (owner's addition C): firm details → logo →
 * Terms → NDA → done. A firm is "onboarded" only when every required step is
 * complete; until then the dashboard sends it here (lib/legal/documents.ts).
 *
 * Every write is the firm's own, inside withTenant, and audited. Acceptances
 * are immutable rows that quote the exact published text's SHA-256; the
 * database refuses one that does not match (migration 0266).
 */

import { sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { withSystem, withTenant } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";
import { sendSystemEmail, actionEmailHtml } from "@/lib/comms/system-email";
import { LEGAL } from "@/lib/legal/company";
import { checkGstin, gstState, isValidPan } from "@/lib/legal/gst";
import { isValidEmail } from "@/lib/public-otp";
import { normaliseArn, normaliseMobile } from "@/lib/billing/quote-request";
import { PLATFORM_TENANT_ID } from "@/lib/platform";
import { putObject, vaultKey } from "@/lib/storage/s3";
import { currentDocuments, firmAcceptances, pendingLegalKinds, type LegalKind } from "@/lib/legal/documents";
import { renderSignedLegalPdf } from "@/lib/legal/signed-pdf";
import { issueNdaOtp, verifyNdaOtp } from "./nda-otp";
import { sendWelcomeEmail } from "./welcome";

export type FirmDetails = {
  legalName: string;
  displayName: string;
  arn: string;
  arnExpiry: string | null;
  principalEuin: string | null;
  pan: string;
  gstRegistered: boolean;
  gstin: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  pincode: string;
  email: string;
  phone: string;
  billingEmail: string | null;
};

export type FieldErrors = Partial<Record<keyof FirmDetails, string>>;

const s = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

/** Pure: validate and clean step 1. */
export function parseFirmDetails(body: unknown): { ok: true; value: FirmDetails } | { ok: false; errors: FieldErrors } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const e: FieldErrors = {};
  const legalName = s(b.legalName);
  if (legalName.length < 2) e.legalName = "Enter the firm's legal name.";
  const displayName = s(b.displayName) || legalName;
  const arn = normaliseArn(b.arn);
  if (!arn || arn === "bad") e.arn = "Enter your ARN, e.g. ARN-123456.";
  const arnExpiry = s(b.arnExpiry) || null;
  if (arnExpiry && !/^\d{4}-\d{2}-\d{2}$/.test(arnExpiry)) e.arnExpiry = "Enter the ARN expiry date.";
  const euin = s(b.principalEuin).toUpperCase() || null;
  if (euin && !/^E\d{5,7}$/.test(euin)) e.principalEuin = "A EUIN looks like E123456.";
  const pan = s(b.pan).toUpperCase();
  if (!isValidPan(pan)) e.pan = "Enter the firm's 10-character PAN, e.g. ABCFA1234K.";
  const gstRegistered = b.gstRegistered !== false && b.gstRegistered !== "false";
  let gstin: string | null = null;
  const state = gstState(s(b.state));
  if (!state) e.state = "Choose the state.";
  if (gstRegistered) {
    const g = checkGstin(s(b.gstin));
    if (!g.ok) e.gstin = g.error;
    else {
      gstin = g.gstin;
      if (isValidPan(pan) && g.pan !== pan) e.gstin = "This GSTIN belongs to a different PAN than the one above.";
      else if (state && g.stateCode !== state.code) e.gstin = `This GSTIN is registered in ${gstState(g.stateCode)?.name ?? "another state"}, not ${state.name}.`;
    }
  }
  const addressLine1 = s(b.addressLine1);
  if (addressLine1.length < 4) e.addressLine1 = "Enter the registered address.";
  const city = s(b.city);
  if (city.length < 2) e.city = "Enter the city.";
  const pincode = s(b.pincode);
  if (!/^[1-9]\d{5}$/.test(pincode)) e.pincode = "A pincode is 6 digits.";
  const email = s(b.email).toLowerCase();
  if (!isValidEmail(email)) e.email = "Enter the firm's contact email.";
  const phone = normaliseMobile(b.phone);
  if (!phone) e.phone = "Enter a 10-digit mobile number.";
  const billingEmail = s(b.billingEmail).toLowerCase() || null;
  if (billingEmail && !isValidEmail(billingEmail)) e.billingEmail = "Enter a valid email or leave it blank.";
  if (Object.keys(e).length) return { ok: false, errors: e };
  return {
    ok: true,
    value: {
      legalName,
      displayName,
      arn: arn as string,
      arnExpiry,
      principalEuin: euin,
      pan,
      gstRegistered,
      gstin,
      addressLine1,
      addressLine2: s(b.addressLine2) || null,
      city,
      state: state!.name,
      pincode,
      email,
      phone: phone!,
      billingEmail,
    },
  };
}

/** Pure: is the saved firm record complete enough to finish setup? */
export function firmDetailsComplete(t: { legal_name: string | null; arn: string | null; pan_number: string | null; address: { line1?: string; pincode?: string; state?: string } | null; email: string | null; phone: string | null; gst_registered: boolean | null; gst_number: string | null }): boolean {
  return !!(
    t.legal_name &&
    t.arn &&
    isValidPan(t.pan_number) &&
    t.address?.line1 &&
    t.address?.pincode &&
    gstState(t.address?.state) &&
    t.email &&
    t.phone &&
    t.gst_registered !== null &&
    (t.gst_registered === false || (t.gst_number && checkGstin(t.gst_number).ok))
  );
}

type Actor = { tenantId: string; userId: string; email: string; name: string; ip: string | null; userAgent: string | null };

export async function saveFirmDetails(a: Actor, d: FirmDetails): Promise<{ ok: true } | { ok: false; errors: FieldErrors }> {
  return withTenant(a.tenantId, async (tx) => {
    // ARN is unique across firms.
    const clash = (await tx.execute(sql`SELECT 1 FROM tenants WHERE arn = ${d.arn} AND id <> ${a.tenantId}::uuid AND deleted_at IS NULL LIMIT 1`)).rows.length;
    if (clash) return { ok: false as const, errors: { arn: "This ARN is already registered with another firm. Contact Aina if it is yours." } };
    const before = (await tx.execute(sql`SELECT legal_name, display_name, arn, pan_number, gst_number, address, email, phone FROM tenants WHERE id = ${a.tenantId}::uuid`)).rows[0] as Record<string, unknown>;
    const address = { line1: d.addressLine1, line2: d.addressLine2 ?? undefined, city: d.city, state: d.state, pincode: d.pincode, country: "India" };
    await tx.execute(sql`
      UPDATE tenants SET legal_name = ${d.legalName}, display_name = ${d.displayName}, arn = ${d.arn}, arn_expiry_at = ${d.arnExpiry}::date,
             principal_euin = ${d.principalEuin}, pan_number = ${d.pan}, gst_registered = ${d.gstRegistered}, gst_number = ${d.gstin},
             address = ${JSON.stringify(address)}::jsonb, email = ${d.email}, phone = ${d.phone}, billing_email = ${d.billingEmail}, updated_at = now()
       WHERE id = ${a.tenantId}::uuid
    `);
    await recordAudit(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: "onboarding.firm_details", entityType: "tenant", entityId: a.tenantId, before, after: { ...d }, ipAddress: a.ip, userAgent: a.userAgent });
    return { ok: true as const };
  });
}

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Pure: is this upload an image we accept? (Bytes are sniffed, not trusted from the browser.) */
export function sniffLogo(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function saveLogo(a: Actor, buf: Buffer, firmName: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (buf.length === 0) return { ok: false, error: "Choose an image." };
  if (buf.length > LOGO_MAX_BYTES) return { ok: false, error: "The logo must be 2 MB or smaller." };
  const type = sniffLogo(buf);
  if (!type) return { ok: false, error: "The logo must be a PNG, JPG or WebP image." };
  const key = vaultKey(a.tenantId, "general", `logo.${LOGO_TYPES[type]}`, { firm: firmName, docType: "logo" });
  await putObject(key, buf, type);
  const url = `/api/upload-local/${key}`;
  await withTenant(a.tenantId, async (tx) => {
    await tx.execute(sql`UPDATE tenants SET logo_url = ${url}, updated_at = now() WHERE id = ${a.tenantId}::uuid`);
    await recordAudit(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: "onboarding.logo", entityType: "tenant", entityId: a.tenantId, after: { logoUrl: url, bytes: buf.length, type }, ipAddress: a.ip, userAgent: a.userAgent });
  });
  return { ok: true, url };
}

export async function acceptTerms(a: Actor, documentId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return withTenant(a.tenantId, async (tx) => {
    const doc = (await currentDocuments(tx)).find((d) => d.kind === "terms");
    if (!doc || doc.id !== documentId) return { ok: false as const, error: "These Terms have been updated — please read the current version." };
    const done = (await tx.execute(sql`SELECT 1 FROM legal_acceptances WHERE tenant_id = ${a.tenantId}::uuid AND document_id = ${doc.id}::uuid`)).rows.length;
    if (done) return { ok: true as const };
    await tx.execute(sql`
      INSERT INTO legal_acceptances (tenant_id, user_id, document_id, kind, version, text_sha256, signer_name, email, ip_address, user_agent, otp_verified)
      VALUES (${a.tenantId}::uuid, ${a.userId}::uuid, ${doc.id}::uuid, 'terms', ${doc.version}, ${doc.bodySha256}, ${a.name}, ${a.email}, ${a.ip}, ${a.userAgent}, false)
    `);
    await recordAudit(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: "legal.terms_accepted", entityType: "legal_document", entityId: doc.id, after: { version: doc.version, sha256: doc.bodySha256 }, ipAddress: a.ip, userAgent: a.userAgent });
    return { ok: true as const };
  });
}

/** Step 4a: email the signer a one-time code (to their verified sign-in email). */
export async function sendNdaCode(a: Actor, documentId: string): Promise<{ ok: true; sentTo: string } | { ok: false; error: string }> {
  const r = await withTenant(a.tenantId, async (tx) => {
    const u = (await tx.execute(sql`SELECT lower(email) AS email, email_verified_at FROM users WHERE id = ${a.userId}::uuid`)).rows[0] as { email: string; email_verified_at: string | null } | undefined;
    if (!u?.email) return { ok: false as const, error: "Your account has no email." };
    if (!u.email_verified_at) return { ok: false as const, error: "Confirm your email first — use the link we sent when you signed up (or resend it from your profile)." };
    const doc = (await currentDocuments(tx)).find((d) => d.kind === "nda");
    if (!doc || doc.id !== documentId) return { ok: false as const, error: "The NDA has been updated — please read the current version." };
    const issued = await issueNdaOtp(tx, { tenantId: a.tenantId, userId: a.userId, documentId, email: u.email });
    if (!issued.ok) return { ok: false as const, error: `Please wait ${issued.waitSec} seconds before asking for another code.` };
    return { ok: true as const, code: issued.code, email: u.email };
  });
  if (!r.ok) return r;
  const sent = await sendSystemEmail({
    tenantId: a.tenantId,
    to: r.email,
    subject: `Your code to sign the NDA: ${r.code}`,
    text: `Your one-time code to sign the Non-Disclosure Agreement with ${LEGAL.legalEntity} is ${r.code}. It is valid for 10 minutes. If you did not ask for it, ignore this email.`,
    html: actionEmailHtml({
      heading: `Your code: ${r.code}`,
      intro: `Enter this code to sign the Non-Disclosure Agreement with ${LEGAL.legalEntity}. It is valid for 10 minutes. If you did not ask for it, ignore this email.`,
      buttonLabel: "Back to setup",
      buttonUrl: `${process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? LEGAL.url}/onboarding/setup`,
    }),
  });
  if (!sent.sent) return { ok: false, error: "We could not send the code just now — please try again in a minute." };
  return { ok: true, sentTo: r.email };
}

/** Step 4b: sign — verify the code, then record the immutable acceptance with its signed PDF. */
export async function signNda(
  a: Actor,
  input: { documentId: string; signerName: string; designation: string; code: string; agree: boolean }
): Promise<{ ok: true } | { ok: false; error: string; field?: string }> {
  const signerName = s(input.signerName);
  const designation = s(input.designation);
  if (!input.agree) return { ok: false, error: "Tick “I agree” to sign.", field: "agree" };
  if (signerName.length < 3) return { ok: false, error: "Type your full name.", field: "signerName" };
  if (designation.length < 2) return { ok: false, error: "Enter your designation.", field: "designation" };

  const prepared = await withTenant(a.tenantId, async (tx) => {
    const doc = (await currentDocuments(tx)).find((d) => d.kind === "nda");
    if (!doc || doc.id !== input.documentId) return { ok: false as const, error: "The NDA has been updated — please read the current version." };
    const already = (await tx.execute(sql`SELECT 1 FROM legal_acceptances WHERE tenant_id = ${a.tenantId}::uuid AND document_id = ${doc.id}::uuid`)).rows.length;
    if (already) return { ok: false as const, error: "already" };
    const otp = await verifyNdaOtp(tx, { tenantId: a.tenantId, userId: a.userId, documentId: doc.id, code: input.code });
    if (!otp.ok) return { ok: false as const, error: otp.message, field: "code" };
    const u = (await tx.execute(sql`SELECT lower(email) AS email FROM users WHERE id = ${a.userId}::uuid`)).rows[0] as { email: string };
    const t = (await tx.execute(sql`SELECT legal_name, display_name, arn FROM tenants WHERE id = ${a.tenantId}::uuid`)).rows[0] as { legal_name: string; display_name: string; arn: string | null };
    return { ok: true as const, doc, email: u.email, firm: t };
  });
  if (!prepared.ok) return prepared.error === "already" ? { ok: true } : prepared;

  const acceptedAt = new Date();
  const pdf = Buffer.from(
    await renderSignedLegalPdf({
      title: prepared.doc.title,
      version: prepared.doc.version,
      body: prepared.doc.body,
      bodySha256: prepared.doc.bodySha256,
      firmName: prepared.firm.legal_name,
      firmArn: prepared.firm.arn,
      signerName,
      designation,
      email: prepared.email,
      acceptedAt,
      ipAddress: a.ip,
      userAgent: a.userAgent,
      otpVerified: true,
      supplierName: LEGAL.legalEntity,
    })
  );
  const fileName = `NDA-v${prepared.doc.version}-signed.pdf`;
  const key = vaultKey(a.tenantId, "compliance", fileName, { firm: prepared.firm.display_name, uploader: signerName, docType: "agreements" });
  await putObject(key, pdf, "application/pdf");

  await withTenant(a.tenantId, async (tx) => {
    const docRowId = uuid();
    await tx.execute(sql`
      INSERT INTO compliance_documents (id, tenant_id, category, name, description, storage_key, mime_type, size_bytes, issued_on, tags, uploaded_by_user_id, created_at, updated_at)
      VALUES (${docRowId}::uuid, ${a.tenantId}::uuid, 'other', ${`Signed NDA with ${LEGAL.legalEntity} (v${prepared.doc.version})`},
              ${`Signed electronically by ${signerName}, ${designation}, confirmed by a one-time code to ${prepared.email}.`},
              ${key}, 'application/pdf', ${String(pdf.length)}, (now() AT TIME ZONE 'Asia/Kolkata')::date, ${JSON.stringify(["nda", "aina", "agreement"])}::jsonb, ${a.userId}::uuid, now(), now())
    `);
    await tx.execute(sql`
      INSERT INTO legal_acceptances (tenant_id, user_id, document_id, kind, version, text_sha256, signer_name, designation, email,
                                     accepted_at, ip_address, user_agent, otp_verified, signed_pdf_key, compliance_document_id)
      VALUES (${a.tenantId}::uuid, ${a.userId}::uuid, ${prepared.doc.id}::uuid, 'nda', ${prepared.doc.version}, ${prepared.doc.bodySha256},
              ${signerName}, ${designation}, ${prepared.email}, ${acceptedAt}, ${a.ip}, ${a.userAgent}, true, ${key}, ${docRowId}::uuid)
    `);
    await recordAudit(tx, {
      tenantId: a.tenantId,
      actorUserId: a.userId,
      action: "legal.nda_signed",
      entityType: "legal_document",
      entityId: prepared.doc.id,
      after: { version: prepared.doc.version, sha256: prepared.doc.bodySha256, signerName, designation, email: prepared.email, otpVerified: true, complianceDocumentId: docRowId },
      ipAddress: a.ip,
      userAgent: a.userAgent,
    });
  });

  const mail = await sendSystemEmail({
    tenantId: a.tenantId,
    to: prepared.email,
    subject: `Your signed NDA with ${LEGAL.legalEntity}`,
    text: `Thank you, ${signerName}. Your signed copy of the Non-Disclosure Agreement (version ${prepared.doc.version}) is attached. A copy is kept in your firm's Compliance documents.`,
    html: actionEmailHtml({
      heading: "Your signed NDA",
      intro: `Thank you, ${signerName}. Your signed copy of the Non-Disclosure Agreement (version ${prepared.doc.version}) is attached. A copy is kept in your firm's Compliance documents.`,
      buttonLabel: "Continue setup",
      buttonUrl: `${process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? LEGAL.url}/onboarding/setup`,
    }),
    idempotencyKey: `nda-signed:${a.tenantId}:${prepared.doc.id}`,
    attachments: [{ filename: fileName, content: pdf }],
  });
  if (!mail.sent) console.error(`[onboarding] signed NDA email to the signer failed (${mail.reason}) — the copy is in Compliance documents`);
  return { ok: true };
}

export type WizardState = {
  firmComplete: boolean;
  logoUrl: string | null;
  pending: LegalKind[];
  onboardedAt: string | null;
};

export async function wizardState(tenantId: string, inSetup: boolean): Promise<WizardState> {
  return withTenant(tenantId, async (tx) => {
    const t = (await tx.execute(sql`
      SELECT legal_name, arn, pan_number, address, email, phone, gst_registered, gst_number, logo_url, onboarded_at FROM tenants WHERE id = ${tenantId}::uuid
    `)).rows[0] as Parameters<typeof firmDetailsComplete>[0] & { logo_url: string | null; onboarded_at: string | null };
    const current = await currentDocuments(tx);
    const accepted = (await firmAcceptances(tx, tenantId)).map((x) => ({ kind: x.kind, documentId: x.document_id }));
    return {
      firmComplete: firmDetailsComplete(t),
      logoUrl: t.logo_url,
      pending: pendingLegalKinds(current, accepted, inSetup),
      onboardedAt: t.onboarded_at ? new Date(t.onboarded_at).toISOString() : null,
    };
  });
}

/** Step 5: mark the firm onboarded (once), audit, tell Aina, send the welcome email. */
export async function completeOnboarding(a: Actor): Promise<{ ok: true; first: boolean } | { ok: false; error: string }> {
  const st = await withTenant(a.tenantId, async (tx) => {
    const t = (await tx.execute(sql`SELECT onboarding_required, onboarded_at, display_name FROM tenants WHERE id = ${a.tenantId}::uuid FOR UPDATE`)).rows[0] as { onboarding_required: boolean; onboarded_at: string | null; display_name: string };
    return t;
  });
  const inSetup = st.onboarding_required && !st.onboarded_at;
  const ws = await wizardState(a.tenantId, inSetup);
  if (inSetup && !ws.firmComplete) return { ok: false, error: "Complete your firm details first." };
  if (ws.pending.length) return { ok: false, error: ws.pending.includes("terms") ? "Accept the Terms of Service first." : "Sign the NDA first." };
  if (!inSetup) return { ok: true, first: false };

  const first = await withTenant(a.tenantId, async (tx) => {
    const r = (await tx.execute(sql`UPDATE tenants SET onboarded_at = now(), updated_at = now() WHERE id = ${a.tenantId}::uuid AND onboarded_at IS NULL RETURNING onboarded_at`)).rows;
    if (!r.length) return false;
    await recordAudit(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: "onboarding.completed", entityType: "tenant", entityId: a.tenantId, after: { onboardedAt: (r[0] as { onboarded_at: string }).onboarded_at, logo: !!ws.logoUrl }, ipAddress: a.ip, userAgent: a.userAgent });
    return true;
  });
  if (!first) return { ok: true, first: false };

  // Tell Aina's platform admins (in-app on the platform workspace, and by email).
  try {
    const admins = await withSystem(async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT id, lower(email) AS email FROM users
         WHERE tenant_id = ${PLATFORM_TENANT_ID}::uuid AND status = 'active'
           AND ('platform_admin' = ANY(roles) OR 'platform_support' = ANY(roles))
      `)).rows as Array<{ id: string; email: string | null }>;
      for (const ad of rows) {
        await createNotification(tx, {
          tenantId: PLATFORM_TENANT_ID,
          userId: ad.id,
          kind: "platform.firm_onboarded",
          title: `${st.display_name} finished onboarding`,
          body: `Firm details, Terms and the signed NDA are on record.${ws.logoUrl ? "" : " No logo yet."}`,
          linkUrl: `/super-admin/tenants/${a.tenantId}`,
          severity: "success",
        });
      }
      return rows;
    });
    for (const ad of admins) {
      if (!ad.email) continue;
      await sendSystemEmail({
        tenantId: PLATFORM_TENANT_ID,
        to: ad.email,
        subject: `New firm onboarded: ${st.display_name}`,
        text: `${st.display_name} has paid, accepted the Terms, signed the NDA and finished setup.`,
        idempotencyKey: `onboarded:${a.tenantId}:${ad.id}`,
      });
    }
  } catch (err) {
    console.error("[onboarding] platform-admin notice failed:", (err as Error)?.message);
  }
  // The welcome email: once, never undoes onboarding, retried hourly if it fails.
  try {
    await sendWelcomeEmail(a.tenantId);
  } catch (err) {
    console.error("[onboarding] welcome email failed (will retry):", (err as Error)?.message);
  }
  return { ok: true, first: true };
}
