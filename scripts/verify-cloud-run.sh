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
python3 -m json.tool /tmp/mesh-ready.json
rm -f /tmp/mesh-ready.json
echo
echo "readyz status: ${READY_CODE}"

LOGIN_CODE="$(curl -sS -o /tmp/mesh-login.html -w '%{http_code}' "${SERVICE_URL}/login")"
if [[ "${LOGIN_CODE}" != "200" ]]; then
  echo "LOGIN PAGE FAIL: HTTP ${LOGIN_CODE}"
  rm -f /tmp/mesh-login.html
  exit 2
fi
if grep -q "Email me a sign-in link" /tmp/mesh-login.html; then
  echo "Firebase email-link login surface: PASS"
else
  echo "Firebase email-link login surface: FAIL"
  rm -f /tmp/mesh-login.html
  exit 3
fi
rm -f /tmp/mesh-login.html

AUTH_CONFIG_CODE="$(curl -sS -o /tmp/mesh-auth-config.json -w '%{http_code}' "${SERVICE_URL}/api/auth/firebase/config")"
if [[ "${AUTH_CONFIG_CODE}" == "200" ]]; then
  python3 -m json.tool /tmp/mesh-auth-config.json
  echo "Firebase public config endpoint: PASS"
else
  cat /tmp/mesh-auth-config.json
  echo "Firebase public config endpoint: FAIL (${AUTH_CONFIG_CODE})"
  rm -f /tmp/mesh-auth-config.json
  exit 4
fi
rm -f /tmp/mesh-auth-config.json

curl -fsSI "${SERVICE_URL}/static/manifest.webmanifest" >/dev/null
curl -fsSI "${SERVICE_URL}/static/sw.js" >/dev/null
echo "PWA shell endpoints: reachable"

if [[ "${READY_CODE}" != "200" ]]; then
  echo "Service is running but production readiness is still incomplete."
  exit 5
fi

echo "Cloud Run verification PASS"
