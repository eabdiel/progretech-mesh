#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-east1}"
SERVICE="${SERVICE:-progretech-mesh}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "Set PROJECT_ID first, for example:"
  echo "  export PROJECT_ID='your-gcp-project-id'"
  exit 1
fi

gcloud config set project "${PROJECT_ID}"

# Source deployment uses the Dockerfile in this project.
# Authentication policy is intentionally NOT changed here.
# Configure public/private access explicitly when the Mesh auth design is finalized.
gcloud run deploy "${SERVICE}" \
  --source . \
  --region "${REGION}" \
  --port 8080 \
  --set-env-vars "APP_ENV=production,MESH_VERSION=0.0.1-phase0,FLASK_DEBUG=0,TRUST_PROXY_HEADERS=1"

echo
echo "Deployment submitted for ${SERVICE} in ${REGION}."
