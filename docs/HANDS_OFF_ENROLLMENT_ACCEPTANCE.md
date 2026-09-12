# Hands-off Enrollment Acceptance

The live Rend acceptance is successful only if all of the following are true:

- Edwin opens Mesh and selects Connect.
- Mesh creates PTM1.
- Edwin sends PTM1 to Rend through the existing Telegram chat.
- No workstation login occurs.
- No ZIP/file attachment is sent by Edwin.
- The baseline recognizer accepts only an owner-authorized direct message.
- Rend downloads the exact package named in PTM1.
- A bad hash is rejected before activation.
- Expired/replayed/cancelled activation is rejected by Mesh.
- If Rend is busy, plugin staging may occur but Gateway activation/restart waits.
- Telegram work is not cancelled, reset or replaced.
- The Gateway restarts only after OpenClaw is observed idle.
- Telegram reconnects after restart.
- Mesh connects outbound using the stored local credential.
- Telegram activity appears in Mesh observation.
- Mesh conversation uses its own Mesh session and does not alter Telegram context.
- Disconnecting/reloading Mesh does not interrupt Rend's Telegram work.
