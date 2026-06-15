/**
 * CAMS mailback parser — placeholder.
 *
 * CAMS ships its own report layouts (e.g. the WBR2 holdings feed, often
 * pipe-delimited). This stub is wired into the dispatcher so the format is
 * recognised once a real CAMS sample is supplied; fill in `isCamsFile` +
 * `parseCamsFile` against that sample's header, emitting `RtaFolioRecord[]`
 * exactly like the Kfintech parser does.
 */

import type { RtaFolioRecord } from "./types";

export function isCamsFile(_header: string[]): boolean {
  // TODO: match the CAMS report header once a sample file is provided.
  return false;
}

export function parseCamsFile(_rows: string[][]): {
  reportType: string;
  folios: RtaFolioRecord[];
  missingPan: number;
  warnings: string[];
} {
  return { reportType: "", folios: [], missingPan: 0, warnings: ["CAMS parser not yet implemented — awaiting a sample file."] };
}
