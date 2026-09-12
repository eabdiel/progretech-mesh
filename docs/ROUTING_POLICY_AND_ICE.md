# Direct-first routing policy

Mesh now has three owner-selectable connection policies.

## Direct preferred
Default. Mesh first attempts direct WebRTC using host and STUN-discovered candidates. If a TURN
service is configured, WebRTC may use it only when the network cannot establish a direct candidate pair.

## Direct only
Mesh supplies host/STUN candidates but removes TURN candidates. If the owner and agent cannot establish
a direct route, the session remains unavailable rather than relaying agent traffic through ProgreTech.

## Relay allowed
Direct candidates are still available and WebRTC's ICE selection chooses the best viable pair. TURN
is available as a fallback when configured.

## Data handling
STUN is NAT discovery and does not carry Mesh conversation content. SDP/ICE negotiation uses Mesh's
ephemeral signaling channel. TURN, when used, carries end-to-end encrypted WebRTC packets; it is not
the default route.

For production, TURN credentials should be short-lived rather than static environment credentials.
The environment-variable credential support in this build is an integration baseline, not the final
credential-vending design.

Adapter version: 0.7.0
Adapter SHA-256: `c925173498b81252ec7f016a5d92a40c912adce4ac35f03d52a5325d7ae38e47`
Bootstrap SHA-256: `384590508460466e579d899e422666323d4cff351392b57c9e36a081f1001f07`
