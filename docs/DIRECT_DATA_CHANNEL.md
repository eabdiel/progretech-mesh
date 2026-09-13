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

Adapter 0.7.5 SHA-256: `d8fb8acbcef79fabb8476d6f39132319f9d1a2e31e3ffff484554d138c40451c`
Bootstrap SHA-256: `e6b1d9b657d692329b256ba154f39dd38aef0ee88beca5fe9e86eb10c59b669f`
