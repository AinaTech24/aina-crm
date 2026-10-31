/**
 * /privacy/[firm] — a firm's DPDP privacy notice, public (PUBLIC_PATH_PREFIXES
 * in middleware.ts). Every consent tick and email footer links here. The
 * content is lib/privacy/notice.ts; the firm's own additions come from
 * Settings → Privacy notice, its contact from Firm profile (data protection
 * officer, else the firm's email and phone).
 *
 * /privacy itself is AinaTech's own policy for people who use the CRM.
 */

import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { tenants } from "@/db/schema";
import { buildNoticeSections, privacyContact, readPrivacyNotice } from "@/lib/privacy/notice";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy notice",
  robots: { index: false, follow: false },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FirmPrivacyNoticePage({ params }: { params: Promise<{ firm: string }> }) {
  const { firm: firmId } = await params;
  const t = UUID_RE.test(firmId)
    ? await withSystem(async (tx) => {
        const [row] = await tx
          .select({
            displayName: tenants.displayName,
            legalName: tenants.legalName,
            arn: tenants.arn,
            address: tenants.address,
            email: tenants.email,
            phone: tenants.phone,
            logoUrl: tenants.logoUrl,
            dpo: tenants.dataProtectionOfficer,
            privacyNotice: tenants.privacyNotice,
          })
          .from(tenants)
          .where(eq(tenants.id, firmId))
          .limit(1);
        return row ?? null;
      })
    : null;

  if (!t) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-secondary px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center">
          <h1 className="text-lg font-semibold text-foreground">Privacy notice not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">Please check the link, or ask the firm that shared it.</p>
        </div>
      </main>
    );
  }

  const notice = readPrivacyNotice(t.privacyNotice);
  const a = t.address ?? {};
  const address = [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(", ");
  const sections = buildNoticeSections(
    { name: t.displayName, legalName: t.legalName, arn: t.arn, address },
    notice,
    privacyContact(t.dpo, { email: t.email, phone: t.phone })
  );

  return (
    <main className="min-h-screen bg-secondary px-4 py-10">
      <article className="mx-auto w-full max-w-2xl rounded-2xl border border-border bg-card p-6 sm:p-10">
        <header className="mb-8 border-b border-border pb-6">
          {t.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={t.logoUrl} alt={t.displayName} className="mb-4 h-10 w-auto" />
          ) : null}
          <h1 className="text-2xl font-bold text-foreground text-balance">Privacy notice — {t.displayName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Version {notice.version}
            {notice.publishedAt ? ` · updated ${formatDate(notice.publishedAt)}` : ""}
          </p>
        </header>
        <div className="space-y-7">
          {sections.map((s) => (
            <section key={s.heading}>
              <h2 className="mb-2 text-base font-semibold text-foreground">{s.heading}</h2>
              {s.paragraphs?.map((p) => (
                <p key={p} className="mb-2 text-sm leading-relaxed text-foreground/90">{p}</p>
              ))}
              {s.bullets && (
                <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-foreground/90">
                  {s.bullets.map((b) => <li key={b}>{b}</li>)}
                </ul>
              )}
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
