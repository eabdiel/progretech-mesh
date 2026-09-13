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

Adapter version: 0.7.5
Adapter SHA-256: `d8fb8acbcef79fabb8476d6f39132319f9d1a2e31e3ffff484554d138c40451c`
Bootstrap SHA-256: `e6b1d9b657d692329b256ba154f39dd38aef0ee88beca5fe9e86eb10c59b669f`
