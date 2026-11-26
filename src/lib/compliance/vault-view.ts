/**
 * The Documents vault's list — the shapes and URL rules shared by the page, the folder route and
 * the browser (no database here; the queries are in ./vault-folders.ts).
 *
 * A "folder" is one client's documents; everything not filed against a client is the firm folder.
 * Folders are paged, and the documents inside an open folder are paged on their own.
 */

export const FOLDERS_PER_PAGE = 25;
export const DOCS_PER_PAGE = 20;
/** The folder of documents not filed against a client. */
export const FIRM_FOLDER = "firm";
/** What one ZIP holds (the download-all route's own cap). */
export const ZIP_MAX_DOCS = 60;

export const VAULT_CATEGORIES = [
  "arn", "euin", "nism", "kyd", "amc_empanelment", "ddq", "sop", "complaint",
  "marketing_approval", "audit_report", "ria_compliance", "other",
] as const;
export type VaultCategory = (typeof VAULT_CATEGORIES)[number];

export type VaultFilter = { q: string; category: VaultCategory | "" };

export type VaultFolder = {
  /** The client's id, or FIRM_FOLDER. */
  key: string;
  clientId: string | null;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  clientAvatar: string | null;
  /** Documents in it that match the filter, and their ids (newest first). */
  count: number;
  ids: string[];
  expired: number;
  expiring: number;
};

export type VaultDoc = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  mimeType: string | null;
  expiresOn: string | null;
  createdAt: string | null;
};

/** Search text and category from URL params; anything unknown is ignored. */
export function parseVaultFilter(q: string | null | undefined, category: string | null | undefined): VaultFilter {
  const c = (category ?? "").trim();
  return {
    q: (q ?? "").trim().slice(0, 100),
    category: (VAULT_CATEGORIES as readonly string[]).includes(c) ? (c as VaultCategory) : "",
  };
}

export function parsePage(v: string | null | undefined): number {
  const n = parseInt(v ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100_000) : 1;
}

/** A "contains" ILIKE pattern in which what was typed is only ever text (% and _ are not wildcards). */
export function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}
