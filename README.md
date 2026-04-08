# Studio Website

Static HTML site for Jérôme Dusanter's Studio. The download counts and ad
impressions shown on `index.html`, `apps.html`, and `stats.html` are updated
once a day by a GitHub Action that pulls real numbers from Google Play, App
Store Connect, and AdMob.

This README only covers the automated stats setup. The site itself is plain
HTML and needs no build step.

---

## How it works

```
GitHub Actions (every day at 06:00 UTC)
        │
        ▼
scripts/fetch-stats/index.js
   ├── Google Play Developer Reporting API (Android installs)
   ├── App Store Connect Sales Reports     (iOS installs)
   └── AdMob Reporting API                 (impressions + earnings)
        │
        ▼
stats-history.json   ← appended (idempotent: never refetches a day)
stats-data.json      ← regenerated, read by the website
        │
        ▼
git commit + git push   ← GitHub Pages serves the new file
```

There is no server, no database, and no API endpoint. The "database" is
`stats-history.json` committed in this repo. The frontend reads
`stats-data.json` directly with `fetch('/stats-data.json')`.

If a credential is missing or an API call fails, that source is skipped and
the others still run. The script always exits cleanly so the daily commit
still happens.

---

## One-time setup

You need to add **6 secrets** in your GitHub repo. Two more (`PLAY_PACKAGE_NAMES`
and `ASC_APP_IDS`) are optional because the package names and Apple IDs are
already baked into the code as defaults (read from your store links in
`apps.html`).

All secrets go here: **GitHub repo → Settings → Secrets and variables →
Actions → New repository secret**.

### 1. Google Service Account (used for both Play and AdMob)

1. Open https://console.cloud.google.com/ and create a new project, e.g.
   `studio-stats`.
2. **APIs & Services → Library**, enable:
   - **Google Play Developer Reporting API**
   - **AdMob API**
3. **IAM & Admin → Service Accounts → Create service account**. Name it
   `studio-stats-bot`. No GCP roles needed. Click **Done**.
4. Open the service account → **Keys → Add key → Create new key → JSON →
   Create**. A `.json` file downloads. Keep it secret.
5. Copy the **entire contents** of the file into a GitHub secret named
   **`GOOGLE_SERVICE_ACCOUNT_JSON`**.

### 2. Play Console permission

1. Open Play Console → **Users and permissions → Invite new users**.
2. Email: paste the service account email (looks like
   `studio-stats-bot@studio-stats.iam.gserviceaccount.com`).
3. **Account permissions**: tick **View app information and download bulk
   reports**.
4. **App permissions**: tick all 4 apps (Space Blaster, Parallel Hearts,
   Wishbone Snap, Who Picked Who).
5. **Send invite**. The service account auto-accepts.

### 3. AdMob API access

1. In AdMob → ⚙ **Settings → API Access → Enable**, accept the terms.
2. Link the GCP project you created in step 1.
3. Copy your publisher ID at the top of the page (`pub-XXXXXXXXXXXXXXXX`)
   into a GitHub secret named **`ADMOB_PUBLISHER_ID`**.

After the first workflow run, the Action log will print the AdMob app IDs
(format `ca-app-pub-…~…`). Open
[`scripts/fetch-stats/sources/admob.js`](scripts/fetch-stats/sources/admob.js)
and fill in the `ADMOB_APP_MAP` constant so impressions get attributed to
the right app. The first run will still record total impressions correctly,
just with `app_id: null`.

### 4. App Store Connect API key

1. App Store Connect → **Users and Access → Integrations → App Store
   Connect API**.
2. Click **+** to generate a new key. Name it `studio-stats`. **Access:
   Sales and Reports**.
3. **Generate**. Download the `.p8` file (only possible once — keep it
   safe).
4. Copy the **Key ID** (short string in the keys table) into a GitHub
   secret named **`ASC_KEY_ID`**.
5. At the top of the same page, copy the **Issuer ID** (UUID) into a GitHub
   secret named **`ASC_ISSUER_ID`**.
6. Open the `.p8` file in a text editor. Copy the **entire contents**,
   including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`
   lines, into a GitHub secret named **`ASC_PRIVATE_KEY`**.
7. Find your **Vendor Number**: App Store Connect → **Payments and Financial
   Reports**. Copy the number from the top right (it looks like `12345678`)
   into a GitHub secret named **`ASC_VENDOR_NUMBER`**.

### Summary of required secrets

| Secret | Required? |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | yes |
| `ADMOB_PUBLISHER_ID` | yes |
| `ASC_KEY_ID` | yes |
| `ASC_ISSUER_ID` | yes |
| `ASC_PRIVATE_KEY` | yes |
| `ASC_VENDOR_NUMBER` | yes |
| `PLAY_PACKAGE_NAMES` | optional (defaults baked in) |
| `ASC_APP_IDS` | optional (defaults baked in) |

---

## First run

1. Go to the **Actions** tab → **Daily stats update** → **Run workflow** →
   pick `main` → **Run workflow**.
2. Wait ~30 seconds, click into the run, expand each step.
3. Look at the **Fetch stats** step. You'll see lines like
   `[play] fetched 12 row(s)` for the sources that worked, and
   `[admob] failed: …` for any that didn't. That's normal on first try.
4. The **Commit updated data** step should push a new commit to `main`
   (`chore(stats): daily update [skip ci]`).
5. After the commit, GitHub Pages rebuilds in ~1 minute. Open
   [your site](https://jeromedusanter95.github.io/Studio-Website/stats.html)
   to verify the numbers updated.

If a source keeps failing, the Action logs are the first place to look. The
most common issues:

- **Play `403`** → the service account isn't invited to Play Console yet
  (step 2 above) or doesn't have the right permission ticked.
- **AdMob `403`** → API access isn't enabled in AdMob settings, or the GCP
  project isn't linked.
- **AdMob `404`** → publisher ID is wrong (check for typos, must start with
  `pub-`).
- **App Store `401`** → JWT issue. Most likely `ASC_PRIVATE_KEY` is missing
  the `BEGIN/END` lines or has been corrupted by line ending changes.
  Re-paste it from the original `.p8` file.
- **App Store `404`** → yesterday's report isn't out yet. Apple posts daily
  reports a few hours after midnight Pacific. The script always tries the
  last 3 days, so it'll fill in tomorrow.

---

## Local dry run (optional)

You can run the fetcher on your laptop without touching GitHub.

```bash
cd "scripts/fetch-stats"
npm install

# Pretend you're CI: export the same env vars.
export GOOGLE_SERVICE_ACCOUNT_JSON="$(cat /path/to/service-account.json)"
export ADMOB_PUBLISHER_ID="pub-XXXXXXXXXXXXXXXX"
export ASC_KEY_ID="XXXXXXXXXX"
export ASC_ISSUER_ID="00000000-0000-0000-0000-000000000000"
export ASC_PRIVATE_KEY="$(cat /path/to/AuthKey_XXXXXXXXXX.p8)"
export ASC_VENDOR_NUMBER="12345678"

node index.js
```

Then check the diff in `stats-history.json` and `stats-data.json`. If it
looks good, just run the workflow on GitHub instead — that's the only
official source of truth.

To preview the website locally:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

---

## Files overview

| File | Purpose |
|---|---|
| `index.html`, `apps.html`, `stats.html` | Static pages. Read `/stats-data.json` to populate download counts. |
| `stats-data.json` | Aggregated totals + per-app data. **Regenerated by the bot, do not edit by hand.** |
| `stats-history.json` | Per-day raw data from each API. The "database". Append-only and idempotent. |
| `scripts/fetch-stats/index.js` | Orchestrator. Runs the 3 sources, writes both files. |
| `scripts/fetch-stats/storage.js` | Read/write history, aggregate, app slug list, manual `average_rating`. |
| `scripts/fetch-stats/sources/play.js` | Google Play Developer Reporting API. |
| `scripts/fetch-stats/sources/appstore.js` | App Store Connect Sales Reports. |
| `scripts/fetch-stats/sources/admob.js` | AdMob Reporting API. **Edit `ADMOB_APP_MAP` after first run.** |
| `.github/workflows/daily-stats.yml` | The cron job (06:00 UTC daily). |
| `_config.yml` | Tells GitHub Pages not to publish `scripts/`, `.github/`, `README.md`. |

### Things you might want to edit by hand

- **Average store rating** — no clean cross-store API. Edit
  `MANUAL_AVERAGE_RATING` at the top of `scripts/fetch-stats/storage.js`.
- **App list** — if you add a 5th app, update `APP_SLUGS` in `storage.js`
  AND the package map in `sources/play.js` AND the Apple ID map in
  `sources/appstore.js` AND the AdMob app map in `sources/admob.js`.
- **Reverting a day** — if a day's numbers look wrong, manually delete the
  matching rows from `stats-history.json` and re-run the workflow. The
  idempotency check will refetch them.
