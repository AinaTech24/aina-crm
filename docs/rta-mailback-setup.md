# RTA Mailback — Direct Auto-Import via Email Forwarding

Every MFD receives their daily CAMS / KFintech **mailback** as a password-protected
ZIP by email. This feature lets each firm **auto-forward** those emails to us and
have the files imported automatically — no manual upload, no Cybrilla/FintechPrimitives.

It reuses the existing `rta.import` pipeline end-to-end (unzip → decode → auto-detect →
`importRtaFolios` / `processRtaFile`). The only new part is the inbound-email → attachment
→ S3 → enqueue bridge.

---

## How it works

```
CAMS/KFintech ──daily──▶ MFD's inbox
                              │  one-time auto-forward rule (set by the MFD)
                              ▼
        rta-<token>@crm.ainatech.in         ← unique per firm
                              │  catch-all delivers into the single rta@ mailbox
                              ▼
   rta-inbox-poller (worker, every ~120s)
     • resolve tenant from the recipient address (rta_forward_addresses)
     • capture any Gmail/Outlook forwarding-confirmation code (for the UI)
     • classify each attachment by report-code + sender → (source, kind)
     • push attachment to S3, enqueue the EXISTING rta.import job
                              ▼
   rta.import worker → unzip (firm's CAMS/KFin password) → auto-detect → import
                              ▼
   auto-applied · rta_file_imports row · shows on RTA Imports + the settings card
```

- **Client** deduped by **PAN**; **folios** by **(amc_code, folio_number)** — a client
  with many folios (incl. CAMS + KFintech) keeps them all.
- **Idempotent**: whole-file dedupe by sha256; re-forwarding the same file is a no-op.
- **Never lost**: unroutable mail → `rta_inbound_quarantine`; unrecognised attachment →
  skipped + logged; wrong password → import row marked `failed` with a clear reason.

---

## One-time platform setup

### 1. Mailbox (Hostinger, `crm.ainatech.in`)
- Create the mailbox **`rta@crm.ainatech.in`**.
- **Emails → Forwarders → Create catch-all** → deliver `*@crm.ainatech.in` to
  `rta@crm.ainatech.in`, then **confirm** via the link Hostinger emails to that box.
- Ensure `crm.ainatech.in` **MX** points to Hostinger's mail servers. Leave the existing
  **A record → EC2** untouched (MX and A coexist).

### 2. Inbox config — **Aina Admin → RTA Mailbox** (no redeploy)
Enter the IMAP details in the admin panel (`/super-admin/rta-inbox`):
- **IMAP host** `imap.hostinger.com`, **port** `993`, **SSL/TLS** on
- **Mailbox** `rta@crm.ainatech.in` + its password
- **Forwarding domain** `crm.ainatech.in`

Save, then **Test connection**. Stored in `platform_settings('rta_inbox')` with the
password encrypted (AES-256-GCM). The poller re-reads it every ~2 min — no restart.

> **Env fallback:** if the admin config is empty, the poller falls back to
> `RTA_INBOX_HOST/PORT/SECURE/USER/PASS/DOMAIN` (+ optional
> `RTA_INBOX_POLLER_INTERVAL_MS`) in `~/app/.env.production`. Admin config always wins.

- The poller **no-ops** until configured (admin or env) — safe to deploy first.
- The worker also needs `ALLOW_SYSTEM_TX=1` (already set in prod) for cross-tenant routing.

### 3. Deploy
Production builds from the **`deploy/aws`** branch — a push there triggers the GitHub
Actions deploy (SSH → `scripts/redeploy.sh`), which builds, runs `migrate:all` (applies
`0175`), and blue-green restarts web + worker. Watch the **Actions** tab, or on the box
`tail -f ~/deploy-current.log` for `DEPLOY_DONE_EXIT=0`. If Actions says "Auto-deploy
skipped", the `DEPLOY_SSH_*` secrets aren't set — run `bash scripts/redeploy.sh` on the
server. Confirm `[rta-inbox] mailback poller started` in the worker logs.

---

## First-run smoke test (operator, ~2 min)

1. **Configure the inbox** — Aina Admin → **RTA Mailbox** (`/super-admin/rta-inbox`):
   `imap.hostinger.com` · `993` · SSL · `rta@crm.ainatech.in` · password · domain
   `crm.ainatech.in` → **Save** → **Test connection** (expect "Connected").
2. **Copy the address** — as a firm **owner**: Settings → Integrations → "RTA Mailback"
   card → **"Your forwarding address"** box (`rta-<token>@crm.ainatech.in`) → copy button.
   (Auto-generated on first load.) Enter CAMS + KFintech passwords here too.
3. **Send a test** — from any mail account, email an attachment **to that address**.
4. **Observe** — within ~2 min the chip flips to **"Receiving mail"** (proves routing).
   For it to also appear under **"Recent auto-imports"**, the attachment filename must look
   like an RTA report (e.g. `WBR2_test.csv`) — a real report code — otherwise it's
   quarantined by design. Best real test: **forward an actual CAMS/KFintech mailback email**.

---

## Per-MFD onboarding (self-serve)

**Settings → Integrations → "RTA Mailback — Auto-import"**:
1. Enter the **CAMS** and **KFintech** ZIP passwords (the ones set when subscribing to each
   RTA's mailback). Stored encrypted.
2. Copy the firm's unique address **`rta-<token>@crm.ainatech.in`**.
3. In Gmail/Outlook, add an **auto-forward** rule sending the RTA mailback emails to that
   address. The provider asks to confirm forwarding — we auto-capture the code and show it
   on the card; confirm it once.
4. Done. Each day's file imports itself. The card shows recent auto-imports and flips to
   **Receiving mail** after the first one lands.

---

## Troubleshooting

| Symptom | Where | Cause / fix |
|---|---|---|
| Nothing imports | worker logs `[rta-inbox]` | Env not set, catch-all not confirmed, or MX wrong. |
| Import `failed` — "Could not open the zip" | RTA Imports screen | Wrong/missing CAMS or KFintech password — re-enter on the card. |
| Mail arrives but no import | `rta_inbound_quarantine` table | Address didn't match a firm (typo / rotated token), or no recognised attachment. |
| A file type isn't picked up | classifier | Filename report-code not recognised → quarantined, not mis-imported. Add the pattern to `src/lib/rta/classify-mailback.ts`. |

### Key files
- `src/workers/rta-inbox-poller.ts` — the poller/bridge
- `src/lib/rta/classify-mailback.ts` — filename+sender → (source, kind)
- `src/lib/rta/mailback-config.ts` — passwords (encrypted) + address provisioning
- `src/lib/comms/imap.ts` → `processUnseenMailback()` — fetch UNSEEN + attachments
- `src/app/api/integrations/rta-mailback/*` + `src/components/integrations/RtaMailbackCard.tsx` — UI/API
- migration `drizzle/migrations/0175_rta_mailback_forwarding.sql`

### Rotating a firm's address
If a firm's address leaks, they click **Rotate** on the card (or
`POST /api/integrations/rta-mailback/regenerate`); the old address stops routing and they
repoint their forward rule.
