# Agent-led Mesh enrollment

The normal Mesh user does not need workstation access.

## Intended user experience

1. Open `mesh.progretech.com`.
2. Choose **Connect** for an agent.
3. Mesh displays a short-lived signed `PTM1:` enrollment message.
4. Send that message to the agent over an already-authorized direct channel such as Telegram.
5. The agent validates and redeems it locally.
6. If the OpenClaw Mesh plugin is not present, the agent stages it without touching the running Gateway.
7. A detached bootstrap waits until OpenClaw is idle across multiple checks.
8. Only while idle does it activate the plugin and restart the Gateway.
9. The gateway supervisor reconnects outbound to Mesh using the local device credential.
10. The agent reports success/failure through the original chat channel.

## Non-interference

The bootstrap never invokes a forced restart and does not use OpenClaw's bounded `gateway restart --safe`, because that mode can eventually force a restart after its deferral budget. Instead, Mesh waits indefinitely for an idle condition and re-checks immediately before restart.

Copying/staging plugin files is allowed while work is active because it does not alter the running Gateway inventory. Runtime activation is deferred until idle.

## RC2 package flow

The enrollment request now includes a versioned Mesh-hosted OpenClaw plugin package plus a pinned SHA-256. A prepared agent can fetch, verify, stage, and activate it without the human transferring an archive or logging into the workstation.

The remaining integration prerequisite is the small PTM1 enrollment recognizer/bootstrap in the trusted agent core. ProgreTech-owned agents should receive that as part of commissioning; customer distributions should ship with the same bootstrap.

No arbitrary shell is exposed to the Mesh user.
