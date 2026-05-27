import Link from "next/link";
import { desc } from "drizzle-orm";
import {
  Image as ImageIcon,
  FileText,
  Presentation,
  Video,
  Music,
  File,
  Sparkles,
} from "lucide-react";
import { withSystem } from "@/db/client";
import { contentLibraryAssets } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils";
import { FilterBar } from "@/components/common/FilterBar";
import { CustomViews } from "@/components/common/CustomViews";

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

export default async function AinaLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  await requireSession();
  const q = (sp.q ?? "").trim().toLowerCase();
  const categoryFilter = (sp.category ?? "").split(",").filter(Boolean);
  const typeFilter = (sp.type ?? "").split(",").filter(Boolean);

  const allRows = await withSystem(async (tx) =>
    tx.select().from(contentLibraryAssets).orderBy(desc(contentLibraryAssets.createdAt))
  );
  let rows = allRows.filter(
    (r) => r.isActive && (!r.expireAt || new Date(r.expireAt) > new Date())
  );
  if (q) {
    rows = rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false)
    );
  }
  if (categoryFilter.length) rows = rows.filter((r) => categoryFilter.includes(r.category));
  if (typeFilter.length) rows = rows.filter((r) => typeFilter.includes(r.type));

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="page-title">
          <Sparkles className="size-6 text-brand-cyan" /> AINA Content Library
        </h1>
        <p className="page-subtitle">
          Festive creatives, market updates, articles, presentations — download with your branding
          baked in.
        </p>
      </div>

      <FilterBar
        totalCount={rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search assets by title or description…" },
          {
            type: "multi",
            key: "type",
            label: "Type",
            options: [
              { value: "image", label: "Image" },
              { value: "pdf", label: "PDF" },
              { value: "article", label: "Article" },
              { value: "presentation", label: "Presentation" },
              { value: "video", label: "Video" },
              { value: "audio", label: "Audio" },
              { value: "other", label: "Other" },
            ],
          },
          {
            type: "multi",
            key: "category",
            label: "Category",
            options: [
              { value: "festive", label: "Festive" },
              { value: "market_update", label: "Market update" },
              { value: "investor_education", label: "Investor education" },
              { value: "product_brochure", label: "Product brochure" },
              { value: "tax_planning", label: "Tax planning" },
              { value: "regulatory", label: "Regulatory" },
              { value: "newsletter", label: "Newsletter" },
              { value: "social_creative", label: "Social creative" },
              { value: "thought_leadership", label: "Thought leadership" },
              { value: "other", label: "Other" },
            ],
          },
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:aina-library"
            presets={[
              { id: "images", name: "Images only", params: "type=image" },
              { id: "festive", name: "Festive creatives", params: "category=festive&type=image" },
              { id: "market", name: "Market updates", params: "category=market_update" },
              { id: "education", name: "Investor education", params: "category=investor_education" },
            ]}
          />
        }
      />

      {rows.length === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          <Sparkles className="size-8 mx-auto text-muted-foreground/50" />
          <div className="mt-2 font-medium">No assets in the library yet.</div>
          <p className="mt-2 text-xs max-w-md mx-auto">
            AINA uploads festive creatives, market updates, and articles here. Check back soon.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {rows.map((a) => {
            const Icon = TYPE_ICON[a.type] ?? File;
            return (
              <Link
                key={a.id}
                href={`/dashboard/aina-library/${a.id}`}
                className="card-surface overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-150 block"
              >
                <div className="aspect-video bg-secondary/40 grid place-items-center overflow-hidden relative">
                  {a.type === "image" ? (
                    // Always pull image previews through the branded endpoint
                    // so we never expose the raw S3 URL to the MFD's browser.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/content-library/${a.id}/branded?mode=preview`}
                      alt={a.title}
                      className="object-cover w-full h-full"
                    />
                  ) : a.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.thumbnailUrl}
                      alt={a.title}
                      className="object-cover w-full h-full"
                    />
                  ) : (
                    <Icon className="size-10 text-muted-foreground/50" />
                  )}
                  <span
                    className={`absolute top-2 left-2 chip text-[10px] ${
                      TYPE_TONE[a.type] ?? ""
                    }`}
                  >
                    {a.type}
                  </span>
                </div>
                <div className="p-3 space-y-1">
                  <div className="font-semibold text-sm leading-tight line-clamp-2">
                    {a.title}
                  </div>
                  {a.description && (
                    <div className="text-[11px] text-muted-foreground line-clamp-2">
                      {a.description}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground capitalize flex items-center justify-between">
                    <span>{a.category.replace(/_/g, " ")}</span>
                    <span className="tabular-nums">{formatDate(a.createdAt)}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
