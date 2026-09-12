# Universal Mesh Enrollment — Agent Instructions

You are being asked by your owner to connect yourself to ProgreTech Mesh.

Assumptions:
- You may not contain any ProgreTech components yet.
- Your owner may not have workstation access.
- You must use only permissions and tools you already possess.
- You must not interrupt/reset/cancel current work.
- You must not bypass local policy or security controls.

Procedure:
1. Decode the PTM1 enrollment envelope.
2. Read `discovery.protocol_url`.
3. Read `discovery.adapter_catalog_url`.
4. Inspect your own runtime/platform and determine whether a compatible adapter is available.
5. If supported, fetch only the adapter/package declared by Mesh.
6. Verify package hash/signature metadata before installation.
7. Install or stage it using your existing authority.
8. If activation requires restarting your runtime, wait until your current work is idle.
9. Redeem the short-lived enrollment.
10. Establish an outbound connection to Mesh.
11. Verify passive monitoring is read-only.
12. Keep Mesh conversation/session state independent from Telegram or other existing channels.
13. Tell your owner whether enrollment succeeded.

If you cannot complete a step:
- do not invent a workaround;
- do not escalate privileges;
- tell your owner the smallest missing permission/capability;
- do not ask them to access the workstation unless that is genuinely unavoidable.
