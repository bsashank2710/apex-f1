#!/usr/bin/env bash
# Deploy this API to Google Cloud Run (builds from source using Dockerfile in this directory).
#
# Prerequisites:
#   gcloud CLI installed and logged in:  gcloud auth login && gcloud auth application-default login
#   Billing enabled on the GCP project (free tier still requires a billing account).
#   APIs enabled (script enables them):
#     run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
#
# Usage:
#   export GCP_PROJECT_ID="your-project-id"
#   ./deploy-cloud-run.sh
#
# Optional:
#   export GCP_REGION="us-central1"
#   export SERVICE_NAME="apex-f1-api"
# After deploy, set ANTHROPIC_API_KEY once in Cloud Run → Variables & secrets (Intel / AI routes).
# This script uses --update-env-vars so those keys are NOT wiped on redeploy (--set-env-vars would remove them).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PROJECT_ID="${GCP_PROJECT_ID:-}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${SERVICE_NAME:-apex-f1-api}"
# Keep ≥1 instance warm to avoid cold-start latency (costs more). Set CLOUD_RUN_MIN_INSTANCES=0 to scale to zero.
MIN_INSTANCES="${CLOUD_RUN_MIN_INSTANCES:-1}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Error: Set GCP_PROJECT_ID to your Google Cloud project ID."
  echo "Example: export GCP_PROJECT_ID=my-project-123 && ./deploy-cloud-run.sh"
  exit 1
fi

# Never run `gcloud config set project` here — that would change your global
# default and affect every other repo / terminal. All commands use --project only.

gcloud services enable run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  --project "$PROJECT_ID"

ENV_VARS="MPLBACKEND=Agg,FASTF1_CACHE_DIR=/tmp/fastf1-cache"

echo "Deploying ${SERVICE} to ${REGION} (project ${PROJECT_ID})..."

gcloud run deploy "$SERVICE" \
  --source "$ROOT" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 1 \
  --timeout 300 \
  --min-instances "${MIN_INSTANCES}" \
  --max-instances 5 \
  --update-env-vars "$ENV_VARS" \
  --project "$PROJECT_ID" \
  --quiet

echo ""
echo "Done. Service URL (use this as EXPO_PUBLIC_API_URL in Expo, no trailing slash):"
gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT_ID" \
  --format 'value(status.url)'
