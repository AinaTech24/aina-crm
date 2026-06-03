/**
 * Live CAMS / KFintech feed ingestion.
 *
 * Polls a configured drop location for new RTA files and runs each through the
 * existing processor (src/lib/rta/process.ts) — turning the platform from
 * "ops hand-uploads Excel" into "files land → AUM/holdings/transactions update
 * automatically". RTAs deliver via SFTP; in most real deployments that SFTP
 * share is mounted as a local directory, which is exactly the default source
 * here. A native SFTP client is a documented extension point (set
 * RTA_FEED_SOURCE=sftp and install ssh2-sftp-client).
 *
 * Drop-folder layout (RTA_FEED_DIR):
 *     <RTA_FEED_DIR>/<tenantId>/incoming/<source>__<kind>__<label>.<ext>
 *   processed files are moved to  .../<tenantId>/processed/
 *   files that fail to parse to    .../<tenantId>/failed/
 *
 *   e.g.  feed-inbox/3a82.../incoming/cams__daily_transaction_feed__2026-06-03.csv
 *         feed-inbox/3a82.../incoming/kfintech__sip_rejection_report__2026-06-03.csv
 *
 * Idempotency: ingestRtaText() dedupes by file checksum, and the processor
 * upserts every row by natural key, so re-processing a file is a no-op.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { withTenant } from "@/db/client";
import { ingestRtaText } from "@/lib/rta/ingest";
import { RTA_FILE_KINDS, RTA_SOURCES, type RtaFileKind, type RtaSource } from "@/db/schema/rta_imports";

export interface FeedIngestResult {
  enabled: boolean;
  tenantsScanned: number;
  filesFound: number;
  filesIngested: number;
  filesFailed: number;
  durationMs: number;
}

/** Parse "<source>__<kind>__<label>.<ext>" → {source, kind} (or null). */
export function parseFeedFileName(name: string): { source: RtaSource; kind: RtaFileKind } | null {
  const base = name.replace(/\.[^.]+$/, "");
  const parts = base.split("__");
  if (parts.length < 2) return null;
  const source = parts[0] as RtaSource;
  const kind = parts[1] as RtaFileKind;
  if (!(RTA_SOURCES as readonly string[]).includes(source)) return null;
  if (!(RTA_FILE_KINDS as readonly string[]).includes(kind)) return null;
  return { source, kind };
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function moveTo(srcFile: string, destDir: string) {
  await ensureDir(destDir);
  const dest = path.join(destDir, path.basename(srcFile));
  await fs.rename(srcFile, dest).catch(async () => {
    // cross-device fallback: copy + unlink
    await fs.copyFile(srcFile, dest);
    await fs.unlink(srcFile);
  });
}

export async function runFeedIngest(): Promise<FeedIngestResult> {
  const startedAt = Date.now();
  const root = process.env.RTA_FEED_DIR;
  const sourceMode = process.env.RTA_FEED_SOURCE ?? "local_dir";

  if (sourceMode === "sftp") {
    // Extension point — kept honest: we don't ship a half-working SFTP client.
    throw new Error(
      "RTA_FEED_SOURCE=sftp requires the ssh2-sftp-client dependency and RTA_FEED_SFTP_* env (host/user/key/path). " +
        "Sync the SFTP share to RTA_FEED_DIR (local_dir mode) or implement the sftp branch."
    );
  }

  if (!root) {
    return { enabled: false, tenantsScanned: 0, filesFound: 0, filesIngested: 0, filesFailed: 0, durationMs: Date.now() - startedAt };
  }

  await ensureDir(root);
  let tenantDirs: string[] = [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    tenantDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    tenantDirs = [];
  }

  let filesFound = 0;
  let filesIngested = 0;
  let filesFailed = 0;

  for (const tenantId of tenantDirs) {
    const incoming = path.join(root, tenantId, "incoming");
    let files: string[] = [];
    try {
      files = (await fs.readdir(incoming)).filter((f) => !f.startsWith("."));
    } catch {
      continue; // no incoming dir for this tenant
    }

    for (const fileName of files) {
      const full = path.join(incoming, fileName);
      const meta = parseFeedFileName(fileName);
      if (!meta) {
        filesFound++;
        filesFailed++;
        console.warn(`[feed-ingest] ${tenantId}: unrecognised file name '${fileName}' (need <source>__<kind>__...)`);
        await moveTo(full, path.join(root, tenantId, "failed")).catch(() => {});
        continue;
      }
      filesFound++;
      try {
        const text = await fs.readFile(full, "utf8");
        const res = await withTenant(tenantId, async (tx) =>
          ingestRtaText(tx, {
            tenantId,
            source: meta.source,
            kind: meta.kind,
            fileName,
            text,
            uploadedBy: null,
          })
        );
        if (res.status === "failed") {
          filesFailed++;
          await moveTo(full, path.join(root, tenantId, "failed"));
          console.warn(`[feed-ingest] ${tenantId}: ${fileName} failed — ${res.error ?? "parser error"}`);
        } else {
          filesIngested++;
          await moveTo(full, path.join(root, tenantId, "processed"));
          console.log(
            `[feed-ingest] ${tenantId}: ${fileName} → ${res.status} ` +
              `(imported ${res.rowsImported ?? 0}/${res.rowsTotal ?? 0}${res.duplicate ? ", duplicate" : ""})`
          );
        }
      } catch (err: any) {
        filesFailed++;
        await moveTo(full, path.join(root, tenantId, "failed")).catch(() => {});
        console.error(`[feed-ingest] ${tenantId}: ${fileName} errored — ${err?.message ?? err}`);
      }
    }
  }

  return {
    enabled: true,
    tenantsScanned: tenantDirs.length,
    filesFound,
    filesIngested,
    filesFailed,
    durationMs: Date.now() - startedAt,
  };
}
