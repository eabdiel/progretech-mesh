# Mesh Lifecycle Hardening

This lifecycle applies only to Mesh connectivity and the Mesh adapter. It must not disable,
restart, pause, or reconfigure the agent's unrelated runtime/channels.

## Reconnect

Successful connections reset retry state. Unexpected disconnects use bounded exponential
backoff: 2s, 4s, 8s, 16s, 32s, then a 60s ceiling.

## Credential expiry

When a stored reconnect credential is expired, the adapter stops Mesh reconnect attempts and
marks local lifecycle state as expired. OpenClaw and Telegram continue normally. New PTM1
enrollment is required.

## Revocation

A server revocation event or authentication-rejection WebSocket close marks the local Mesh
device revoked and disables Mesh reconnect. This has no authority over OpenClaw or Telegram.

## Re-enrollment

A new valid PTM1 redemption clears the local revoked marker, stores the new device credential,
and resumes Mesh connectivity.

## Adapter versions

- Same version: idempotent; skip reinstall.
- Newer version: verify package, wait for idle when managed OpenClaw installation is required.
- Older version: rejected by default.
- Failed managed install: do not manipulate OpenClaw internals and do not remove the existing
  agent runtime. The verified candidate archive remains local for diagnostics/retry.

Rollback of an already-activated broken upgrade remains a deliberate managed-operation concern;
Mesh does not directly rewrite OpenClaw's extension directories.
