/**
 * The Documents vault shows EVERY folder and document, a page at a time (2026-11-26): it used to
 * load only the 100 newest documents, so an older client's folder disappeared and search missed it.
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIRM_FOLDER, containsPattern, parsePage, parseVaultFilter } from "@/lib/compliance/vault-view";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("vault filter and paging rules", () => {
  it("reads search, category and page from the URL, ignoring what it does not know", () => {
    expect(parseVaultFilter("  Patel ", "kyd")).toEqual({ q: "Patel", category: "kyd" });
    expect(parseVaultFilter(undefined, "all")).toEqual({ q: "", category: "" });
    expect(parseVaultFilter("x".repeat(300), "nope").q).toHaveLength(100);
    expect(parsePage("3")).toBe(3);
    for (const bad of [undefined, "0", "-2", "abc"]) expect(parsePage(bad)).toBe(1);
  });

  it("searches for what was typed as plain text", () => {
    expect(containsPattern("50%_a\\b")).toBe("%50\\%\\_a\\\\b%");
  });

  it("loads no capped list: the page asks for a page of folders, a folder for a page of documents", () => {
    const page = read("src/app/dashboard/documents/page.tsx");
    expect(page).toContain("loadVaultFolders(");
    expect(page).not.toContain(".limit(100)");
    const lib = read("src/lib/compliance/vault-folders.ts");
    expect(lib).toContain("vaultScopeFragment(tx, session)"); // the viewer's scope, on both queries
    expect(lib).toContain("c.name ILIKE"); // a client is found by name, email or phone
    const route = read("src/app/api/compliance/documents/folder/route.ts");
    expect(route).toContain("canOpenVault(session)");
    expect(read("src/components/compliance/DocumentsFeed.tsx")).toContain("<Pager page={page}");
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;
describe.skipIf(!TEST_DB)("the vault queries", () => {
  it("run against the real schema, for a whole-vault viewer and an own-clients one", async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    const { withSystem } = await import("@/db/client");
    const { loadVaultFolders, loadFolderDocs } = await import("@/lib/compliance/vault-folders");
    for (const role of ["owner", "rm"]) {
      const session = { tenantId: randomUUID(), userId: randomUUID(), roles: [role], permissions: [], branchId: null } as never;
      const filter = { q: "pat%el", category: "kyd" as const };
      const folders = await withSystem((tx) => loadVaultFolders(tx, session, filter, 3));
      expect(folders).toEqual({ folders: [], total: 0, page: 1 });
      for (const folder of [FIRM_FOLDER, randomUUID()]) {
        const docs = await withSystem((tx) => loadFolderDocs(tx, session, folder, filter, 2));
        expect(docs).toEqual({ docs: [], total: 0, page: 1 });
      }
    }
  });
});
