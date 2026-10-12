/**
 * E16 — one archive, one data file; passwords.
 *
 * The extractor imported only the FIRST data-looking entry of a multi-file zip
 * and silently dropped the rest, and its "retry the other way" was a no-op.
 * SYNTHETIC archives, built in memory (tests/rta-fixtures.ts).
 */
import { describe, expect, it } from "vitest";
import { extractRtaFileFromZip, RtaArchiveError, classifyArchiveEntries } from "@/lib/rta/unzip";
import { CSV_FEED, makeWorkbook, makeZip } from "./rta-fixtures";

const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("extractRtaFileFromZip — entries", () => {
  it("exactly one data file → extracted, other files noted as ignored", async () => {
    const zip = await makeZip([
      { name: "readme.pdf", data: "%PDF-1.4" },
      { name: "feed.csv", data: CSV_FEED },
    ]);
    const r = await extractRtaFileFromZip(zip);
    expect(r.filename).toBe("feed.csv");
    expect(text(r.data)).toBe(CSV_FEED);
    expect(r.notes).toEqual(["Ignored 1 non-data file(s) in the archive: readme.pdf."]);
  });

  it("directories and macOS junk are not entries", async () => {
    const zip = await makeZip([
      { name: "out/", data: "", directory: true },
      { name: "__MACOSX/out/._feed.csv", data: "junk" },
      { name: "out/._feed.csv", data: "junk" },
      { name: "out/feed.csv", data: CSV_FEED },
    ]);
    const r = await extractRtaFileFromZip(zip);
    expect(r.filename).toBe("out/feed.csv");
    expect(r.notes).toEqual([]);
  });

  it("a .dbf or .xlsx entry is a data file (the old preference regex skipped .dbf)", async () => {
    const dbf = makeWorkbook([["FOLIO"], ["1"]], "dbf");
    const r = await extractRtaFileFromZip(await makeZip([{ name: "readme.txt.bak", data: "x" }, { name: "nav.dbf", data: dbf }]));
    expect(r.filename).toBe("nav.dbf");
    const x = await extractRtaFileFromZip(await makeZip([{ name: "Feed.XLSX", data: makeWorkbook([["a"]], "xlsx") }]));
    expect(x.filename).toBe("Feed.XLSX");
  });

  it("more than one data file → the WHOLE archive is rejected, naming them", async () => {
    const zip = await makeZip([
      { name: "a.csv", data: CSV_FEED },
      { name: "b.dbf", data: makeWorkbook([["FOLIO"], ["1"]], "dbf") },
      { name: "notes.pdf", data: "%PDF" },
    ]);
    const err = await extractRtaFileFromZip(zip).catch((e) => e);
    expect(err).toBeInstanceOf(RtaArchiveError);
    expect(err.message).toBe(
      "The archive holds 2 data files (a.csv, b.dbf) — this importer reads one file per upload, so nothing was imported. Upload them separately."
    );
    // The worker treats any error mentioning a password as "not this firm's file".
    expect(err.message).not.toMatch(/password/i);
  });

  it("no data file → rejected", async () => {
    const err = await extractRtaFileFromZip(await makeZip([{ name: "statement.pdf", data: "%PDF" }])).catch((e) => e);
    expect(err).toBeInstanceOf(RtaArchiveError);
    expect(err.message).toMatch(/^The archive contains no data file .* it holds only: statement\.pdf\.$/);
    const empty = await extractRtaFileFromZip(await makeZip([{ name: "d/", data: "", directory: true }])).catch((e) => e);
    expect(empty.message).toBe("The archive contains no data file — it is empty.");
  });

  it("classifyArchiveEntries sorts data from the rest", () => {
    expect(
      classifyArchiveEntries([
        { filename: "x/", directory: true },
        { filename: "a.TXT", directory: false },
        { filename: "b.xlsb", directory: false },
        { filename: "c.json", directory: false },
        { filename: "__MACOSX/a.TXT", directory: false },
      ])
    ).toEqual({ data: ["a.TXT", "b.xlsb"], other: ["c.json"] });
  });
});

describe("extractRtaFileFromZip — passwords", () => {
  for (const zipCrypto of [false, true]) {
    const label = zipCrypto ? "ZipCrypto" : "WinZip AES";
    it(`${label}: right password opens it`, async () => {
      const zip = await makeZip([{ name: "feed.csv", data: CSV_FEED }], { password: "Synth@123", zipCrypto });
      const r = await extractRtaFileFromZip(zip, "Synth@123");
      expect(text(r.data)).toBe(CSV_FEED);
    });
    it(`${label}: wrong password → "Invalid password"`, async () => {
      const zip = await makeZip([{ name: "feed.csv", data: CSV_FEED }], { password: "Synth@123", zipCrypto });
      await expect(extractRtaFileFromZip(zip, "nope")).rejects.toThrow(/Invalid password/);
    });
    it(`${label}: missing password → "File contains encrypted entry"`, async () => {
      const zip = await makeZip([{ name: "feed.csv", data: CSV_FEED }], { password: "Synth@123", zipCrypto });
      await expect(extractRtaFileFromZip(zip)).rejects.toThrow(/encrypted entry/);
    });
  }

  it("a password supplied for an UNencrypted archive is harmless", async () => {
    const zip = await makeZip([{ name: "feed.csv", data: CSV_FEED }]);
    const r = await extractRtaFileFromZip(zip, "unused");
    expect(text(r.data)).toBe(CSV_FEED);
  });

  it("an encrypted multi-file archive with the WRONG password fails as a password error, not as 'too many files'", async () => {
    const zip = await makeZip(
      [
        { name: "a.csv", data: CSV_FEED },
        { name: "b.csv", data: CSV_FEED },
      ],
      { password: "Synth@123" }
    );
    await expect(extractRtaFileFromZip(zip, "nope")).rejects.toThrow(/Invalid password/);
    await expect(extractRtaFileFromZip(zip)).rejects.toThrow(/encrypted entry/);
    // …and with the right one, the multi-file rejection.
    await expect(extractRtaFileFromZip(zip, "Synth@123")).rejects.toThrow(/holds 2 data files \(a\.csv, b\.csv\)/);
  });
});
