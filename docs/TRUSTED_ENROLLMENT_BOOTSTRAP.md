# Trusted Enrollment Bootstrap and Plugin Lifecycle

## Separation of responsibilities

### Enrollment bootstrap — trusted baseline
Package: `progretech-mesh-enrollment-bootstrap-0.1.0.tgz`  
Version: `0.1.0`  
SHA-256: `426cfd8965302551a0f32d0f8376d859f8b81d64b9ef2ebe73ae4658b2879842`

This component is intentionally tiny. It is installed as part of agent commissioning and remains present even when the full Mesh plugin is not installed.

Responsibilities:

- observe owner-authorized direct inbound messages;
- recognize a `PTM1:` enrollment envelope;
- require direct/private context;
- pass only the enrollment envelope to the local helper;
- fetch the exact Mesh OpenClaw package declared by PTM1;
- enforce HTTPS in production;
- verify the pinned SHA-256;
- reject unsafe archive members;
- verify plugin ID, package name, runtime and version;
- redeem the short-lived Mesh activation only after package verification;
- stage the plugin without changing the running Gateway;
- wait for idle before activation/restart;
- preserve Telegram and existing OpenClaw work.

It does **not** expose shell execution, accept general commands, or act as a remote administration channel.

## Why it does not auto-update

The enrollment bootstrap is part of the trusted agent core. Automatic self-update would expand the trust boundary and make a compromised Mesh distribution endpoint able to replace the code responsible for verifying Mesh packages.

For the current design:

- bootstrap updates are commissioning/core-maintenance operations;
- full Mesh plugin updates may be delivered through signed/pinned PTM1 enrollment/update requests;
- later CodeSeal verification should cover both artifacts before commercial release.

## Main Mesh plugin lifecycle

Current Mesh OpenClaw plugin package remains versioned independently.

A normal user should never need to know either package filename. The UI flow remains:

`Connect agent → copy/send PTM1 → agent handles the rest`.

## Current security boundary

SHA-256 proves the downloaded bytes match the enrollment request. It does not prove ProgreTech authored those bytes.

Until CodeSeal verification is integrated:

- `codeseal_verified` remains false;
- production UI must not state that the package is CodeSeal verified;
- the baseline helper fails closed if an enrollment falsely asserts local CodeSeal verification support.

## Live acceptance target

Once Rend's trusted baseline includes this recognizer, the acceptance test should start from an ordinary Telegram message containing only PTM1. No ZIP transfer, shell session, SSH, RDP or workstation login should be used.
