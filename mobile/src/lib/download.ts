/**
 * Download a file the CRM serves behind the session (a proposal PDF, a goal
 * plan) and hand it to the phone's share sheet — save to Files, WhatsApp,
 * email, print. A plain link cannot do this: the API needs the Bearer token,
 * so the file is fetched with it into the app's cache first.
 */

import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { API_BASE_URL } from "../config";
import { useSession } from "../state/session";

export async function downloadAndShare(path: string, filename: string, mimeType = "application/pdf"): Promise<void> {
  const token = useSession.getState().token;
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, "_");
  const dest = new File(Paths.cache, safe);
  if (dest.exists) dest.delete();
  let file: File;
  try {
    file = await File.downloadFileAsync(`${API_BASE_URL}${path}`, dest, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      idempotent: true,
    });
  } catch (e: any) {
    // The native error carries the HTTP status in its text; say what it means.
    const msg = String(e?.message ?? "");
    if (/\b404\b/.test(msg)) throw new Error("This file isn't available — the record may be gone, or the CRM server needs its latest update.");
    if (/\b40[13]\b/.test(msg)) throw new Error("You don't have access to this file.");
    throw new Error("Couldn't download the file. Check your connection and try again.");
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: safe, UTI: mimeType === "application/pdf" ? "com.adobe.pdf" : undefined });
}
