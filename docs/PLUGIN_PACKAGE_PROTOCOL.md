# Mesh OpenClaw Plugin Package Protocol

## Goal

The user should need only Mesh and an existing direct chat with the agent. Workstation access is not part of normal enrollment.

## Package currently built

- Package ID: `progretech-mesh-openclaw`
- Version: `0.2.0`
- Archive: `progretech-mesh-openclaw-0.2.0.tgz`
- SHA-256: `3e22b589fdb8409cef680e49cd2f34f4a401b9fb04a171a5c9f6f81cbd618271`
- Minimum tested OpenClaw contract target: `2026.9.3`

SHA-256 is **integrity pinning**, not identity/signature verification.

CodeSeal package verification remains deliberately unimplemented and must not be represented as active until the real verifier is integrated.

## Enrollment flow

1. Mesh generates PTM1 v2.
2. PTM1 contains the agent identity, short-lived activation values, and a `plugin_package` object.
3. The package URL points back to Mesh's versioned distribution endpoint.
4. The agent's preinstalled Mesh enrollment bootstrap downloads only that URL.
5. HTTPS is mandatory unless a development-only override is explicitly set.
6. The agent enforces an 8 MiB package limit.
7. The archive SHA-256 must exactly match the pinned value in PTM1.
8. Archive paths, links, and device members are rejected.
9. The extracted OpenClaw manifest/package identity and version are checked.
10. Only after verification is the package staged locally.
11. Activation redemption occurs and a local reconnect credential is stored.
12. The OpenClaw bootstrap waits for idle before changing runtime activation/restarting.
13. Mesh observation and Mesh conversation remain independent from Telegram.

## Production agent prerequisite

Agents sold/commissioned for Mesh must include a tiny enrollment recognizer/bootstrap as part of their trusted core. That bootstrap is not the Mesh plugin itself. Its only job is to recognize a valid PTM1 request, apply local authorization policy, fetch the declared package, verify it, and invoke enrollment.

This allows the Mesh plugin to evolve without requiring workstation access.

## Future CodeSeal gate

PTM1 already carries a signature object for the package, but `codeseal_verified` remains false. Once CodeSeal package verification exists:

- package identity/signature must be verified locally before extraction/activation;
- CodeSeal failure must stop enrollment;
- Mesh may then display CodeSeal-verified package/core state.

Until then, no production CodeSeal claim is permitted.
