import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { KbArticleForm } from "@/components/super-admin/KbArticleForm";
import { loadFolderOptions } from "@/lib/kb/admin";

export const dynamic = "force-dynamic";

export default async function NewKbArticlePage() {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.package.manage");
  const folders = await withPlatformAdmin(session.userId, (tx) => loadFolderOptions(tx));
  return <KbArticleForm folders={folders} />;
}
