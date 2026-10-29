import Link from "next/link";
import { asc, desc } from "drizzle-orm";
import { Plus, BookOpen, Eye, EyeOff, ImageIcon, HelpCircle, FolderTree } from "lucide-react";
import { withPlatformAdmin } from "@/db/client";
import { kbArticles, kbCategories, kbFolders } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { InstallStarterButton } from "@/components/super-admin/InstallStarterButton";

export const dynamic = "force-dynamic";

export default async function KbArticlesPage() {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.package.manage");
  const { rows, cats, folders } = await withPlatformAdmin(session.userId, async (tx) => ({
    rows: await tx.select().from(kbArticles).orderBy(asc(kbArticles.sortOrder), desc(kbArticles.episodeNo)).limit(500),
    cats: await tx.select({ id: kbCategories.id, name: kbCategories.name }).from(kbCategories),
    folders: await tx.select({ id: kbFolders.id, name: kbFolders.name, categoryId: kbFolders.categoryId }).from(kbFolders),
  }));
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const folderPath = new Map(folders.map((f) => [f.id, `${catName.get(f.categoryId) ?? "?"} › ${f.name}`]));

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Knowledge Base</h1>
          <p className="text-muted-foreground text-sm">
            Help-centre guides with screenshots, shown publicly on the website. Organise them into categories and folders; changes go live immediately.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/super-admin/kb-articles/structure" className="rounded-md border px-3 py-1.5 text-sm inline-flex items-center gap-1.5 hover:bg-accent">
            <FolderTree className="size-4" /> Categories &amp; folders
          </Link>
          <Link href="/knowledge-base" target="_blank" className="rounded-md border px-3 py-1.5 text-sm inline-flex items-center gap-1.5 hover:bg-accent">
            <Eye className="size-4" /> View hub
          </Link>
          <Link href="/super-admin/kb-articles/new" className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5">
            <Plus className="size-4" /> New article
          </Link>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-xl">
          New to this? Add one draft guide per module process (dashboards, tasks, clients, SIPs, automations and more). They stay
          hidden until you add screenshots and publish them.
        </p>
        <InstallStarterButton />
      </div>

      {rows.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted-foreground border rounded-lg bg-card">
          <BookOpen className="size-8 mx-auto text-muted-foreground/50" />
          <div className="mt-2">No articles yet.</div>
          <Link href="/super-admin/kb-articles/new" className="text-primary hover:underline mt-2 inline-block">
            Write the first article →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((a) => {
            const shots = Array.isArray(a.screenshots) ? a.screenshots.length : 0;
            const qs = Array.isArray(a.questions) ? a.questions.length : 0;
            return (
              <Link
                key={a.id}
                href={`/super-admin/kb-articles/${a.id}`}
                className={`flex items-center gap-4 border rounded-lg bg-card px-4 py-3 hover:border-primary/40 hover:shadow-sm transition ${a.published ? "" : "opacity-60"}`}
              >
                <div className="w-16 shrink-0 text-center">
                  <div className="text-2xs font-bold uppercase tracking-wider text-primary">{a.series}</div>
                  <div className="text-sm font-mono tabular-nums">{a.episodeNo != null ? `#${a.episodeNo}` : "—"}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{a.title}</div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {a.folderId ? folderPath.get(a.folderId) ?? "Unfiled" : "Unfiled"} · /{a.slug}
                    {a.hook ? ` · ${a.hook}` : ""}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-3 text-2xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1" title={`${qs} questions`}>
                    <HelpCircle className="size-3.5" /> {qs}
                  </span>
                  <span className="inline-flex items-center gap-1" title={`${shots} screenshots`}>
                    <ImageIcon className="size-3.5" /> {shots}
                  </span>
                </div>
                <div className="shrink-0 w-6 flex justify-center" title={a.published ? "Published" : "Draft"}>
                  {a.published ? <Eye className="size-4 text-emerald-600" /> : <EyeOff className="size-4 text-muted-foreground" />}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
