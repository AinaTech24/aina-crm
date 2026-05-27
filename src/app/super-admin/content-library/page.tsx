import Link from "next/link";
import { desc } from "drizzle-orm";
import { Plus, Image as ImageIcon, FileText, Presentation, Video, Music, File } from "lucide-react";
import { withSystem } from "@/db/client";
import { contentLibraryAssets } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/platform";
import { formatDate } from "@/lib/utils";

const TYPE_ICON: Record<string, any> = {
  image: ImageIcon,
  pdf: FileText,
  article: FileText,
  presentation: Presentation,
  video: Video,
  audio: Music,
  other: File,
};

const TYPE_TONE: Record<string, string> = {
  image: "bg-emerald-50 text-emerald-700",
  pdf: "bg-rose-50 text-rose-700",
  article: "bg-blue-50 text-blue-700",
  presentation: "bg-amber-50 text-amber-700",
  video: "bg-violet-50 text-violet-700",
  audio: "bg-cyan-50 text-cyan-700",
  other: "bg-gray-50 text-gray-700",
};

export const dynamic = "force-dynamic";

export default async function AinaContentLibraryPage() {
  const session = await requireSession();
  if (!isPlatformAdmin(session.roles)) {
    return (
      <div className="card-surface p-12 text-center text-sm text-muted-foreground">
        Platform admins only.
      </div>
    );
  }

  const rows = await withSystem(async (tx) =>
    tx.select().from(contentLibraryAssets).orderBy(desc(contentLibraryAssets.createdAt))
  );

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <ImageIcon className="size-6 text-brand-cyan" /> Content Library
          </h1>
          <p className="page-subtitle">
            Assets MFDs can co-brand and download — festive creatives, market updates, articles,
            presentations, PDFs.
          </p>
        </div>
        <Link href="/super-admin/content-library/new" className="btn-primary">
          <Plus className="size-4" /> Upload asset
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          <ImageIcon className="size-8 mx-auto text-muted-foreground/50" />
          <div className="mt-2 font-medium">No assets yet.</div>
          <p className="mt-2 text-xs max-w-md mx-auto">
            Upload a festive image, market-update article, or scheme presentation that all MFDs can
            share with their own branding.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {rows.map((a) => {
            const Icon = TYPE_ICON[a.type] ?? File;
            return (
              <div
                key={a.id}
                className={`card-surface overflow-hidden ${!a.isActive ? "opacity-50" : ""}`}
              >
                <div className="aspect-video bg-secondary/40 grid place-items-center overflow-hidden">
                  {a.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.thumbnailUrl}
                      alt={a.title}
                      className="object-cover w-full h-full"
                    />
                  ) : (
                    <Icon className="size-10 text-muted-foreground/50" />
                  )}
                </div>
                <div className="p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`chip text-[10px] ${TYPE_TONE[a.type] ?? ""}`}>
                      {a.type}
                    </span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {formatDate(a.createdAt)}
                    </span>
                  </div>
                  <div className="font-semibold text-sm leading-tight">{a.title}</div>
                  {a.description && (
                    <div className="text-[11px] text-muted-foreground line-clamp-2">
                      {a.description}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground capitalize">
                    {a.category.replace(/_/g, " ")}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
