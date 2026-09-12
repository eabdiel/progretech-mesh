#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-east1}"
SERVICE="${SERVICE:-progretech-mesh}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-}"
DEPLOYMENT_TIER="${MESH_DEPLOYMENT_TIER:-staging}"

SESSION_SECRET_NAME="${SESSION_SECRET_NAME:-progretech-mesh-session-key}"
ACTIVATION_SECRET_NAME="${ACTIVATION_SECRET_NAME:-progretech-mesh-activation-secret}"
DEVICE_SECRET_NAME="${DEVICE_SECRET_NAME:-progretech-mesh-device-secret}"
SECRET_VERSION="${SECRET_VERSION:-1}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "PROJECT_ID is required."
  exit 1
fi

if [[ "${DEPLOYMENT_TIER}" == "production" ]]; then
  if [[ "${MESH_OIDC_READY:-0}" != "1" || "${MESH_CODESEAL_READY:-0}" != "1" ]]; then
    echo "Refusing production deployment."
    echo "Set MESH_OIDC_READY=1 and MESH_CODESEAL_READY=1 only after the real"
    echo "OIDC and CodeSeal integrations have been configured and tested."
    exit 2
  fi
fi

gcloud config set project "${PROJECT_ID}"

ARGS=(
  run deploy "${SERVICE}"
  --source .
  --region "${REGION}"
  --execution-environment gen2
  --port 8080
  --timeout 3600
  --min-instances 0
  --max-instances 1
  --concurrency 80
  --cpu 1
  --memory 512Mi
  --startup-probe "httpGet.path=/startupz,httpGet.port=8080,initialDelaySeconds=0,failureThreshold=12,timeoutSeconds=2,periodSeconds=5"
  --liveness-probe "httpGet.path=/healthz,httpGet.port=8080,initialDelaySeconds=10,failureThreshold=3,timeoutSeconds=2,periodSeconds=30"
  --set-env-vars "APP_ENV=production,MESH_DEPLOYMENT_TIER=${DEPLOYMENT_TIER},MESH_VERSION=1.7.0-v1-rc1,BUILD_ID=v1-phase-7-of-7-rc1-20260912,FLASK_DEBUG=0,TRUST_PROXY_HEADERS=1,DEV_AUTH_ENABLED=0,DEV_SEED_AGENTS=0,MESH_AUTH_MODE=oidc,MESH_AGENT_IDENTITY_MODE=codeseal,CODESEAL_VERIFIER_MODE=${CODESEAL_VERIFIER_MODE:-unconfigured},MESH_OIDC_READY=${MESH_OIDC_READY:-0},MESH_CODESEAL_READY=${MESH_CODESEAL_READY:-0}"
  --set-secrets "SECRET_KEY=${SESSION_SECRET_NAME}:${SECRET_VERSION},MESH_ACTIVATION_SECRET=${ACTIVATION_SECRET_NAME}:${SECRET_VERSION},MESH_DEVICE_CREDENTIAL_SECRET=${DEVICE_SECRET_NAME}:${SECRET_VERSION}"
)

if [[ -n "${SERVICE_ACCOUNT}" ]]; then
  ARGS+=(--service-account "${SERVICE_ACCOUNT}")
fi

echo "Deploying ${SERVICE} to ${REGION} as ${DEPLOYMENT_TIER}..."
gcloud "${ARGS[@]}"

URL="$(gcloud run services describe "${SERVICE}" --region "${REGION}" --format='value(status.url)')"

echo
echo "Deployment submitted."
echo "Service URL: ${URL}"
echo "Run: SERVICE_URL='${URL}' ./scripts/verify-cloud-run.sh"
