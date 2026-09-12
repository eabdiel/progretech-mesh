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

Adapter 0.7.0 SHA-256: `c925173498b81252ec7f016a5d92a40c912adce4ac35f03d52a5325d7ae38e47`
Bootstrap SHA-256: `384590508460466e579d899e422666323d4cff351392b57c9e36a081f1001f07`
