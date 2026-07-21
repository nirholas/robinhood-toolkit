#!/usr/bin/env bash
# built by nirholas x.com/nichxbt
# robinhood-toolkit · deploy the documentation site to Google Cloud Run
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
# License: All Rights Reserved (c) 2026 nirholas
#
# One command, all the flags written down once so nobody reconstructs them from
# memory. Deploys site/ (Dockerfile + scripts/serve.mjs) as a request-billed,
# scale-to-zero container. The image rebuilds dist/ from source, so a plain
# `git checkout && ./deploy/cloud-run.sh` is a complete deploy.
#
# Prerequisites (once per project):
#   gcloud auth login
#   gcloud config set project <PROJECT_ID>
#   gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
#
# Usage:
#   ./deploy/cloud-run.sh
#
# Override any default inline, e.g.:
#   REGION=europe-west1 MEMORY=256Mi ./deploy/cloud-run.sh
set -euo pipefail

SERVICE="${SERVICE:-robinhood-toolkit-site}"
REGION="${REGION:-us-central1}"
SOURCE="${SOURCE:-site}"      # the Dockerfile and app live in site/, not the repo root
MEMORY="${MEMORY:-512Mi}"
CPU="${CPU:-1}"
MIN_INSTANCES="${MIN_INSTANCES:-0}"   # scale to zero; the first request after idle pays a cold start
MAX_INSTANCES="${MAX_INSTANCES:-10}"
CONCURRENCY="${CONCURRENCY:-80}"

# NOTE: do not pass PORT here. Cloud Run injects it and rejects a deploy that
# sets it explicitly; serve.mjs reads process.env.PORT and defaults to 8080.
gcloud run deploy "$SERVICE" \
  --source "$SOURCE" \
  --region "$REGION" \
  --allow-unauthenticated \
  --port 8080 \
  --memory "$MEMORY" \
  --cpu "$CPU" \
  --min-instances "$MIN_INSTANCES" \
  --max-instances "$MAX_INSTANCES" \
  --concurrency "$CONCURRENCY"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo
echo "Deployed $SERVICE -> $URL"
echo "Health:   curl -s $URL/healthz"
# built by nirholas x.com/nichxbt
