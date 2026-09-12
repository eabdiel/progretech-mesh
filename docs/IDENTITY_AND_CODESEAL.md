# Production Identity + CodeSeal Boundary

## User identity

Mesh supports:

```text
MESH_AUTH_MODE=development
MESH_AUTH_MODE=oidc
```

Development mode exists only for local development.

Production deployment must use the real configured identity provider.

The provider-specific OIDC redirect/callback implementation must not be guessed or
faked before the real issuer/client configuration is available.

## Agent identity

Mesh now separates development identity scaffolding from the production CodeSeal
verifier boundary.

```text
MESH_AGENT_IDENTITY_MODE=development
MESH_AGENT_IDENTITY_MODE=codeseal
```

Development mode:

- can identify known development agents
- can support local testing
- is not cryptographic CodeSeal verification
- must not be displayed as "CodeSeal Verified"

Production CodeSeal mode:

- fails closed while unconfigured
- must cryptographically verify the agent/package identity
- must bind the verified identity to the expected Mesh agent
- must reject expired/revoked/invalid assertions
- must not silently downgrade to development verification

## UI language

Until real CodeSeal cryptographic verification is installed, the frontend uses:

```text
Identity verified
```

rather than:

```text
CodeSeal Verified
```

The latter should only appear when the production verifier has actually succeeded.

## Enrollment

Agent-led enrollment remains short-lived and agent-bound.

Production enrollment must combine:

1. authenticated Mesh user
2. signed/short-lived enrollment request
3. agent-local authorization
4. cryptographically verified agent identity
5. outbound gateway connection

None of these steps may restart or take over the running agent.

## Remaining production dependencies

This build establishes the integration boundaries but intentionally does not fabricate:

- an OIDC client/secret/redirect configuration
- CodeSeal public keys/trust roots
- a CodeSeal SDK/API contract
- revocation endpoint semantics

Those require the actual production provider configuration.
