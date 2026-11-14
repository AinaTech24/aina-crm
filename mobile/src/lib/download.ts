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
  const file = await File.downloadFileAsync(`${API_BASE_URL}${path}`, dest, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    idempotent: true,
  });
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: safe, UTI: mimeType === "application/pdf" ? "com.adobe.pdf" : undefined });
}
