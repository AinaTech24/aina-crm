/**
 * Generate a best-effort synthetic CAMS WBR2-style reverse-feed file for FP
 * sandbox testing.
 *
 *   node scripts/fp-make-sample.mjs > sample-wbr2.txt
 *
 * NOTE: FP's transaction_processing expects the REAL RTA reverse-feed layout and
 * validates schemes against its master. This synthetic file uses the sandbox
 * test ISINs but the exact WBR2 column set / product codes are RTA-internal, so
 * FP may still reject it. Use this to exercise the pipeline and read FP's error;
 * a guaranteed-clean run needs a real RTA file or Cybrilla-loaded sandbox data.
 */

// Sandbox test ISINs from the FP credentials sheet (ICICI Prudential AMC = 109K).
const ISINS = [
  "INF109K01423",
  "INF109KC1TY0",
  "INF109KC1TV6",
  "INF109KC1TU8",
  "INF109K01605",
];

// Pipe-delimited, header row + data rows — a common CAMS WBR2 export shape.
const HEADER = [
  "AMC",
  "FOLIO_NO",
  "PAN",
  "INV_NAME",
  "PRODUCT_CODE",
  "SCHEME_NAME",
  "ISIN",
  "TRXN_TYPE",
  "TRADE_DATE",
  "POST_DATE",
  "AMOUNT",
  "UNITS",
  "NAV",
  "TRXN_NO",
  "STATUS",
];

const rows = [HEADER.join("|")];

ISINS.forEach((isin, i) => {
  const folio = `${10000000 + i}/${20 + i}`;
  const pan = `ABCPP${1000 + i}G`;
  const name = `Test Investor ${i + 1}`;
  const product = `10${i + 1}ETGP`;
  const scheme = `ICICI Prudential Test Scheme ${i + 1} - Regular Growth`;
  // One purchase then a partial redemption a week later (exercises FIFO gains).
  rows.push(
    [
      "ICICI", folio, pan, name, product, scheme, isin,
      "PURCHASE", "01-01-2024", "01-01-2024", "100000.00", "1000.0000", "100.0000",
      `TST${i + 1}001`, "ALLOTTED",
    ].join("|")
  );
  rows.push(
    [
      "ICICI", folio, pan, name, product, scheme, isin,
      "REDEMPTION", "08-01-2024", "08-01-2024", "55000.00", "500.0000", "110.0000",
      `TST${i + 1}002`, "ALLOTTED",
    ].join("|")
  );
});

process.stdout.write(rows.join("\n") + "\n");
