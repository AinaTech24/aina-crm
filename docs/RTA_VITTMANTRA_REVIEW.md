# RTA file import — review of the vittmantra self-hosted copy (2026-11-19)

## What was reviewed
`vittmantra-crm.zip` (git `7402c2b`, 1 Oct 2026, 193 migrations; main has 268). The 1,996 "modified" files in the zip are CRLF line
endings only — the code equals that commit. Scope: everything under `src/lib/rta`, `src/workers/rta-*`,
`src/lib/integrations/cams-feed-parser.ts`, `src/app/api/rta*`, `docker-compose.prod.yml`, `.env.production.example`.

## Finding 1 — vittmantra is NOT better at opening files
Side by side, main is a superset for opening and importing:

| Area | vittmantra | main |
|---|---|---|
| ZIP password | one saved password per registrar, tried as typed | several saved passwords, 20+ forms of each (case, symbols, truncation …), ZipCrypto CRC fallback, AES check diagnosis |
| Several files in a ZIP | first one only | every data file |
| Encrypted CAMS `.xls` | "layout not recognised" | opened with the saved passwords |
| Link-delivered ZIP | `link-fetch.ts` | `mailback-download.ts` (every redirect re-checked, exact S3 bucket match) |
| Retry | `retry.ts` | `reimport` (type a password, remember it, rescans the firm) |
| Completed file | deleted at once | kept 14 days, download icon |
| Refused file | grey row | owner alert, page banner, stethoscope diagnosis, nightly rescan |
| Transactions | keyed by registrar number (collides across AMCs), reversals count as money | AMC-safe key, reversals cancelled, folio owner by AMC |
| Queue | uploads wait behind background jobs | person's upload goes first, 5-minute lock |

So copying vittmantra's code over main would REMOVE capability. Nothing of that kind was done.

## Finding 2 — two things vittmantra has that main lacked (now ported)
1. **Registrar of a hand-forwarded mail** — `sourceFromForwardedBody` (`classify-mailback.ts`), passed to `classifyMailback` /
   `classifyMailbackFromText` as `knownSource`, wired in `rta-inbox-poller.ts` for attachments and downloaded links.
   `sourceFromFileName` also knows R4, R22, R49 and `Systematic_Registration_Status`; the title list gained "systematic registration".
   Not a trust decision (see CLAUDE.md note).
2. **CAMS demographics-only master (WBR9)** — `isCamsStaticOnlyFile` (`cams.ts`), used by `parseRtaRows` (`index.ts`) to say
   "needs WBR4 with balance" with the real column list, instead of "Unrecognised RTA file format".

Tests: `tests/rta-vittmantra-port.test.ts` (10). `tsc --noEmit` clean; all RTA tests pass.
Not ported on purpose: `limits.ts` (main has its own size guard), `retry.ts`, `link-fetch.ts` (superseded), vittmantra's
`R22 → cas_holdings` (main routes it to the AUM statement because WBR22 has no PAN column and the rich engine drops every row).

## Finding 3 — why a file "does not open" is usually not code
- Deployment is sound (worker, Redis, `ALLOW_SYSTEM_TX=1`, storage in `file_blobs`).
- A WinZip-AES check is exact. A refused KFintech/CAMS ZIP means the password saved in Settings → Integrations → RTA Mailback is not the
  one the registrar locked THAT request with. KFintech's schedule form has no password field and a per-request password can differ.
- Same-password rule for a fresh schedule: whatever password is given to the registrar must be saved here byte for byte.

## Recommendation for vittmantra
Bring it to main's level (migrations 0194 → 0268 and the RTA code) rather than patching. The RTA code cannot be copied alone: it
depends on 22 modules vittmantra lacks (client merge, holds-money, business RTA match, sip-lifecycle …) and 27 shared files that differ.
Do a database backup first; the transaction-key change affects re-imports of old data and must be tested on a copy.
