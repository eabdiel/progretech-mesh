# Direct transport acceptance

Reference live agent: Rend.

Required live evidence:
- hands-off enrollment from the owner's existing agent chat;
- Telegram remains uninterrupted;
- same-LAN direct WebRTC;
- internet peer-to-peer when permitted;
- Direct only never falls back to TURN;
- Relay allowed can use TURN when configured and direct networking is blocked;
- installed PWA shell loads offline;
- owner grants browser local-network permission and the PWA can use its remembered agent-local signaling route on the same LAN;
- Mesh conversation remains isolated from Telegram;
- refresh/disconnect does not interrupt agent work;
- stored credential reconnects without re-enrollment.

A stable failure boundary is useful evidence but is not an acceptance pass.

Adapter 0.7.5 SHA-256: `d8fb8acbcef79fabb8476d6f39132319f9d1a2e31e3ffff484554d138c40451c`
Bootstrap SHA-256: `e6b1d9b657d692329b256ba154f39dd38aef0ee88beca5fe9e86eb10c59b669f`
