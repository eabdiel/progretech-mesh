# Direct owner-to-agent data channel

Implemented in this build:
- Browser WebRTC peer + `progretech-mesh` RTCDataChannel.
- OpenClaw WebRTC endpoint using pinned `node-datachannel` 0.33.3.
- Cloud Mesh carries ephemeral SDP/ICE signaling only.
- Same-LAN direct mode uses host ICE candidates only (`iceServers: []`).
- Direct hello/ack, ping/pong, heartbeat request, and one-to-one Mesh messaging.
- Stable isolated Mesh conversation identity remains unchanged.
- SDP/ICE payloads are not persisted into activity history.

Still pending: Internet STUN traversal, optional TURN relay, owner routing policies, offline PWA reconnect, and migration of remaining telemetry/file paths to direct transport.

Adapter 0.7.0 SHA-256: `c925173498b81252ec7f016a5d92a40c912adce4ac35f03d52a5325d7ae38e47`
Bootstrap SHA-256: `384590508460466e579d899e422666323d4cff351392b57c9e36a081f1001f07`
