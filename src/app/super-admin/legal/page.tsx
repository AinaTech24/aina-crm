import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { listLegalDocs } from "@/lib/legal/admin";
import { LegalDocsAdmin } from "@/components/super-admin/LegalDocsAdmin";

export const dynamic = "force-dynamic";

export default async function PlatformLegalPage() {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.settings.manage");
  const docs = await listLegalDocs();
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="page-title">Legal documents</h1>
        <p className="text-muted-foreground text-sm">
          The Terms of Service and the NDA every firm accepts during setup. A published version can never be changed —
          publish a new version instead, and every firm that accepted an earlier one is asked to accept it at its next
          sign-in.
        </p>
      </div>
      <LegalDocsAdmin docs={docs} />
    </div>
  );
}
