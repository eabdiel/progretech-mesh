# Canonical Mesh Public Origin

Use `MESH_PUBLIC_ORIGIN` for the address agents can actually reach.

Local acceptance example:
`MESH_PUBLIC_ORIGIN=http://192.168.1.50:8080`

Production example:
`MESH_PUBLIC_ORIGIN=https://mesh.progretech.com`

The browser can still open Mesh at `http://127.0.0.1:8080`; agent-facing PTM1 discovery,
package, activation, pairing, and WebSocket URLs use the canonical origin.

`MESH_ENVIRONMENT=production` requires HTTPS. WebSocket URLs derive automatically:
`http -> ws` and `https -> wss`.
