# Deploy APEX API to Google Cloud Run

## One-time setup

1. **Google Cloud account** — [console.cloud.google.com](https://console.cloud.google.com)  
2. **Create or pick a project** — note the **Project ID** (not only the display name).  
3. **Enable billing** — required even for free-tier usage; you are not charged until you exceed free quotas.  
4. **Install gcloud** (if needed): [Cloud SDK](https://cloud.google.com/sdk/docs/install)  
5. **Login:**
   ```bash
   gcloud auth login
   gcloud auth application-default login
   ```

## Deploy

From this `backend` directory:

```bash
export GCP_PROJECT_ID="your-actual-project-id"
chmod +x deploy-cloud-run.sh
./deploy-cloud-run.sh
```

Optional:

```bash
export GCP_REGION="us-central1"    # default
export SERVICE_NAME="apex-f1-api"  # default
```

The script enables required APIs, builds the image from `Dockerfile`, and deploys a public HTTPS URL (`--allow-unauthenticated` so the mobile app does not need Google auth).

**Safety:** The script does **not** run `gcloud config set project`. It only targets the project you pass in `GCP_PROJECT_ID`, so your global default project (used by other work) stays unchanged.

## After deploy

1. Copy the printed **Service URL** (e.g. `https://apex-f1-api-xxxxx-uc.a.run.app`).  
2. **Expo** → Project → Environment variables → add **`EXPO_PUBLIC_API_URL`** = that URL (no `/docs`, no trailing slash).  
3. **Rebuild** the Android preview app (`npm run build:android:preview` in `mobile`) so the APK embeds the new URL.

## AI (Claude) features

In **Cloud Run** → your service → **Edit & deploy new revision** → **Variables & secrets**:

- **`ANTHROPIC_API_KEY`** — your Anthropic API key (same name as `backend/.env`).

The mobile app’s **`EXPO_PUBLIC_ANTHROPIC_API_KEY`** does **not** power Intel; the **backend** calls Claude.

Without `ANTHROPIC_API_KEY`, live data and maps still work; **`/ai/*` returns 503**.

**Redeploys:** `deploy-cloud-run.sh` uses **`--update-env-vars`** for `MPLBACKEND` / `FASTF1_CACHE_DIR` only, so it does **not** remove `ANTHROPIC_API_KEY` you set in the console. (Older versions of the script used `--set-env-vars`, which cleared every variable on each deploy — if Intel broke after a deploy, set the key again.)

If **`ANTHROPIC_API_KEY`** is **not** set on the service, the API will use the **`X-Anthropic-Key`** header from the app when present (`EXPO_PUBLIC_ANTHROPIC_API_KEY` in Expo). That avoids GCP console setup but **embeds usage of your key in the client** (anyone can extract it from the bundle). Prefer **`ANTHROPIC_API_KEY` on the server** for anything shared publicly.

## Optional: API key for the app

If you set **`API_KEY`** in Cloud Run, every request must send header **`X-API-Key`**. The mobile client must then send that header — only enable if you wire it in the app.

## Always-on (avoid cold starts)

The deploy script defaults to **`--min-instances 1`**, so one container stays warm and first requests after idle are fast. That uses more CPU time than scaling to zero.

To scale to zero (cheaper, slower first hit after idle):

```bash
export CLOUD_RUN_MIN_INSTANCES=0
./deploy-cloud-run.sh
```

## Costs

See [Cloud Run pricing](https://cloud.google.com/run/pricing) and [Free tier](https://cloud.google.com/free). **`min-instances=1`** is not free-tier “always free” in the same way as pure scale-to-zero; monitor usage. Enable [budget alerts](https://cloud.google.com/billing/docs/how-to/budgets) in GCP Billing.
