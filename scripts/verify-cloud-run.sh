#!/usr/bin/env bash
set -euo pipefail

SERVICE_URL="${SERVICE_URL:-}"
if [[ -z "${SERVICE_URL}" ]]; then
  echo "Set SERVICE_URL to the Cloud Run service URL."
  exit 1
fi
SERVICE_URL="${SERVICE_URL%/}"

echo "Checking ${SERVICE_URL}"
curl -fsS "${SERVICE_URL}/healthz" | python3 -m json.tool
echo
curl -fsS "${SERVICE_URL}/startupz" | python3 -m json.tool
echo

READY_CODE="$(curl -sS -o /tmp/mesh-ready.json -w '%{http_code}' "${SERVICE_URL}/readyz")"
cat /tmp/mesh-ready.json | python3 -m json.tool
rm -f /tmp/mesh-ready.json
echo
echo "readyz status: ${READY_CODE}"

curl -fsSI "${SERVICE_URL}/static/manifest.webmanifest" >/dev/null
curl -fsSI "${SERVICE_URL}/static/sw.js" >/dev/null
echo "PWA shell endpoints: reachable"

if [[ "${READY_CODE}" != "200" ]]; then
  echo "Service is running but not production-ready."
  echo "Expected for staging until real OIDC/CodeSeal integrations are configured."
fi
