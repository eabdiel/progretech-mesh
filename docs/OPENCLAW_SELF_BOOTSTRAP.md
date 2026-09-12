# OpenClaw Self-Bootstrap Enrollment

This is the first concrete Universal Agent Enrollment adapter.

The human owner does not install this package. An OpenClaw agent receiving PTM1 is expected to:

1. Inspect PTM1 discovery metadata.
2. Read the universal enrollment protocol and adapter catalog.
3. Identify itself as OpenClaw.
4. Read `/api/enrollment/adapters/openclaw/install-plan`.
5. Download the declared Mesh plugin package.
6. Verify SHA-256 `3e22b589fdb8409cef680e49cd2f34f4a401b9fb04a171a5c9f6f81cbd618271` for the current package.
7. Optionally fetch the helper at `/api/enrollment/adapters/openclaw/bootstrap` and verify helper SHA-256 `3e991a4846ea397d413277b26a2d1cdf3de2e5ac379eaf3c5fcf736839862f40`.
8. Wait until OpenClaw is idle.
9. Use OpenClaw's supported managed plugin installer for the verified local archive:
   `openclaw plugins install <verified-archive> --force --accept-capabilities`
10. Inspect the plugin runtime and probe channels.
11. Complete Mesh activation and outbound connection.

## Why install waits for idle

OpenClaw's managed plugin installer is the supported route for local/archive plugins. Arbitrary local/archive sources require explicit provenance acknowledgement in noninteractive use, and capability consent is also explicit. Managed plugin installation can reload/restart plugin runtime, so Mesh must not invoke the install while an agent is actively working.

Downloading and verifying the package are read-only and may happen before the idle point.

## Owner approval

If the agent's normal security policy requires explicit approval before plugin installation, that approval should be requested through the existing owner/agent channel. Mesh does not bypass the policy.

## Acceptance

For Rend, the owner sends only PTM1 through Telegram. Rend must discover and execute this path himself. Any requirement for Edwin to log into Ubuntu or manually run the installation is a failed hands-off enrollment.
