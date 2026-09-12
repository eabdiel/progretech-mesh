# Automatic Post-Install Handoff

The OpenClaw adapter now completes enrollment after managed installation without a second owner instruction.

Flow:

`PTM1 → package verification → pending handoff → wait for idle → managed OpenClaw install → plugin startup → activation redeem → signed device credential → outbound Mesh WebSocket → passive activity forwarding`

Local state:

- `~/.progretech-mesh/pending-enrollment.json` — one-time activation material; removed after durable credential persistence.
- `~/.progretech-mesh/device-credential.json` — signed reconnect credential, stored with private permissions.
- `~/.progretech-mesh/connection-status.json` — minimal diagnostic connection state.

On later OpenClaw starts, the adapter reconnects with the saved device credential and does not require re-enrollment.

The adapter forwards passive observation events only. It does not seize Telegram or reuse Telegram conversation context. Mesh conversation remains isolated on the Mesh session path.
