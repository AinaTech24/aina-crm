/**
 * The proposal PDF on the phone — the same document the client receives
 * (renderProposalPdf on the server), handed to the share sheet: save to
 * Files, open in a PDF viewer, WhatsApp, print.
 *
 *  - downloadProposalPdf: a saved proposal, GET /api/proposals/[id]/pdf?download=1
 *    (lib/download's authenticated download).
 *  - previewProposalPdf: the builder's "Review as client" step, POST
 *    /api/proposals/preview-pdf with what is in the builder — nothing is
 *    saved. A POST body cannot go through File.downloadFileAsync, so it is
 *    fetched with the session's Bearer token here (mirroring lib/download).
 */

import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { API_BASE_URL } from "../../config";
import { useSession } from "../../state/session";
import { fetchMe } from "../../api/me";
import { downloadAndShare } from "../../lib/download";

/** The web's file name (proposal page DownloadButton). */
export const proposalPdfName = (number?: string | null) =>
  `Proposal_${String(number || "proposal").replace(/[^a-z0-9]+/gi, "_")}.pdf`;

export function downloadProposalPdf(id: string, proposalNumber?: string | null): Promise<void> {
  return downloadAndShare(`/api/proposals/${id}/pdf?download=1`, proposalPdfName(proposalNumber));
}

export async function previewProposalPdf(body: Record<string, unknown>, filename = "Proposal_preview.pdf"): Promise<void> {
  const post = (token: string | null) =>
    fetch(`${API_BASE_URL}/api/proposals/preview-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  let res = await post(useSession.getState().token);
  if (res.status === 401) {
    // An expired token: one authenticated call through the API client refreshes it.
    await fetchMe().catch(() => {});
    res = await post(useSession.getState().token);
  }
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error ?? `Couldn't render the PDF (${res.status})`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, "_");
  const dest = new File(Paths.cache, safe);
  if (dest.exists) dest.delete();
  dest.create();
  dest.write(bytes);
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(dest.uri, { mimeType: "application/pdf", dialogTitle: safe, UTI: "com.adobe.pdf" });
}
